// ============================================================
// Mock 구현 — UI task 병렬 개발용 인메모리 데이터. CONTRACT §8.
// 시드: 이벤트 1 + 학교 2 + 학급 3 + 참가자 — 데모 코드는 README 참조.
// 실서비스 동작은 vb-116-api-rules task의 firestore.ts가 담당.
// ============================================================
import type { CompetitionApi } from './index'
import type {
  AttemptDoc,
  AttemptMetrics,
  ClassDoc,
  ClassPath,
  EventDoc,
  ImportRow,
  JoinInfo,
  LeaderboardRow,
  ParticipantDoc,
  ParticipantPath,
  ParticipantStatus,
  RoleDoc,
  SchoolDoc,
  SchoolPath,
  TeacherSchoolView,
} from './types'
import { newJoinCode, newPublicId, newRecoveryCode, newTeacherCode, newInviteCode, normalizeCode, sha256Hex } from './codes'
import { compareEntries, computeScore, isBetter } from './scoring'
import type { BoardEntryDoc } from './types'

interface Store {
  events: EventDoc[]
  schools: SchoolDoc[]
  classes: ClassDoc[]
  participants: ParticipantDoc[]
  attempts: Map<string, AttemptDoc[]> // participantId → attempts
  board: Map<string, BoardEntryDoc[]> // classId → entries
  recovery: Map<string, string> // recoveryCode → participantId
  invites: Set<string>
  myRole: RoleDoc | null
  mySchoolIds: string[]
}

const now = () => new Date().toISOString()
const uid = () => `mock-${Math.random().toString(36).slice(2, 10)}`

function seed(): Store {
  const event: EventDoc = {
    id: 'evt-demo',
    name: 'Techlympics 2026 (Demo)',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
    maxAttempts: 3,
    visibility: 'code-only',
    scoringVersion: 'v1',
    frozen: false,
    createdAt: now(),
  }
  const schools: SchoolDoc[] = [
    { id: 'sch-kedah', eventId: event.id, name: 'Kedah Legacy School', state: 'Kedah', teacherCode: 'T-KEDAH234', createdAt: now() },
    { id: 'sch-sel', eventId: event.id, name: 'Selangor Pilot School', state: 'Selangor', teacherCode: 'T-SEL23456', createdAt: now() },
  ]
  const classes: ClassDoc[] = [
    { id: 'cls-k3a', eventId: event.id, schoolId: 'sch-kedah', name: '3 Amanah', joinCode: 'KEDAH7', createdAt: now() },
    { id: 'cls-k3b', eventId: event.id, schoolId: 'sch-kedah', name: '3 Bestari', joinCode: 'KEDAH8', createdAt: now() },
    { id: 'cls-s5a', eventId: event.id, schoolId: 'sch-sel', name: '5 Cerdik', joinCode: 'SELFC2', createdAt: now() },
  ]
  const names = ['Aiman bin Khairul', 'Nurul Izzah', 'Lim Wei Jun', 'Priya a/p Kumar', 'Hafiz bin Roslan', 'Tan Mei Ling']
  const participants: ParticipantDoc[] = names.map((name, i) => ({
    id: `p-demo-${i}`,
    eventId: event.id,
    schoolId: 'sch-kedah',
    classId: 'cls-k3a',
    name,
    publicId: `P-DM${i}${i + 2}`,
    status: (i % 3 === 2 ? 'pending' : 'approved') as ParticipantStatus,
    ownerUid: uid(),
    recoveryHash: '',
    registeredAt: now(),
    statusHistory: [],
  }))
  const attempts = new Map<string, AttemptDoc[]>()
  const board = new Map<string, BoardEntryDoc[]>()
  const entries: BoardEntryDoc[] = []
  participants.slice(0, 4).forEach((p, i) => {
    const metrics: AttemptMetrics = {
      missionId: 'mission-demo-1',
      environment: 'gym',
      solveMode: i % 2 === 0 ? 'ai' : 'block',
      successRate: [1, 1, 2 / 3, 1][i],
      averageTimeSec: [42.5, 55.1, null, 71.3][i],
      stars: [5, 4, 2, 3][i],
      blockCount: [1, 12, 9, 15][i],
    }
    attempts.set(p.id, [{ id: `${p.id}_1`, attemptNo: 1, metrics, submittedAt: now() }])
    entries.push({
      participantId: p.id,
      publicId: p.publicId,
      name: p.name,
      status: p.status,
      bestAttemptNo: 1,
      metrics,
      updatedAt: now(),
    })
  })
  board.set('cls-k3a', entries)
  return {
    events: [event],
    schools,
    classes,
    participants,
    attempts,
    board,
    recovery: new Map(),
    invites: new Set(),
    myRole: null,
    mySchoolIds: [],
  }
}

