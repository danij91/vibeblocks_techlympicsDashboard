// ============================================================
// Mock 구현 v2 — UI task 병렬 개발용 인메모리 데이터. CONTRACT §8.
// 시드: 이벤트 1(도전 3) + 학교 2 + 학급 3 + 참가자 — 데모 코드는 README 참조.
// 실서비스 동작은 vb-116-api-rules-v2의 firestore.ts가 담당.
// ============================================================
import type { CompetitionApi } from './index'
import type {
  AttemptDoc,
  AttemptMetrics,
  BoardEntryDoc,
  ChallengeSlot,
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
  SchoolLevel,
  SchoolPath,
  TeacherSchoolView,
} from './types'
import { CHALLENGE_SLOTS, GRADES_BY_LEVEL } from './types'
import { newJoinCode, newPublicId, newRecoveryCode, newTeacherCode, newInviteCode, normalizeCode, sha256Hex } from './codes'
import { averageSec, compareEntries, completedCount, isBetter, recordTimeSec } from './scoring'

interface Store {
  events: EventDoc[]
  schools: SchoolDoc[]
  classes: ClassDoc[]
  participants: ParticipantDoc[]
  attempts: Map<string, AttemptDoc[]> // participantId → attempts (전 슬롯)
  board: Map<string, BoardEntryDoc[]> // classId → entries
  recovery: Map<string, string> // recoveryCode → participantId
  invites: Set<string>
  myRole: RoleDoc | null
  mySchoolIds: string[]
}

const now = () => new Date().toISOString()
const uid = () => `mock-${Math.random().toString(36).slice(2, 10)}`

function emptyUsed(): Record<ChallengeSlot, number> {
  return { c1: 0, c2: 0, c3: 0 }
}

