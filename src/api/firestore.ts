import { FirebaseError } from 'firebase/app'
import { deleteUser, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type { CompetitionApi } from './index'
import { newInviteCode, newJoinCode, newPublicId, newRecoveryCode, newTeacherCode, normalizeCode, sha256Hex } from './codes'
import { averageSec, compareEntries, completedCount, isBetter, recordTimeSec } from './scoring'
import type {
  AttemptDoc,
  BoardBest,
  BoardEntryDoc,
  ChallengeDef,
  ChallengeSlot,
  ClassDoc,
  ClassPath,
  EventDoc,
  EventStats,
  JoinInfo,
  LeaderboardRow,
  OrganizerSchoolView,
  ParticipantDoc,
  ParticipantPath,
  ParticipantStatus,
  RoleDoc,
  SchoolDoc,
  SchoolPath,
  TeacherBinding,
  TeacherSchoolView,
  AdminInviteDoc,
} from './types'
import { GRADES_BY_LEVEL } from './types'
import { auth, db } from '../lib/firebase'

type CodeMapping = {
  eventId: string
  schoolId: string
  classId?: string
  schoolName?: string
  className?: string
  state?: string
  zone?: string
  createdAt?: unknown
}

type RoleWithSchools = RoleDoc & {
  code?: string
  eventId?: string
  schoolId?: string
  schoolPaths?: SchoolPath[]
}

const defaultChallenges = (): ChallengeDef[] => [
  { slot: 'c1', missionId: 201, name: 'Challenge 1' },
  { slot: 'c2', missionId: 202, name: 'Challenge 2' },
  { slot: 'c3', missionId: 203, name: 'Challenge 3' },
]

const nowIso = () => new Date().toISOString()

function toTimestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso))
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return nowIso()
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function asEvent(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): EventDoc {
  const data = snap.data()
  return {
    id: snap.id,
    name: data.name,
    startsAt: toIso(data.startsAt),
    endsAt: toIso(data.endsAt),
    challenges: (data.challenges ?? defaultChallenges()) as ChallengeDef[],
    attemptsPerChallenge: data.attemptsPerChallenge ?? 3,
    visibility: data.visibility ?? 'code-only',
    scoringVersion: data.scoringVersion ?? 'v2',
    frozen: data.frozen ?? false,
    createdAt: toIso(data.createdAt),
  }
}

function asSchool(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }, eventId: string): SchoolDoc {
  const data = snap.data()
  return {
    id: snap.id,
    eventId: data.eventId ?? eventId,
    name: data.name,
    level: data.level,
    state: data.state,
    zone: data.zone,
    teacherCode: data.teacherCode ?? '',
    createdAt: toIso(data.createdAt),
  }
}

function asClass(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }, eventId: string, schoolId: string): ClassDoc {
  const data = snap.data()
  return {
    id: snap.id,
    eventId: data.eventId ?? eventId,
    schoolId: data.schoolId ?? schoolId,
    name: data.name,
    grade: data.grade,
    joinCode: data.joinCode,
    joinActive: data.joinActive ?? true,
    createdAt: toIso(data.createdAt),
  }
}

function asParticipant(
  snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData },
  path: ClassPath,
): ParticipantDoc {
  const data = snap.data()
  return {
    id: snap.id,
    eventId: data.eventId ?? path.eventId,
    schoolId: data.schoolId ?? path.schoolId,
    classId: data.classId ?? path.classId,
    name: data.name,
    grade: data.grade,
    publicId: data.publicId,
    status: data.status,
    ownerUid: data.ownerUid,
    recoveryHash: data.recoveryHash,
    registeredAt: toIso(data.registeredAt),
    statusHistory: (data.statusHistory ?? []).map((x: DocumentData) => ({ ...x, at: toIso(x.at) })),
  }
}

function asAttempt(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): AttemptDoc {
  const data = snap.data()
  return {
    id: snap.id,
    slot: data.slot,
    attemptNo: data.attemptNo,
    metrics: data.metrics,
    submittedAt: toIso(data.submittedAt),
  }
}

function asBoardEntry(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): BoardEntryDoc {
  const data = snap.data()
  return {
    participantId: data.participantId ?? snap.id,
    publicId: data.publicId,
    name: data.name,
    status: data.status,
    bests: (data.bests ?? {}) as Partial<Record<ChallengeSlot, BoardBest>>,
    updatedAt: toIso(data.updatedAt),
  }
}

function asRole(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): RoleDoc {
  const data = snap.data()
  return {
    uid: snap.id,
    role: data.role,
    email: data.email,
    inviteCode: data.inviteCode,
    createdAt: toIso(data.createdAt),
  }
}

function asTeacherBinding(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): TeacherBinding {
  const data = snap.data()
  return {
    uid: snap.id,
    email: data.email,
    boundAt: toIso(data.boundAt),
  }
}

function asAdminInvite(snap: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData }): AdminInviteDoc {
  const data = snap.data()
  return {
    code: snap.id,
    usedBy: data.usedBy ?? null,
    createdAt: toIso(data.createdAt),
  }
}

function mapError(error: unknown): never {
  if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) throw error
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/requires-recent-login') throw new Error('REAUTH_REQUIRED')
    if (error.code === 'permission-denied') throw new Error('FORBIDDEN')
    if (error.code === 'not-found') throw new Error('NOT_FOUND')
    if (error.code === 'already-exists') throw new Error('ALREADY_EXISTS')
  }
  throw error
}