export function createMockApi(): CompetitionApi {
  const s = seed()
  const delay = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 150))

  // UI 개발 편의: 콘솔에서 역할 전환 — __mockRole('teacher'|'organizer'|'admin'|null)
  // mock 전용 escape hatch (CONTRACT §8). firestore 구현엔 존재하지 않음.
  if (typeof window !== 'undefined') {
    window.__mockRole = (role) => {
      if (role === null) {
        s.myRole = null
        s.mySchoolIds = []
        return
      }
      s.myRole = { uid: s.myRole?.uid ?? uid(), role, createdAt: now() }
      if (role === 'teacher' && s.mySchoolIds.length === 0) s.mySchoolIds = ['sch-kedah']
    }
  }

  const findClassByCode = (joinCode: string): JoinInfo => {
    const code = normalizeCode(joinCode)
    const c = s.classes.find((x) => x.joinCode === code)
    if (!c) throw new Error('CLASS_NOT_FOUND')
    const school = s.schools.find((x) => x.id === c.schoolId)!
    const event = s.events.find((x) => x.id === c.eventId)!
    return { event, school, classInfo: c, path: { eventId: event.id, schoolId: school.id, classId: c.id } }
  }

  const requireRole = (roles: string[]) => {
    if (!s.myRole || !roles.includes(s.myRole.role)) throw new Error('FORBIDDEN')
  }

  return {
    async getClassByJoinCode(joinCode) {
      return delay(findClassByCode(joinCode))
    },

    async joinClass(joinCode, profile) {
      const info = findClassByCode(joinCode)
      if (info.event.frozen) throw new Error('EVENT_FROZEN')
      const recoveryCode = newRecoveryCode()
      const participant: ParticipantDoc = {
        id: `p-${Math.random().toString(36).slice(2, 9)}`,
        eventId: info.event.id,
        schoolId: info.school.id,
        classId: info.classInfo.id,
        name: profile.name,
        grade: profile.grade,
        publicId: newPublicId(),
        status: 'pending',
        ownerUid: uid(),
        recoveryHash: await sha256Hex(recoveryCode),
        registeredAt: now(),
        statusHistory: [],
      }
      s.participants.push(participant)
      s.recovery.set(recoveryCode, participant.id)
      return delay({ ...info, participant, recoveryCode })
    },

    async resumeParticipant(recoveryCode) {
      const pid = s.recovery.get(normalizeCode(recoveryCode))
      if (!pid) throw new Error('RECOVERY_NOT_FOUND')
      const p = s.participants.find((x) => x.id === pid)!
      const c = s.classes.find((x) => x.id === p.classId)!
      return delay({ ...findClassByCode(c.joinCode), participant: p })
    },

    async submitAttempt(p: ParticipantPath, metrics) {
      const participant = s.participants.find((x) => x.id === p.participantId)
      if (!participant) throw new Error('PARTICIPANT_NOT_FOUND')
      if (participant.status === 'rejected') throw new Error('REJECTED')
      const event = s.events.find((x) => x.id === p.eventId)!
      if (event.frozen) throw new Error('EVENT_FROZEN')
      const list = s.attempts.get(participant.id) ?? []
      if (list.length >= event.maxAttempts) throw new Error('NO_ATTEMPTS_LEFT')
      const attemptNo = list.length + 1
      list.push({ id: `${participant.id}_${attemptNo}`, attemptNo, metrics, submittedAt: now() })
      s.attempts.set(participant.id, list)
      // board 갱신 (best만)
      const entries = s.board.get(p.classId) ?? []
      const mine = entries.find((e) => e.participantId === participant.id)
      if (!mine || isBetter(metrics, mine.metrics)) {
        const next: BoardEntryDoc = {
          participantId: participant.id,
          publicId: participant.publicId,
          name: participant.name,
          status: participant.status,
          bestAttemptNo: attemptNo,
          metrics,
          updatedAt: now(),
        }
        s.board.set(p.classId, [...entries.filter((e) => e.participantId !== participant.id), next])
      }
      return delay({ attemptNo, remaining: event.maxAttempts - attemptNo })
    },

    async getLeaderboard(joinCode, opts) {
      const info = findClassByCode(joinCode)
      const entries = (s.board.get(info.classInfo.id) ?? [])
        .filter((e) => (opts?.includePending ? e.status !== 'rejected' : e.status === 'approved'))
        .sort((a, b) => compareEntries(a, b, info.event.scoringVersion))
      const rows: LeaderboardRow[] = entries.map((e, i) => ({
        rank: i + 1,
        publicId: e.publicId,
        name: e.name,
        status: e.status,
        score: computeScore(e.metrics, info.event.scoringVersion),
        metrics: e.metrics,
        attemptsUsed: (s.attempts.get(e.participantId) ?? []).length,
      }))
      // 미제출 참가자 (rank null)
      s.participants
        .filter((p) => p.classId === info.classInfo.id)
        .filter((p) => (opts?.includePending ? p.status !== 'rejected' : p.status === 'approved'))
        .filter((p) => !entries.some((e) => e.participantId === p.id))
        .forEach((p) =>
          rows.push({
            rank: null,
            publicId: p.publicId,
            name: p.name,
            status: p.status,
            score: null,
            metrics: null,
            attemptsUsed: (s.attempts.get(p.id) ?? []).length,
          }),
        )
      return delay(rows)
    },

    async validateTeacherCode(code) {
      const c = normalizeCode(code)
      const school = s.schools.find((x) => x.teacherCode === c)
      if (!school) throw new Error('TEACHER_CODE_NOT_FOUND')
      const event = s.events.find((x) => x.id === school.eventId)!
      return delay({ event, school: { id: school.id, name: school.name } })
    },

    async bindTeacherSchool(code) {
      const c = normalizeCode(code)
      const school = s.schools.find((x) => x.teacherCode === c)
      if (!school) throw new Error('TEACHER_CODE_NOT_FOUND')
      if (!s.myRole) s.myRole = { uid: uid(), role: 'teacher', createdAt: now() }
      if (!s.mySchoolIds.includes(school.id)) s.mySchoolIds.push(school.id)
      return delay({ eventId: school.eventId, schoolId: school.id })
    },

    async listMySchools() {
      requireRole(['teacher', 'organizer', 'admin'])
      const views: TeacherSchoolView[] = s.mySchoolIds.map((id) => {
        const school = s.schools.find((x) => x.id === id)!
        return {
          school,
          event: s.events.find((x) => x.id === school.eventId)!,
          classes: s.classes.filter((x) => x.schoolId === id),
        }
      })
      return delay(views)
    },

    async listParticipants(c: ClassPath) {
      requireRole(['teacher', 'organizer', 'admin'])
      return delay(s.participants.filter((p) => p.classId === c.classId))
    },

    async setParticipantStatus(p: ParticipantPath, status: ParticipantStatus) {
      requireRole(['teacher', 'organizer', 'admin'])
      const target = s.participants.find((x) => x.id === p.participantId)
      if (!target) throw new Error('PARTICIPANT_NOT_FOUND')
      target.status = status
      target.statusHistory.push({ status, at: now(), by: s.myRole!.uid })
      const entries = s.board.get(p.classId) ?? []
      const e = entries.find((x) => x.participantId === p.participantId)
      if (e) e.status = status
      return delay(undefined)
    },

    async bulkApprove(c: ClassPath) {
      requireRole(['teacher', 'organizer', 'admin'])
      const targets = s.participants.filter((p) => p.classId === c.classId && p.status === 'pending')
      targets.forEach((t) => {
        t.status = 'approved'
        t.statusHistory.push({ status: 'approved', at: now(), by: s.myRole!.uid })
        const e = (s.board.get(c.classId) ?? []).find((x) => x.participantId === t.id)
        if (e) e.status = 'approved'
      })
      return delay(targets.length)
    },

    async listEvents() {
      requireRole(['organizer', 'admin'])
      return delay([...s.events])
    },

    async createEvent(input) {
      requireRole(['organizer', 'admin'])
      const event: EventDoc = {
        id: `evt-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        maxAttempts: input.maxAttempts ?? 3,
        visibility: 'code-only',
        scoringVersion: 'v1',
        frozen: false,
        createdAt: now(),
      }
      s.events.push(event)
      return delay(event)
    },

    async updateEvent(eventId, patch) {
      requireRole(['organizer', 'admin'])
      const e = s.events.find((x) => x.id === eventId)
      if (!e) throw new Error('EVENT_NOT_FOUND')
      Object.assign(e, patch)
      return delay(undefined)
    },

    async importSchools(eventId, rows: ImportRow[]) {
      requireRole(['organizer', 'admin'])
      const schools: SchoolDoc[] = []
      const classes: ClassDoc[] = []
      const skipped: { row: ImportRow; reason: string }[] = []
      for (const row of rows) {
        if (!row.schoolName?.trim() || !row.className?.trim()) {
          skipped.push({ row, reason: 'EMPTY_FIELD' })
          continue
        }
        let school = [...s.schools, ...schools].find((x) => x.eventId === eventId && x.name === row.schoolName.trim())
        if (!school) {
          school = {
            id: `sch-${Math.random().toString(36).slice(2, 8)}`,
            eventId,
            name: row.schoolName.trim(),
            state: row.state,
            zone: row.zone,
            teacherCode: newTeacherCode(),
            createdAt: now(),
          }
          schools.push(school)
        }
        const dup = [...s.classes, ...classes].some((x) => x.schoolId === school!.id && x.name === row.className.trim())
        if (dup) {
          skipped.push({ row, reason: 'DUPLICATE_CLASS' })
          continue
        }
        classes.push({
          id: `cls-${Math.random().toString(36).slice(2, 8)}`,
          eventId,
          schoolId: school.id,
          name: row.className.trim(),
          joinCode: newJoinCode(),
          createdAt: now(),
        })
      }
      s.schools.push(...schools)
      s.classes.push(...classes)
      return delay({ schools, classes, skipped })
    },

    async listEventSchools(eventId) {
      requireRole(['organizer', 'admin'])
      return delay(
        s.schools
          .filter((x) => x.eventId === eventId)
          .map((school) => ({
            school,
            classes: s.classes
              .filter((c) => c.schoolId === school.id)
              .map((classInfo) => {
                const ps = s.participants.filter((p) => p.classId === classInfo.id)
                return {
                  classInfo,
                  participantCount: ps.length,
                  approvedCount: ps.filter((p) => p.status === 'approved').length,
                  submittedCount: ps.filter((p) => (s.attempts.get(p.id) ?? []).length > 0).length,
                }
              }),
          })),
      )
    },

    async resetTeacherCode(sp: SchoolPath) {
      requireRole(['organizer', 'admin'])
      const school = s.schools.find((x) => x.id === sp.schoolId)
      if (!school) throw new Error('SCHOOL_NOT_FOUND')
      school.teacherCode = newTeacherCode()
      return delay(school.teacherCode)
    },

    async getEventStats(eventId) {
      requireRole(['organizer', 'admin'])
      const event = s.events.find((x) => x.id === eventId)
      if (!event) throw new Error('EVENT_NOT_FOUND')
      const classes = s.classes.filter((x) => x.eventId === eventId)
      const ps = s.participants.filter((x) => x.eventId === eventId)
      return delay({
        event,
        schoolCount: s.schools.filter((x) => x.eventId === eventId).length,
        classCount: classes.length,
        participantCount: ps.length,
        attemptCount: ps.reduce((n, p) => n + (s.attempts.get(p.id) ?? []).length, 0),
      })
    },

    async createOrganizerInvite() {
      requireRole(['admin'])
      const code = newInviteCode()
      s.invites.add(code)
      return delay(code)
    },

    async redeemOrganizerInvite(code) {
      const c = normalizeCode(code)
      if (!s.invites.has(c)) throw new Error('INVITE_NOT_FOUND')
      s.invites.delete(c)
      s.myRole = { uid: s.myRole?.uid ?? uid(), role: 'organizer', inviteCode: c, createdAt: now() }
      return delay(undefined)
    },

    async listRoles() {
      requireRole(['admin'])
      return delay(s.myRole ? [s.myRole] : [])
    },

    async revokeRole(uidToRevoke) {
      requireRole(['admin'])
      if (s.myRole?.uid === uidToRevoke) s.myRole = null
      return delay(undefined)
    },

    async getMyRole() {
      return delay(s.myRole)
    },
  }
}

declare global {
  interface Window {
    __mockRole?: (role: 'teacher' | 'organizer' | 'admin' | null) => void
  }
}
