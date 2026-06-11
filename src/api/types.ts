// ============================================================
// vb-116 도메인 타입 v2 — 단일 진실원. 변경은 Claude 승인 경유 (CONTRACT.md §0)
// v2 (2026-06-11): 역할 재정립(teacher/admin/master) + 3도전·시간 랭킹
// Firestore 저장 시 *At 필드는 Timestamp, api 경계에서는 ISO string.
// ============================================================

// teacher=교사 / admin=주최측 / master=회사(희용·HQ)
export type Role = 'teacher' | 'admin' | 'master'
export type ParticipantStatus = 'pending' | 'approved' | 'rejected' // 가등록/등록/거절
export type Visibility = 'code-only' | 'public-masked' | 'public' // v1 = code-only 고정
export type SolveMode = 'ai' | 'block'

// 도전 슬롯 — 이벤트당 3개 고정 (rules가 슬롯별 시도 상한을 물리 강제)
export type ChallengeSlot = 'c1' | 'c2' | 'c3'
export const CHALLENGE_SLOTS: ChallengeSlot[] = ['c1', 'c2', 'c3']

export interface ChallengeDef {
  slot: ChallengeSlot
  missionId: number // 앱 TECHLYMPICS_MISSIONS taskGroupId (201/202/203)
  name: string
}

// ---------- 경로 (Firestore 중첩 문서 참조용) ----------
export interface SchoolPath {
  eventId: string
  schoolId: string
}
export interface ClassPath extends SchoolPath {
  classId: string
}
export interface ParticipantPath extends ClassPath {
  participantId: string
}

// ---------- 문서 ----------
export interface EventDoc {
  id: string
  name: string
  startsAt: string
  endsAt: string
  challenges: ChallengeDef[] // 3개 고정
  attemptsPerChallenge: number // 기본 3 — 도전당 공식 시도
  visibility: Visibility
  scoringVersion: string // 'v2' = 시간 기반 (최고기록·평균 오름차순)
  frozen: boolean // true = 마감 동결 (제출 차단)
  createdAt: string
}

export interface SchoolDoc {
  id: string
  eventId: string
  name: string
  state?: string
  zone?: string
  teacherCode: string // 'T-XXXXXXXX' — 교사 가입 게이트
  createdAt: string
}

export interface ClassDoc {
  id: string
  eventId: string
  schoolId: string
  name: string
  joinCode: string // 6자 — 학생 참가 + 랭킹 조회 capability
  createdAt: string
}

export interface StatusChange {
  status: ParticipantStatus
  at: string
  by: string // actor uid
}

export interface ParticipantDoc {
  id: string
  eventId: string
  schoolId: string
  classId: string
  name: string
  grade?: string
  publicId: string // 'P-XXXX' — 공개 식별자 (권한 없음, 동명이인 구분)
  status: ParticipantStatus
  ownerUid: string // 익명 uid — 본인 기록 보호. 기기 변경 시 recovery claims로 재바인딩
  recoveryHash: string // sha256(recoveryCode)
  registeredAt: string
  statusHistory: StatusChange[]
}

// PROVISIONAL — 시뮬 측정 raw. v2 유효 기록 = successRate 1 && averageTimeSec != null
export interface AttemptMetrics {
  missionId: number
  environment: string
  solveMode: SolveMode
  successRate: number // 0..1
  averageTimeSec: number | null // 기록 시간(초). 실패 런 = null
  stars: number // 0..5 (참고 표시용 — v2 랭킹엔 미사용, raw 보존)
  blockCount: number
}

export interface AttemptDoc {
  id: string // `${participantId}_${slot}_${attemptNo}` — create-only로 슬롯별 상한 강제
  slot: ChallengeSlot
  attemptNo: number // 1..event.attemptsPerChallenge
  metrics: AttemptMetrics
  submittedAt: string
}

// 도전별 최고기록 (board 비정규화 — rules가 attempt 원본과 일치 강제)
export interface BoardBest {
  attemptNo: number
  timeSec: number // 유효 기록 시간 (= metrics.averageTimeSec, 성공 런만)
  metrics: AttemptMetrics
}

export interface BoardEntryDoc {
  participantId: string
  publicId: string
  name: string
  status: ParticipantStatus
  bests: Partial<Record<ChallengeSlot, BoardBest>>
  updatedAt: string
}

export interface RoleDoc {
  uid: string
  role: Role
  email?: string
  inviteCode?: string // admin(주최측) 초대코드 redeem 시
  createdAt: string
}

// ---------- api 반환 합성 타입 ----------
export interface JoinInfo {
  event: EventDoc
  school: SchoolDoc
  classInfo: ClassDoc
  path: ClassPath
}

export interface JoinResult extends JoinInfo {
  participant: ParticipantDoc
  recoveryCode: string // 발급 1회 노출 — 회원은 앱 user doc에 자동 저장
}

export interface ResumeResult extends JoinInfo {
  participant: ParticipantDoc
}

export interface SubmitResult {
  slot: ChallengeSlot
  attemptNo: number
  remaining: number // 해당 슬롯 잔여 시도
  isNewBest: boolean
  bestTimeSec: number | null // 해당 슬롯 현재 최고기록
}

export interface LeaderboardRow {
  rank: number | null // 3개 도전 모두 유효 기록 있어야 순위 — 아니면 null(하단 표시)
  publicId: string
  name: string
  status: ParticipantStatus
  bests: Partial<Record<ChallengeSlot, number>> // 도전별 최고기록(초)
  averageSec: number | null // 3개 평균 — 정렬 기준 (오름차순)
  attemptsUsed: Record<ChallengeSlot, number>
}

export interface TeacherSchoolView {
  event: EventDoc
  school: SchoolDoc
  classes: ClassDoc[]
}

export interface ImportRow {
  schoolName: string
  className: string
  state?: string
  zone?: string
}

export interface ImportResult {
  schools: SchoolDoc[]
  classes: ClassDoc[]
  skipped: { row: ImportRow; reason: string }[]
}

export interface ClassStats {
  classInfo: ClassDoc
  participantCount: number
  approvedCount: number
  submittedCount: number
}

export interface OrganizerSchoolView {
  school: SchoolDoc
  classes: ClassStats[]
}

export interface EventStats {
  event: EventDoc
  schoolCount: number
  classCount: number
  participantCount: number
  attemptCount: number
}