async function ensureUser(): Promise<string> {
  // 새로고침 직후 영속 세션이 비동기 복원 중일 수 있다 — 복원 완료를 기다린 뒤 판단.
  // (안 기다리면 익명 로그인이 실세션을 덮어쓰는 레이스 — vb-116 세션 유실 사고)
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser.uid
  const credential = await signInAnonymously(auth)
  return credential.user.uid
}

function eventRef(eventId: string) {
  return doc(db, 'events', eventId)
}

function schoolRef(path: SchoolPath) {
  return doc(db, 'events', path.eventId, 'schools', path.schoolId)
}

function classRef(path: ClassPath) {
  return doc(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId)
}

function participantRef(path: ParticipantPath) {
  return doc(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId, 'participants', path.participantId)
}

function boardRef(path: ParticipantPath) {
  return doc(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId, 'board', path.participantId)
}

function attemptsCollection(path: ParticipantPath) {
  return collection(
    db,
    'events',
    path.eventId,
    'schools',
    path.schoolId,
    'classes',
    path.classId,
    'participants',
    path.participantId,
    'attempts',
  )
}

async function getUniqueCode(makeCode: () => string, collectionName: 'joinCodes' | 'teacherCodes' | 'adminInvites'): Promise<string> {
  for (let i = 0; i < 30; i += 1) {
    const code = makeCode()
    if (!(await getDoc(doc(db, collectionName, code))).exists()) return code
  }
  throw new Error('CODE_GENERATION_FAILED')
}

function eventIsFrozen(event: EventDoc): boolean {
  return event.frozen
}

function eventIsOutsideAttemptWindow(event: EventDoc): boolean {
  const now = Date.now()
  return now < new Date(event.startsAt).getTime() || now > new Date(event.endsAt).getTime()
}

function emptyUsed(): Record<ChallengeSlot, number> {
  return { c1: 0, c2: 0, c3: 0 }
}

function attemptsUsed(attempts: AttemptDoc[]): Record<ChallengeSlot, number> {
  const used = emptyUsed()
  for (const attempt of attempts) used[attempt.slot] += 1
  return used
}

function attemptsUsedFromBests(bests: Partial<Record<ChallengeSlot, BoardBest>>): Record<ChallengeSlot, number> {
  return {
    c1: bests.c1?.attemptNo ?? 0,
    c2: bests.c2?.attemptNo ?? 0,
    c3: bests.c3?.attemptNo ?? 0,
  }
}

function publicBests(bests: Partial<Record<ChallengeSlot, BoardBest>>): Partial<Record<ChallengeSlot, number>> {
  return Object.fromEntries(Object.entries(bests).map(([slot, best]) => [slot, best!.timeSec])) as Partial<Record<ChallengeSlot, number>>
}