function seed(): Store {
  const event: EventDoc = {
    id: 'evt-demo',
    name: 'Techlympics 2026 (Demo)',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
    challenges: [
      { slot: 'c1', missionId: 201, name: 'Challenge 1' },
      { slot: 'c2', missionId: 202, name: 'Challenge 2' },
      { slot: 'c3', missionId: 203, name: 'Challenge 3' },
    ],
    attemptsPerChallenge: 3,
    visibility: 'code-only',
    scoringVersion: 'v2',
    frozen: false,
    createdAt: now(),
  }
  const schools: SchoolDoc[] = [
    { id: 'sch-kedah', eventId: event.id, name: 'Kedah Legacy School', level: 'primary', state: 'Kedah', teacherCode: 'T-KEDAH234', createdAt: now() },
    { id: 'sch-sel', eventId: event.id, name: 'Selangor Pilot School', level: 'secondary', state: 'Selangor', teacherCode: 'T-SEL23456', createdAt: now() },
    // level 미설정 legacy 학교 — 후설정 UI 확인용
    { id: 'sch-joh', eventId: event.id, name: 'Johor Heritage School', state: 'Johor', teacherCode: 'T-JOH23456', createdAt: now() },
  ]
  const classes: ClassDoc[] = [
    { id: 'cls-k3a', eventId: event.id, schoolId: 'sch-kedah', name: '3 Amanah', grade: 3, joinCode: 'KEDAH7', joinActive: true, createdAt: now() },
    { id: 'cls-k3b', eventId: event.id, schoolId: 'sch-kedah', name: '3 Bestari', grade: 3, joinCode: 'KEDAH8', joinActive: true, createdAt: now() },
    { id: 'cls-s5a', eventId: event.id, schoolId: 'sch-sel', name: '5 Cerdik', grade: 5, joinCode: 'SELFC2', joinActive: true, createdAt: now() },
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

  const mk = (missionId: number, t: number | null, ok = true): AttemptMetrics => ({
    missionId,
    environment: 'gym',
    solveMode: 'block',
    successRate: ok && t !== null ? 1 : 2 / 3,
    averageTimeSec: t,
    stars: 4,
    blockCount: 9,
  })

  const attempts = new Map<string, AttemptDoc[]>()
  const board = new Map<string, BoardEntryDoc[]>()
  const entries: BoardEntryDoc[] = []
  // p0: 3도전 완주(랭킹) / p1: 3도전 완주(랭킹, 더 느림) / p2(pending): 2도전만 / p3: 1도전만
  const plans: [number, Partial<Record<ChallengeSlot, number[]>>][] = [
    [0, { c1: [52.4, 44.1], c2: [61.0], c3: [38.9] }],
    [1, { c1: [49.7], c2: [70.2, 66.5], c3: [41.2] }],
    [2, { c1: [55.0], c2: [88.8] }],
    [3, { c1: [62.3] }],
  ]
  for (const [pi, plan] of plans) {
    const p = participants[pi]
    const list: AttemptDoc[] = []
    const bests: BoardEntryDoc['bests'] = {}
    for (const slot of CHALLENGE_SLOTS) {
      const times = plan[slot] ?? []
      times.forEach((t, i) => {
        const missionId = 200 + Number(slot[1])
        const m = mk(missionId, t)
        list.push({ id: `${p.id}_${slot}_${i + 1}`, slot, attemptNo: i + 1, metrics: m, submittedAt: now() })
        const best = bests[slot]
        if (!best || t < best.timeSec) bests[slot] = { attemptNo: i + 1, timeSec: t, metrics: m }
      })
    }
    attempts.set(p.id, list)
    entries.push({ participantId: p.id, publicId: p.publicId, name: p.name, status: p.status, bests, updatedAt: now() })
  }
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
  const deviceUid = uid() // mock: 이 세션의 '내 기기' — 재가입 부활 식별
  const delay = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 150))

  // UI 개발 편의: 콘솔 __mockRole('teacher'|'admin'|'master'|null) — mock 전용 (CONTRACT §8)
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

  const usedBySlot = (pid: string): Record<ChallengeSlot, number> => {
    const used = emptyUsed()
    for (const a of s.attempts.get(pid) ?? []) used[a.slot] += 1
    return used
  }

  return {
    async getClassByJoinCode(joinCode) {
      return delay(findClassByCode(joinCode))
    },

    async joinClass(joinCode, profile) {
      const info = findClassByCode(joinCode)
      if (info.event.frozen) throw new Error('EVENT_FROZEN')
      if (!info.classInfo.joinActive) throw new Error('JOIN_DISABLED')
      // v3 부활: 같은 기기(ownerUid)의 기존 참가가 있으면 재활성 — 시도 비충전
      const prior = s.participants.find((x) => x.classId === info.classInfo.id && x.ownerUid === deviceUid)
      if (prior) {
        prior.status = 'pending'
        prior.name = profile.name
        prior.statusHistory.push({ status: 'pending', at: now(), by: deviceUid })
        const be = (s.board.get(info.classInfo.id) ?? []).find((e) => e.participantId === prior.id)
        if (be) be.status = 'pending'
        const rc = [...s.recovery.entries()].find(([, pid]) => pid === prior.id)?.[0] ?? newRecoveryCode()
        s.recovery.set(rc, prior.id)
        return delay({ ...info, participant: prior, recoveryCode: rc })
      }
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
        ownerUid: deviceUid,
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

    async submitAttempt(p: ParticipantPath, slot, metrics) {
      const participant = s.participants.find((x) => x.id === p.participantId)
      if (!participant) throw new Error('PARTICIPANT_NOT_FOUND')
      if (participant.status === 'rejected') throw new Error('REJECTED')
      if (participant.status === 'withdrawn') throw new Error('WITHDRAWN')
      const event = s.events.find((x) => x.id === p.eventId)!
      if (event.frozen) throw new Error('EVENT_FROZEN')
      const nowMs = Date.now()
      if (nowMs < Date.parse(event.startsAt) || nowMs > Date.parse(event.endsAt)) throw new Error('EVENT_NOT_OPEN')
      const list = s.attempts.get(participant.id) ?? []
      const slotUsed = list.filter((a) => a.slot === slot).length
      if (event.attemptsPerChallenge !== null && slotUsed >= event.attemptsPerChallenge) throw new Error('NO_ATTEMPTS_LEFT')
      const attemptNo = slotUsed + 1
      list.push({ id: `${participant.id}_${slot}_${attemptNo}`, slot, attemptNo, metrics, submittedAt: now() })
      s.attempts.set(participant.id, list)

      const entries = s.board.get(p.classId) ?? []
      let mine = entries.find((e) => e.participantId === participant.id)
      if (!mine) {
        mine = { participantId: participant.id, publicId: participant.publicId, name: participant.name, status: participant.status, bests: {}, updatedAt: now() }
        entries.push(mine)
        s.board.set(p.classId, entries)
      }
      let isNewBest = false
      if (isBetter(metrics, mine.bests[slot])) {
        mine.bests[slot] = { attemptNo, timeSec: recordTimeSec(metrics)!, metrics }
        mine.updatedAt = now()
        isNewBest = true
      }
      return delay({
        slot,
        attemptNo,
        remaining: event.attemptsPerChallenge === null ? -1 : event.attemptsPerChallenge - attemptNo,
        isNewBest,
        bestTimeSec: mine.bests[slot]?.timeSec ?? null,
      })
    },

    async getLeaderboard(joinCode, opts) {
      const info = findClassByCode(joinCode)
      return this.getLeaderboardByPath(info.path, opts)
    },

    async getLeaderboardByPath(c: ClassPath, opts) {
      const classInfo = s.classes.find((x) => x.id === c.classId)
      if (!classInfo) throw new Error('CLASS_NOT_FOUND')
      const entries = (s.board.get(c.classId) ?? [])
        .filter((e) => e.status !== 'withdrawn')
        .filter((e) => (opts?.includePending ? e.status !== 'rejected' : e.status === 'approved'))
        .sort(compareEntries)
      const ranked = entries.filter((e) => completedCount(e.bests) > 0)
      const rows: LeaderboardRow[] = entries.map((e) => {
        const avg = averageSec(e.bests)
        return {
          rank: completedCount(e.bests) > 0 ? ranked.indexOf(e) + 1 : null,
          publicId: e.publicId,
          name: e.name,
          status: e.status,
          bests: Object.fromEntries(
            Object.entries(e.bests).map(([k, v]) => [k, v!.timeSec]),
          ) as Partial<Record<ChallengeSlot, number>>,
          completedCount: completedCount(e.bests),
          averageSec: avg,
          attemptsUsed: usedBySlot(e.participantId),
        }
      })
      // 미제출 참가자
      s.participants
        .filter((p) => p.classId === c.classId)
        .filter((p) => p.status !== 'withdrawn')
        .filter((p) => (opts?.includePending ? p.status !== 'rejected' : p.status === 'approved'))
        .filter((p) => !entries.some((e) => e.participantId === p.id))
        .forEach((p) =>
          rows.push({
            rank: null,
            publicId: p.publicId,
            name: p.name,
            status: p.status,
            bests: {},
            completedCount: 0,
            averageSec: null,
            attemptsUsed: usedBySlot(p.id),
          }),
        )
      return delay(rows)
    },

    async withdraw(p: ParticipantPath) {
      const target = s.participants.find((x) => x.id === p.participantId)
      if (!target) throw new Error('PARTICIPANT_NOT_FOUND')
      target.status = 'withdrawn'
      target.statusHistory.push({ status: 'withdrawn', at: now(), by: target.ownerUid })
      const e = (s.board.get(p.classId) ?? []).find((x) => x.participantId === p.participantId)
      if (e) e.status = 'withdrawn'
      return delay(undefined)
    },

    async resetJoinCode(c: ClassPath) {
      requireRole(['teacher', 'admin', 'master'])
      const target = s.classes.find((x) => x.id === c.classId)
      if (!target) throw new Error('CLASS_NOT_FOUND')
      target.joinCode = newJoinCode()
      return delay(target.joinCode)
    },

    async setJoinActive(c: ClassPath, active: boolean) {
      requireRole(['teacher', 'admin', 'master'])
      const target = s.classes.find((x) => x.id === c.classId)
      if (!target) throw new Error('CLASS_NOT_FOUND')
      target.joinActive = active
      return delay(undefined)
    },

    async addClass(sp: SchoolPath, name: string, grade?: number) {
      requireRole(['teacher', 'admin', 'master'])
      const school = s.schools.find((x) => x.id === sp.schoolId)
      if (!school) throw new Error('SCHOOL_NOT_FOUND')
      if (s.classes.some((x) => x.schoolId === sp.schoolId && x.name === name.trim())) throw new Error('DUPLICATE_CLASS')
      if (grade !== undefined && (!school.level || !GRADES_BY_LEVEL[school.level].includes(grade))) throw new Error('INVALID_GRADE')
      const c: ClassDoc = {
        id: `cls-${Math.random().toString(36).slice(2, 8)}`,
        eventId: sp.eventId,
        schoolId: sp.schoolId,
        name: name.trim(),
        grade,
        joinCode: newJoinCode(),
        joinActive: true,
        createdAt: now(),
      }
      s.classes.push(c)
      return delay(c)
    },

    async setSchoolLevel(sp: SchoolPath, level: SchoolLevel) {
      requireRole(['admin', 'master'])
      const school = s.schools.find((x) => x.id === sp.schoolId)
      if (!school) throw new Error('SCHOOL_NOT_FOUND')
      school.level = level
      return delay(undefined)
    },

    async listSchoolTeachers(sp: SchoolPath) {
      requireRole(['admin', 'master'])
      void sp
      return delay([{ uid: 'mock-teacher-1', email: 'teacher@mock.dev', boundAt: now() }])
    },

    async revokeTeacherBinding(sp: SchoolPath, uidToRevoke: string) {
      requireRole(['admin', 'master'])
      void sp
      void uidToRevoke
      return delay(undefined)
    },

    async listAdminInvites() {
      requireRole(['master'])
      return delay([...s.invites].map((code) => ({ code, usedBy: null, createdAt: now() })))
    },

    async deleteAdminInvite(code: string) {
      requireRole(['master'])
      s.invites.delete(normalizeCode(code))
      return delay(undefined)
    },

    async deleteMyAccount() {
      s.myRole = null
      s.mySchoolIds = []
      return delay(undefined)
    },

    async getMyProgress(p: ParticipantPath) {
      const entries = s.board.get(p.classId) ?? []
      const mine = entries.find((e) => e.participantId === p.participantId)
      return delay({
        attemptsUsed: usedBySlot(p.participantId),
        bests: Object.fromEntries(
          Object.entries(mine?.bests ?? {}).map(([k, v]) => [k, v!.timeSec]),
        ) as Partial<Record<ChallengeSlot, number>>,
      })
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
      requireRole(['teacher', 'admin', 'master'])
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
      requireRole(['teacher', 'admin', 'master'])
      return delay(s.participants.filter((p) => p.classId === c.classId))
    },

    async setParticipantStatus(p: ParticipantPath, status: ParticipantStatus) {
      requireRole(['teacher', 'admin', 'master'])
      const target = s.participants.find((x) => x.id === p.participantId)
      if (!target) throw new Error('PARTICIPANT_NOT_FOUND')
      target.status = status
      target.statusHistory.push({ status, at: now(), by: s.myRole!.uid })
      const e = (s.board.get(p.classId) ?? []).find((x) => x.participantId === p.participantId)
      if (e) e.status = status
      return delay(undefined)
    },

    async bulkApprove(c: ClassPath) {
      requireRole(['teacher', 'admin', 'master'])
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
      requireRole(['admin', 'master'])
      return delay([...s.events])
    },

    async createEvent(input) {
      requireRole(['admin', 'master'])
      const event: EventDoc = {
        id: `evt-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        challenges:
          input.challenges ??
          [
            { slot: 'c1', missionId: 201, name: 'Challenge 1' },
            { slot: 'c2', missionId: 202, name: 'Challenge 2' },
            { slot: 'c3', missionId: 203, name: 'Challenge 3' },
          ],
        attemptsPerChallenge: input.attemptsPerChallenge === undefined ? 3 : input.attemptsPerChallenge,
        visibility: 'code-only',
        scoringVersion: 'v2',
        frozen: false,
        createdAt: now(),
      }
      s.events.push(event)
      return delay(event)
    },

    async updateEvent(eventId, patch) {
      requireRole(['admin', 'master'])
      const e = s.events.find((x) => x.id === eventId)
      if (!e) throw new Error('EVENT_NOT_FOUND')
      Object.assign(e, patch)
      return delay(undefined)
    },

    async deleteEvent(eventId) {
      requireRole(['admin', 'master'])
      if (!s.events.some((x) => x.id === eventId)) throw new Error('EVENT_NOT_FOUND')
      const deadParticipants = s.participants.filter((p) => p.eventId === eventId)
      deadParticipants.forEach((p) => s.attempts.delete(p.id))
      s.classes.filter((c) => c.eventId === eventId).forEach((c) => s.board.delete(c.id))
      s.participants = s.participants.filter((p) => p.eventId !== eventId)
      s.classes = s.classes.filter((c) => c.eventId !== eventId)
      const deadSchoolIds = new Set(s.schools.filter((x) => x.eventId === eventId).map((x) => x.id))
      s.mySchoolIds = s.mySchoolIds.filter((id) => !deadSchoolIds.has(id))
      s.schools = s.schools.filter((x) => x.eventId !== eventId)
      s.events = s.events.filter((x) => x.id !== eventId)
      return delay(undefined)
    },

    async importSchools(eventId, rows: ImportRow[]) {
      requireRole(['admin', 'master'])
      const schools: SchoolDoc[] = []
      const classes: ClassDoc[] = []
      const skipped: { row: ImportRow; reason: string }[] = []
      for (const row of rows) {
        if (!row.schoolName?.trim()) {
          skipped.push({ row, reason: 'EMPTY_FIELD' })
          continue
        }
        let school = [...s.schools, ...schools].find((x) => x.eventId === eventId && x.name === row.schoolName.trim())
        if (!school) {
          school = {
            id: `sch-${Math.random().toString(36).slice(2, 8)}`,
            eventId,
            name: row.schoolName.trim(),
            level: row.level,
            state: row.state,
            zone: row.zone,
            teacherCode: newTeacherCode(),
            createdAt: now(),
          }
          schools.push(school)
        }
        if (!row.className?.trim()) continue // 학교 전용 행
        const dup = [...s.classes, ...classes].some((x) => x.schoolId === school!.id && x.name === row.className!.trim())
        if (dup) {
          skipped.push({ row, reason: 'DUPLICATE_CLASS' })
          continue
        }
        classes.push({
          id: `cls-${Math.random().toString(36).slice(2, 8)}`,
          eventId,
          schoolId: school.id,
          name: row.className!.trim(),
          joinCode: newJoinCode(),
          joinActive: true,
          createdAt: now(),
        })
      }
      s.schools.push(...schools)
      s.classes.push(...classes)
      return delay({ schools, classes, skipped })
    },

    async listEventSchools(eventId) {
      requireRole(['admin', 'master'])
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
      requireRole(['admin', 'master'])
      const school = s.schools.find((x) => x.id === sp.schoolId)
      if (!school) throw new Error('SCHOOL_NOT_FOUND')
      school.teacherCode = newTeacherCode()
      return delay(school.teacherCode)
    },

    async getEventStats(eventId) {
      requireRole(['admin', 'master'])
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

    async createAdminInvite() {
      requireRole(['master'])
      const code = newInviteCode()
      s.invites.add(code)
      return delay(code)
    },

    async validateAdminInvite(code) {
      if (!s.invites.has(normalizeCode(code))) throw new Error('INVITE_NOT_FOUND')
      return delay(undefined)
    },

    async redeemAdminInvite(code) {
      const c = normalizeCode(code)
      if (!s.invites.has(c)) throw new Error('INVITE_NOT_FOUND')
      s.invites.delete(c)
      s.myRole = { uid: s.myRole?.uid ?? uid(), role: 'admin', inviteCode: c, createdAt: now() }
      return delay(undefined)
    },

    async listRoles() {
      requireRole(['master'])
      return delay(s.myRole ? [s.myRole] : [])
    },

    async revokeRole(uidToRevoke) {
      requireRole(['master'])
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
    __mockRole?: (role: 'teacher' | 'admin' | 'master' | null) => void
  }
}