export function createFirestoreApi(): CompetitionApi {
  async function readJoinInfo(joinCode: string): Promise<JoinInfo> {
    const code = normalizeCode(joinCode)
    const mappingSnap = await getDoc(doc(db, 'joinCodes', code))
    if (!mappingSnap.exists()) throw new Error('CLASS_NOT_FOUND')
    const mapping = mappingSnap.data() as CodeMapping
    if (!mapping.classId) throw new Error('CLASS_NOT_FOUND')

    const eventSnap = await getDoc(eventRef(mapping.eventId))
    const classSnap = await getDoc(classRef({ eventId: mapping.eventId, schoolId: mapping.schoolId, classId: mapping.classId }))
    if (!eventSnap.exists() || !classSnap.exists()) throw new Error('CLASS_NOT_FOUND')

    const event = asEvent(eventSnap)
    const classInfo = asClass(classSnap, mapping.eventId, mapping.schoolId)
    const school: SchoolDoc = {
      id: mapping.schoolId,
      eventId: mapping.eventId,
      name: mapping.schoolName ?? mapping.schoolId,
      state: mapping.state,
      zone: mapping.zone,
      teacherCode: '',
      createdAt: toIso(mapping.createdAt),
    }
    return {
      event,
      school,
      classInfo,
      path: { eventId: mapping.eventId, schoolId: mapping.schoolId, classId: mapping.classId },
    }
  }

  async function readFullSchool(path: SchoolPath): Promise<SchoolDoc> {
    const snap = await getDoc(schoolRef(path))
    if (!snap.exists()) throw new Error('SCHOOL_NOT_FOUND')
    return asSchool(snap, path.eventId)
  }

  async function readParticipant(path: ParticipantPath): Promise<ParticipantDoc> {
    const snap = await getDoc(participantRef(path))
    if (!snap.exists()) throw new Error('PARTICIPANT_NOT_FOUND')
    return asParticipant(snap, path)
  }

  async function readAttempts(path: ParticipantPath): Promise<AttemptDoc[]> {
    const snaps = await getDocs(attemptsCollection(path))
    return snaps.docs.map(asAttempt).sort((a, b) => (a.slot === b.slot ? a.attemptNo - b.attemptNo : a.slot.localeCompare(b.slot)))
  }

  async function readParticipants(path: ClassPath): Promise<ParticipantDoc[]> {
    const snaps = await getDocs(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId, 'participants'))
    return snaps.docs.map((snap) => asParticipant(snap, path))
  }

  async function readMyParticipants(path: ClassPath, uid: string): Promise<ParticipantDoc[]> {
    const snaps = await getDocs(
      query(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId, 'participants'), where('ownerUid', '==', uid)),
    )
    return snaps.docs.map((snap) => asParticipant(snap, path))
  }

  async function assertClassConsoleAccess(path: ClassPath): Promise<void> {
    const uid = await ensureUser()
    const roleSnap = await getDoc(doc(db, 'roles', uid))
    if (roleSnap.exists()) {
      const role = (roleSnap.data() as RoleWithSchools).role
      if (role === 'admin' || role === 'master') return
    }
    const teacherSnap = await getDoc(doc(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers', uid))
    if (teacherSnap.exists()) return
    throw new Error('FORBIDDEN')
  }

  async function readLeaderboardForClass(path: ClassPath, opts?: { includePending?: boolean }): Promise<LeaderboardRow[]> {
    const snaps = await getDocs(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes', path.classId, 'board'))
    const entries = snaps.docs
      .map(asBoardEntry)
      .filter((entry) => (opts?.includePending ? entry.status !== 'rejected' && entry.status !== 'withdrawn' : entry.status === 'approved'))
      .sort(compareEntries)
    const ranked = entries.filter((entry) => averageSec(entry.bests) !== null)
    return entries.map<LeaderboardRow>((entry) => {
      const avg = averageSec(entry.bests)
      return {
        rank: avg === null ? null : ranked.indexOf(entry) + 1,
        publicId: entry.publicId,
        name: entry.name,
        status: entry.status,
        bests: publicBests(entry.bests),
        completedCount: completedCount(entry.bests),
        averageSec: avg,
        attemptsUsed: attemptsUsedFromBests(entry.bests),
      }
    })
  }

  async function statusPatch(path: ParticipantPath, status: ParticipantStatus): Promise<void> {
    const uid = await ensureUser()
    const participant = await readParticipant(path)
    const nextHistory = [...participant.statusHistory, { status, at: nowIso(), by: uid }]
    await updateDoc(participantRef(path), {
      status,
      statusHistory: nextHistory.map((x) => ({ ...x, at: toTimestamp(x.at) })),
    })
    const boardSnap = await getDoc(boardRef(path))
    if (boardSnap.exists()) await updateDoc(boardRef(path), { status })
  }

  return {
    async getClassByJoinCode(joinCode) {
      try {
        return await readJoinInfo(joinCode)
      } catch (error) {
        return mapError(error)
      }
    },

    async joinClass(joinCode, profile) {
      try {
        const uid = await ensureUser()
        const info = await readJoinInfo(joinCode)
        if (eventIsFrozen(info.event)) throw new Error('EVENT_FROZEN')

        const myParticipants = await readMyParticipants(info.path, uid)
        const withdrawn = myParticipants.find((participant) => participant.status === 'withdrawn')
        if (withdrawn) {
          const nextParticipant: ParticipantDoc = {
            ...withdrawn,
            name: profile.name.trim(),
            grade: profile.grade?.trim() || undefined,
            status: 'pending',
            statusHistory: [...withdrawn.statusHistory, { status: 'pending', at: nowIso(), by: uid }],
          }
          const batch = writeBatch(db)
          batch.update(participantRef({ ...info.path, participantId: withdrawn.id }), {
            name: nextParticipant.name,
            grade: nextParticipant.grade ?? deleteField(),
            status: nextParticipant.status,
            statusHistory: nextParticipant.statusHistory.map((x) => ({ ...x, at: toTimestamp(x.at) })),
          })
          const boardSnap = await getDoc(boardRef({ ...info.path, participantId: withdrawn.id }))
          if (boardSnap.exists()) {
            batch.update(boardRef({ ...info.path, participantId: withdrawn.id }), {
              name: nextParticipant.name,
              status: nextParticipant.status,
            })
          }
          await batch.commit()
          return { ...info, participant: nextParticipant, recoveryCode: '' }
        }

        if (!info.classInfo.joinActive) throw new Error('JOIN_DISABLED')

        const recoveryCode = newRecoveryCode()
        const recoveryHash = await sha256Hex(recoveryCode)
        const participantDoc = doc(collection(db, 'events', info.path.eventId, 'schools', info.path.schoolId, 'classes', info.path.classId, 'participants'))
        const participant: ParticipantDoc = {
          id: participantDoc.id,
          eventId: info.path.eventId,
          schoolId: info.path.schoolId,
          classId: info.path.classId,
          name: profile.name.trim(),
          grade: profile.grade?.trim() || undefined,
          publicId: newPublicId(),
          status: 'pending',
          ownerUid: uid,
          recoveryHash,
          registeredAt: nowIso(),
          statusHistory: [],
        }

        const batch = writeBatch(db)
        batch.set(participantDoc, {
          ...clean(participant),
          registeredAt: serverTimestamp(),
          statusHistory: [],
        })
        batch.set(doc(db, 'recoveryCodes', recoveryHash), {
          eventId: info.path.eventId,
          schoolId: info.path.schoolId,
          classId: info.path.classId,
          participantId: participant.id,
          createdAt: serverTimestamp(),
        })
        await batch.commit()
        return { ...info, participant, recoveryCode }
      } catch (error) {
        return mapError(error)
      }
    },

    async resumeParticipant(recoveryCode) {
      try {
        const uid = await ensureUser()
        const recoveryHash = await sha256Hex(normalizeCode(recoveryCode))
        const recoverySnap = await getDoc(doc(db, 'recoveryCodes', recoveryHash))
        if (!recoverySnap.exists()) throw new Error('RECOVERY_NOT_FOUND')
        const mapping = recoverySnap.data() as Required<Pick<CodeMapping, 'eventId' | 'schoolId' | 'classId'>> & { participantId: string }
        const path: ParticipantPath = {
          eventId: mapping.eventId,
          schoolId: mapping.schoolId,
          classId: mapping.classId,
          participantId: mapping.participantId,
        }
        // v6 수정: ① 이미 내 소유면 claim/rebind 생략(재복원 시 claims 재생성 거부 버그)
        // ② 새 기기는 rebind 전 participant를 읽을 수 없음(owner-only) — claim→rebind→read 순서
        let participant = null as Awaited<ReturnType<typeof readParticipant>> | null
        try {
          participant = await readParticipant(path)
        } catch {
          participant = null
        }
        if (!participant || participant.ownerUid !== uid) {
          const claimRef = doc(db, 'recoveryCodes', recoveryHash, 'claims', uid)
          const claimSnap = await getDoc(claimRef)
          if (!claimSnap.exists()) await setDoc(claimRef, { claimedAt: serverTimestamp() })
          await updateDoc(participantRef(path), { ownerUid: uid })
          participant = await readParticipant(path)
        }
        if (participant.status === 'rejected') throw new Error('REJECTED')
        const classSnap = await getDoc(classRef(path))
        if (!classSnap.exists()) throw new Error('CLASS_NOT_FOUND')
        const info = await readJoinInfo(asClass(classSnap, path.eventId, path.schoolId).joinCode)
        return { ...info, participant: await readParticipant(path) }
      } catch (error) {
        return mapError(error)
      }
    },

    async submitAttempt(path, slot, metrics) {
      try {
        const uid = await ensureUser()
        const [eventSnap, participant] = await Promise.all([getDoc(eventRef(path.eventId)), readParticipant(path)])
        if (!eventSnap.exists()) throw new Error('EVENT_NOT_FOUND')
        const event = asEvent(eventSnap)
        if (participant.ownerUid !== uid) throw new Error('FORBIDDEN')
        if (participant.status === 'withdrawn') throw new Error('WITHDRAWN')
        if (participant.status === 'rejected') throw new Error('REJECTED')
        if (eventIsFrozen(event)) throw new Error('EVENT_FROZEN')
        if (eventIsOutsideAttemptWindow(event)) throw new Error('EVENT_NOT_OPEN')

        const attempts = await readAttempts(path)
        const slotUsed = attempts.filter((attempt) => attempt.slot === slot).length
        if (event.attemptsPerChallenge !== null && slotUsed >= event.attemptsPerChallenge) throw new Error('NO_ATTEMPTS_LEFT')
        const attemptNo = slotUsed + 1
        const attemptId = `${path.participantId}_${slot}_${attemptNo}`
        await setDoc(doc(attemptsCollection(path), attemptId), {
          slot,
          attemptNo,
          metrics,
          submittedAt: serverTimestamp(),
        })

        const boardSnap = await getDoc(boardRef(path))
        const current = boardSnap.exists() ? asBoardEntry(boardSnap) : null
        let isNewBest = false
        let bestTimeSec = current?.bests[slot]?.timeSec ?? null
        if (isBetter(metrics, current?.bests[slot])) {
          const timeSec = recordTimeSec(metrics)
          if (timeSec !== null) {
            const nextBests: Partial<Record<ChallengeSlot, BoardBest>> = {
              ...(current?.bests ?? {}),
              [slot]: { attemptNo, timeSec, metrics },
            }
            const entry: BoardEntryDoc = {
              participantId: participant.id,
              publicId: participant.publicId,
              name: participant.name,
              status: participant.status,
              bests: nextBests,
              updatedAt: nowIso(),
            }
            await setDoc(boardRef(path), { ...entry, updatedAt: serverTimestamp() })
            isNewBest = true
            bestTimeSec = timeSec
          }
        }

        return {
          slot,
          attemptNo,
          remaining: event.attemptsPerChallenge === null ? -1 : event.attemptsPerChallenge - attemptNo,
          isNewBest,
          bestTimeSec,
        }
      } catch (error) {
        return mapError(error)
      }
    },

    async getLeaderboard(joinCode, opts) {
      try {
        const info = await readJoinInfo(joinCode)
        return await readLeaderboardForClass(info.path, opts)
      } catch (error) {
        return mapError(error)
      }
    },

    async getMyProgress(path) {
      try {
        await ensureUser()
        const [attempts, boardSnap] = await Promise.all([readAttempts(path), getDoc(boardRef(path))])
        const board = boardSnap.exists() ? asBoardEntry(boardSnap) : null
        return {
          attemptsUsed: attemptsUsed(attempts),
          bests: publicBests(board?.bests ?? {}),
        }
      } catch (error) {
        return mapError(error)
      }
    },

    async validateTeacherCode(code) {
      try {
        const normalized = normalizeCode(code)
        const mappingSnap = await getDoc(doc(db, 'teacherCodes', normalized))
        if (!mappingSnap.exists()) throw new Error('TEACHER_CODE_NOT_FOUND')
        const mapping = mappingSnap.data() as CodeMapping
        const eventSnap = await getDoc(eventRef(mapping.eventId))
        if (!eventSnap.exists()) throw new Error('EVENT_NOT_FOUND')
        return {
          event: asEvent(eventSnap),
          school: { id: mapping.schoolId, name: mapping.schoolName ?? mapping.schoolId },
        }
      } catch (error) {
        return mapError(error)
      }
    },

    async bindTeacherSchool(code) {
      try {
        const uid = await ensureUser()
        const email = auth.currentUser?.email ?? undefined
        const normalized = normalizeCode(code)
        const mappingSnap = await getDoc(doc(db, 'teacherCodes', normalized))
        if (!mappingSnap.exists()) throw new Error('TEACHER_CODE_NOT_FOUND')
        const mapping = mappingSnap.data() as CodeMapping
        const path = { eventId: mapping.eventId, schoolId: mapping.schoolId }
        const roleRef = doc(db, 'roles', uid)
        const roleSnap = await getDoc(roleRef)
        const batch = writeBatch(db)
        batch.set(doc(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers', uid), {
          ...clean({ code: normalized, email }),
          boundAt: serverTimestamp(),
        })
        if (roleSnap.exists()) {
          batch.update(roleRef, clean({
            role: 'teacher',
            email,
            schoolPaths: arrayUnion(path),
          }))
        } else {
          batch.set(roleRef, clean({
            role: 'teacher',
            email,
            createdAt: serverTimestamp(),
            code: normalized,
            eventId: path.eventId,
            schoolId: path.schoolId,
            schoolPaths: [path],
          }))
        }
        await batch.commit()
        return path
      } catch (error) {
        return mapError(error)
      }
    },

    async listMySchools() {
      try {
        const uid = await ensureUser()
        const roleSnap = await getDoc(doc(db, 'roles', uid))
        if (!roleSnap.exists()) throw new Error('FORBIDDEN')
        const role = roleSnap.data() as RoleWithSchools
        const paths = role.schoolPaths ?? (role.eventId && role.schoolId ? [{ eventId: role.eventId, schoolId: role.schoolId }] : [])
        // v5: 기존 바인딩 email 백필 (best-effort — 실패해도 콘솔 동작에 영향 없음)
        const myEmail = auth.currentUser?.email
        if (myEmail) {
          void Promise.all(
            paths.map(async (path) => {
              try {
                const bindingRef = doc(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers', uid)
                const snap = await getDoc(bindingRef)
                if (snap.exists() && !snap.data().email) await updateDoc(bindingRef, { email: myEmail })
              } catch {
                /* rules 거부 등 — 무시 */
              }
            }),
          )
        }
        const views: TeacherSchoolView[] = await Promise.all(
          paths.map(async (path) => {
            const [eventSnap, school] = await Promise.all([getDoc(eventRef(path.eventId)), readFullSchool(path)])
            if (!eventSnap.exists()) throw new Error('EVENT_NOT_FOUND')
            const classSnaps = await getDocs(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes'))
            return {
              event: asEvent(eventSnap),
              school,
              classes: classSnaps.docs.map((snap) => asClass(snap, path.eventId, path.schoolId)),
            }
          }),
        )
        return views
      } catch (error) {
        return mapError(error)
      }
    },

    async listParticipants(path) {
      try {
        await ensureUser()
        return await readParticipants(path)
      } catch (error) {
        return mapError(error)
      }
    },

    async setParticipantStatus(path, status) {
      try {
        await statusPatch(path, status)
      } catch (error) {
        return mapError(error)
      }
    },

    async bulkApprove(path) {
      try {
        await ensureUser()
        const participants = await readParticipants(path)
        const pending = participants.filter((participant) => participant.status === 'pending')
        await Promise.all(pending.map((participant) => statusPatch({ ...path, participantId: participant.id }, 'approved')))
        return pending.length
      } catch (error) {
        return mapError(error)
      }
    },

    async listEvents() {
      try {
        await ensureUser()
        const snaps = await getDocs(collection(db, 'events'))
        return snaps.docs.map(asEvent)
      } catch (error) {
        return mapError(error)
      }
    },

    async createEvent(input) {
      try {
        await ensureUser()
        const ref = doc(collection(db, 'events'))
        const event: EventDoc = {
          id: ref.id,
          name: input.name.trim(),
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          challenges: input.challenges ?? defaultChallenges(),
          attemptsPerChallenge: input.attemptsPerChallenge ?? 3,
          visibility: 'code-only',
          scoringVersion: 'v2',
          frozen: false,
          createdAt: nowIso(),
        }
        await setDoc(ref, {
          ...event,
          startsAt: toTimestamp(event.startsAt),
          endsAt: toTimestamp(event.endsAt),
          createdAt: serverTimestamp(),
        })
        return event
      } catch (error) {
        return mapError(error)
      }
    },

    async updateEvent(eventId, patch) {
      try {
        await ensureUser()
        const payload: Record<string, unknown> = { ...patch }
        if (patch.startsAt) payload.startsAt = toTimestamp(patch.startsAt)
        if (patch.endsAt) payload.endsAt = toTimestamp(patch.endsAt)
        await updateDoc(eventRef(eventId), payload)
      } catch (error) {
        return mapError(error)
      }
    },

    async deleteEvent(eventId) {
      try {
        await ensureUser()
        // Spark(함수 없음) 환경 — 클라이언트 연쇄 삭제. 배치 400개 단위 flush.
        let batch = writeBatch(db)
        let pending = 0
        const queueDelete = async (ref: Parameters<typeof deleteDoc>[0]) => {
          batch.delete(ref)
          pending += 1
          if (pending >= 400) {
            await batch.commit()
            batch = writeBatch(db)
            pending = 0
          }
        }
        const schoolSnaps = await getDocs(collection(db, 'events', eventId, 'schools'))
        for (const schoolSnap of schoolSnaps.docs) {
          const schoolId = schoolSnap.id
          const teacherCode = String(schoolSnap.data().teacherCode ?? '')
          const teacherSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolId, 'teachers'))
          for (const snap of teacherSnaps.docs) await queueDelete(snap.ref)
          const classSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolId, 'classes'))
          for (const classSnap of classSnaps.docs) {
            const classId = classSnap.id
            const joinCode = String(classSnap.data().joinCode ?? '')
            const boardSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolId, 'classes', classId, 'board'))
            for (const snap of boardSnaps.docs) await queueDelete(snap.ref)
            const participantSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolId, 'classes', classId, 'participants'))
            for (const participantSnap of participantSnaps.docs) {
              const attemptSnaps = await getDocs(collection(participantSnap.ref, 'attempts'))
              for (const snap of attemptSnaps.docs) await queueDelete(snap.ref)
              await queueDelete(participantSnap.ref)
            }
            if (joinCode) await queueDelete(doc(db, 'joinCodes', joinCode))
            await queueDelete(classSnap.ref)
          }
          if (teacherCode) await queueDelete(doc(db, 'teacherCodes', teacherCode))
          await queueDelete(schoolSnap.ref)
        }
        await queueDelete(eventRef(eventId))
        if (pending > 0) await batch.commit()
      } catch (error) {
        return mapError(error)
      }
    },

    async importSchools(eventId, rows) {
      try {
        await ensureUser()
        const existingSchoolSnaps = await getDocs(collection(db, 'events', eventId, 'schools'))
        const schoolsByName = new Map(existingSchoolSnaps.docs.map((snap) => [String(snap.data().name).trim(), asSchool(snap, eventId)]))
        const touchedSchools = new Map<string, SchoolDoc>()
        const classes: ClassDoc[] = []
        const skipped: { row: (typeof rows)[number]; reason: string }[] = []
        const batch = writeBatch(db)

        for (const row of rows) {
          const schoolName = row.schoolName?.trim()
          const className = row.className?.trim()
          if (!schoolName) {
            skipped.push({ row, reason: 'EMPTY_FIELD' })
            continue
          }

          let school = schoolsByName.get(schoolName)
          if (!school) {
            const ref = doc(collection(db, 'events', eventId, 'schools'))
            const teacherCode = await getUniqueCode(newTeacherCode, 'teacherCodes')
            school = {
              id: ref.id,
              eventId,
              name: schoolName,
              level: row.level,
              state: row.state?.trim() || undefined,
              zone: row.zone?.trim() || undefined,
              teacherCode,
              createdAt: nowIso(),
            }
            schoolsByName.set(schoolName, school)
            batch.set(ref, clean({ ...school, createdAt: serverTimestamp() }))
            batch.set(doc(db, 'teacherCodes', teacherCode), clean({
              eventId,
              schoolId: school.id,
              schoolName: school.name,
              state: school.state,
              zone: school.zone,
              createdAt: serverTimestamp(),
            }))
          }

          if (!className) {
            touchedSchools.set(school.id, school)
            continue // v5: 학교 전용 행 — 반은 개별 추가
          }
          const classSnaps = await getDocs(collection(db, 'events', eventId, 'schools', school.id, 'classes'))
          const duplicateClass =
            classSnaps.docs.some((snap) => String(snap.data().name).trim() === className) ||
            classes.some((classInfo) => classInfo.schoolId === school!.id && classInfo.name === className)
          if (duplicateClass) {
            skipped.push({ row, reason: 'DUPLICATE_CLASS' })
            touchedSchools.set(school.id, school)
            continue
          }

          const classDoc = doc(collection(db, 'events', eventId, 'schools', school.id, 'classes'))
          const joinCode = await getUniqueCode(newJoinCode, 'joinCodes')
          const classInfo: ClassDoc = {
            id: classDoc.id,
            eventId,
            schoolId: school.id,
            name: className,
            joinActive: true,
            joinCode,
            createdAt: nowIso(),
          }
          classes.push(classInfo)
          touchedSchools.set(school.id, school)
          batch.set(classDoc, { ...classInfo, createdAt: serverTimestamp() })
          batch.set(doc(db, 'joinCodes', joinCode), clean({
            eventId,
            schoolId: school.id,
            classId: classInfo.id,
            schoolName: school.name,
            className: classInfo.name,
            state: school.state,
            zone: school.zone,
            createdAt: serverTimestamp(),
          }))
        }

        await batch.commit()
        return { schools: [...touchedSchools.values()], classes, skipped }
      } catch (error) {
        return mapError(error)
      }
    },

    async listEventSchools(eventId) {
      try {
        await ensureUser()
        const schoolSnaps = await getDocs(collection(db, 'events', eventId, 'schools'))
        const views: OrganizerSchoolView[] = []
        for (const schoolSnap of schoolSnaps.docs) {
          const school = asSchool(schoolSnap, eventId)
          const classSnaps = await getDocs(collection(db, 'events', eventId, 'schools', school.id, 'classes'))
          const classes = await Promise.all(
            classSnaps.docs.map(async (classSnap) => {
              const classInfo = asClass(classSnap, eventId, school.id)
              const participantSnaps = await getDocs(collection(db, 'events', eventId, 'schools', school.id, 'classes', classInfo.id, 'participants'))
              const boardSnaps = await getDocs(collection(db, 'events', eventId, 'schools', school.id, 'classes', classInfo.id, 'board'))
              const participants = participantSnaps.docs.map((snap) => asParticipant(snap, { eventId, schoolId: school.id, classId: classInfo.id }))
              return {
                classInfo,
                participantCount: participants.length,
                approvedCount: participants.filter((participant) => participant.status === 'approved').length,
                submittedCount: boardSnaps.size,
              }
            }),
          )
          views.push({ school, classes })
        }
        return views
      } catch (error) {
        return mapError(error)
      }
    },

    async resetTeacherCode(path) {
      try {
        await ensureUser()
        const school = await readFullSchool(path)
        const nextCode = await getUniqueCode(newTeacherCode, 'teacherCodes')
        const batch = writeBatch(db)
        batch.update(schoolRef(path), { teacherCode: nextCode })
        batch.set(doc(db, 'teacherCodes', nextCode), clean({
          eventId: path.eventId,
          schoolId: path.schoolId,
          schoolName: school.name,
          state: school.state,
          zone: school.zone,
          createdAt: serverTimestamp(),
        }))
        if (school.teacherCode) batch.delete(doc(db, 'teacherCodes', school.teacherCode))
        await batch.commit()
        return nextCode
      } catch (error) {
        return mapError(error)
      }
    },

    async getEventStats(eventId) {
      try {
        await ensureUser()
        const eventSnap = await getDoc(eventRef(eventId))
        if (!eventSnap.exists()) throw new Error('EVENT_NOT_FOUND')
        const schoolSnaps = await getDocs(collection(db, 'events', eventId, 'schools'))
        let classCount = 0
        let participantCount = 0
        let attemptCount = 0
        for (const schoolSnap of schoolSnaps.docs) {
          const classSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolSnap.id, 'classes'))
          classCount += classSnaps.size
          for (const classSnap of classSnaps.docs) {
            const participantSnaps = await getDocs(collection(db, 'events', eventId, 'schools', schoolSnap.id, 'classes', classSnap.id, 'participants'))
            participantCount += participantSnaps.size
            for (const participantSnap of participantSnaps.docs) {
              const attemptSnaps = await getDocs(
                collection(db, 'events', eventId, 'schools', schoolSnap.id, 'classes', classSnap.id, 'participants', participantSnap.id, 'attempts'),
              )
              attemptCount += attemptSnaps.size
            }
          }
        }
        const stats: EventStats = {
          event: asEvent(eventSnap),
          schoolCount: schoolSnaps.size,
          classCount,
          participantCount,
          attemptCount,
        }
        return stats
      } catch (error) {
        return mapError(error)
      }
    },

    async createAdminInvite() {
      try {
        const uid = await ensureUser()
        const code = await getUniqueCode(newInviteCode, 'adminInvites')
        await setDoc(doc(db, 'adminInvites', code), {
          createdBy: uid,
          usedBy: null,
          createdAt: serverTimestamp(),
        })
        return code
      } catch (error) {
        return mapError(error)
      }
    },

    async validateAdminInvite(code) {
      try {
        await ensureUser()
        const snap = await getDoc(doc(db, 'adminInvites', normalizeCode(code)))
        if (!snap.exists() || snap.data().usedBy !== null) throw new Error('INVITE_NOT_FOUND')
      } catch (error) {
        return mapError(error)
      }
    },

    async redeemAdminInvite(code) {
      try {
        const uid = await ensureUser()
        const normalized = normalizeCode(code)
        const inviteSnap = await getDoc(doc(db, 'adminInvites', normalized))
        if (!inviteSnap.exists() || inviteSnap.data().usedBy !== null) throw new Error('INVITE_NOT_FOUND')
        const batch = writeBatch(db)
        batch.update(doc(db, 'adminInvites', normalized), { usedBy: uid })
        batch.set(doc(db, 'roles', uid), clean({
          role: 'admin',
          email: auth.currentUser?.email ?? undefined,
          inviteCode: normalized,
          createdAt: serverTimestamp(),
        }))
        await batch.commit()
      } catch (error) {
        return mapError(error)
      }
    },

    async listRoles() {
      try {
        await ensureUser()
        const snaps = await getDocs(collection(db, 'roles'))
        return snaps.docs.map(asRole)
      } catch (error) {
        return mapError(error)
      }
    },

    async revokeRole(uid) {
      try {
        await ensureUser()
        await deleteDoc(doc(db, 'roles', uid))
      } catch (error) {
        return mapError(error)
      }
    },

    async withdraw(path) {
      try {
        const uid = await ensureUser()
        const participant = await readParticipant(path)
        if (participant.ownerUid !== uid) throw new Error('FORBIDDEN')
        if (participant.status === 'withdrawn') return
        if (participant.status === 'rejected') throw new Error('REJECTED')
        const nextHistory = [...participant.statusHistory, { status: 'withdrawn' as ParticipantStatus, at: nowIso(), by: uid }]
        const batch = writeBatch(db)
        batch.update(participantRef(path), {
          status: 'withdrawn',
          statusHistory: nextHistory.map((x) => ({ ...x, at: toTimestamp(x.at) })),
        })
        const boardSnap = await getDoc(boardRef(path))
        if (boardSnap.exists()) batch.update(boardRef(path), { status: 'withdrawn' })
        await batch.commit()
      } catch (error) {
        return mapError(error)
      }
    },
    async getLeaderboardByPath(path, opts) {
      try {
        await assertClassConsoleAccess(path)
        return await readLeaderboardForClass(path, opts)
      } catch (error) {
        return mapError(error)
      }
    },
    async resetJoinCode(path) {
      try {
        await ensureUser()
        const [classSnap, schoolSnap] = await Promise.all([getDoc(classRef(path)), getDoc(schoolRef(path))])
        if (!classSnap.exists()) throw new Error('CLASS_NOT_FOUND')
        if (!schoolSnap.exists()) throw new Error('SCHOOL_NOT_FOUND')
        const classInfo = asClass(classSnap, path.eventId, path.schoolId)
        const school = asSchool(schoolSnap, path.eventId)
        const nextCode = await getUniqueCode(newJoinCode, 'joinCodes')
        const batch = writeBatch(db)
        batch.set(doc(db, 'joinCodes', nextCode), clean({
          eventId: path.eventId,
          schoolId: path.schoolId,
          classId: path.classId,
          schoolName: school.name,
          className: classInfo.name,
          state: school.state,
          zone: school.zone,
          createdAt: serverTimestamp(),
        }))
        batch.update(classRef(path), { joinCode: nextCode })
        if (classInfo.joinCode) batch.delete(doc(db, 'joinCodes', classInfo.joinCode))
        await batch.commit()
        return nextCode
      } catch (error) {
        return mapError(error)
      }
    },
    async setJoinActive(path, active) {
      try {
        await ensureUser()
        await updateDoc(classRef(path), { joinActive: active })
      } catch (error) {
        return mapError(error)
      }
    },

    async addClass(path, name, grade) {
      try {
        await ensureUser()
        const trimmedName = name.trim()
        if (!trimmedName) throw new Error('INVALID_CLASS_NAME')
        const schoolSnap = await getDoc(schoolRef(path))
        if (!schoolSnap.exists()) throw new Error('SCHOOL_NOT_FOUND')
        const school = asSchool(schoolSnap, path.eventId)
        if (grade !== undefined && (!school.level || !GRADES_BY_LEVEL[school.level].includes(grade))) throw new Error('INVALID_GRADE')
        const classSnaps = await getDocs(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes'))
        if (classSnaps.docs.some((snap) => String(snap.data().name).trim() === trimmedName)) throw new Error('DUPLICATE_CLASS')

        const classDoc = doc(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'classes'))
        const joinCode = await getUniqueCode(newJoinCode, 'joinCodes')
        const classInfo: ClassDoc = {
          id: classDoc.id,
          eventId: path.eventId,
          schoolId: path.schoolId,
          name: trimmedName,
          grade,
          joinCode,
          joinActive: true,
          createdAt: nowIso(),
        }
        const batch = writeBatch(db)
        batch.set(classDoc, clean({ ...classInfo, createdAt: serverTimestamp() }))
        batch.set(doc(db, 'joinCodes', joinCode), clean({
          eventId: path.eventId,
          schoolId: path.schoolId,
          classId: classInfo.id,
          schoolName: school.name,
          className: classInfo.name,
          state: school.state,
          zone: school.zone,
          createdAt: serverTimestamp(),
        }))
        await batch.commit()
        return classInfo
      } catch (error) {
        return mapError(error)
      }
    },
    async setSchoolLevel(path, level) {
      try {
        await ensureUser()
        await updateDoc(schoolRef(path), { level })
      } catch (error) {
        return mapError(error)
      }
    },
    async listSchoolTeachers(path) {
      try {
        await ensureUser()
        const snaps = await getDocs(collection(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers'))
        return snaps.docs.map(asTeacherBinding).sort((a, b) => a.boundAt.localeCompare(b.boundAt))
      } catch (error) {
        return mapError(error)
      }
    },
    async revokeTeacherBinding(path, uid) {
      try {
        await ensureUser()
        const batch = writeBatch(db)
        batch.delete(doc(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers', uid))
        batch.update(doc(db, 'roles', uid), { schoolPaths: arrayRemove(path) })
        await batch.commit()
      } catch (error) {
        return mapError(error)
      }
    },
    async listAdminInvites() {
      try {
        await ensureUser()
        const snaps = await getDocs(collection(db, 'adminInvites'))
        return snaps.docs.map(asAdminInvite).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      } catch (error) {
        return mapError(error)
      }
    },
    async deleteAdminInvite(code) {
      try {
        await ensureUser()
        await deleteDoc(doc(db, 'adminInvites', normalizeCode(code)))
      } catch (error) {
        return mapError(error)
      }
    },
    async deleteMyAccount() {
      try {
        await auth.authStateReady()
        const user = auth.currentUser
        if (!user || user.isAnonymous) throw new Error('FORBIDDEN')
        const roleSnap = await getDoc(doc(db, 'roles', user.uid))
        const batch = writeBatch(db)
        if (roleSnap.exists()) {
          const role = roleSnap.data() as RoleWithSchools
          const schoolPaths = role.schoolPaths ?? (role.eventId && role.schoolId ? [{ eventId: role.eventId, schoolId: role.schoolId }] : [])
          for (const path of schoolPaths) {
            batch.delete(doc(db, 'events', path.eventId, 'schools', path.schoolId, 'teachers', user.uid))
          }
          batch.delete(doc(db, 'roles', user.uid))
        }
        await batch.commit()
        await deleteUser(user)
      } catch (error) {
        return mapError(error)
      }
    },

    async getMyRole() {
      try {
        const user = auth.currentUser
        if (!user || user.isAnonymous) return null
        const snap = await getDoc(doc(db, 'roles', user.uid))
        if (!snap.exists()) return null
        const role = asRole(snap)
        if (!role.email && user.email) {
          await updateDoc(doc(db, 'roles', user.uid), { email: user.email })
          return { ...role, email: user.email }
        }
        return role
      } catch (error) {
        return mapError(error)
      }
    },
  }
}
