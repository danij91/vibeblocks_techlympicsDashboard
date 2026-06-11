// ============================================================
// vb-116 도메인 타입 — 단일 진실원. 변경은 Claude 승인 경유 (CONTRACT.md §0)
// Firestore 저장 시 *At 필드는 Timestamp, api 경계에서는 ISO string.
// ============================================================

export type Role = 'teacher' | 'organizer' | 'admin'
export type ParticipantStatus = 'pending' | 'approved' | 'rejected' // 가등록/등록/거절
export type Visibility = 'code-only' | 'public-masked' | 'public' // v1 = code-only 고정
export type SolveMode = 'ai' | 'block'

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
  maxAttempts: number // 기본 3
  visibility: Visibility
  scoringVersion: string // 'v1'
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

// PROVISIONAL — 측정 항목은 Monday 확정 전. 필드 추가 허용(맵 그대로 저장).
export interface AttemptMetrics {
  missionId: string
  environment: string
  solveMode: SolveMode
  successRate: number // 0..1
  averageTimeSec: number | null // 1회 이상 실패 시 null
  stars: number // 0..5
  blockCount: number
}

export interface AttemptDoc {
  id: string // `${participantId}_${attemptNo}` — create-only로 시도 상한 강제
  attemptNo: number // 1..event.maxAttempts
  metrics: AttemptMetrics
  submittedAt: string
}

// 학급 리더보드 비정규화 entry — classes/{classId}/board/{participantId}
// rules가 metrics == 해당 attempt 원본 일치를 강제 (위변조 방지, CONTRACT §4)
export interface BoardEntryDoc {
  participantId: string
  publicId: string
  name: string
  status: ParticipantStatus
  bestAttemptNo: number
  metrics: AttemptMetrics
  updatedAt: string
}

export interface RoleDoc {
  uid: string
  role: Role
  email?: string
  inviteCode?: string // organizer 초대코드 redeem 시
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
  attemptNo: number
  remaining: number
}

export interface LeaderboardRow {
  rank: number | null // 미제출 = null
  publicId: string
  name: string
  status: ParticipantStatus
  score: number | null // computeScore(metrics) — 표시 시점 계산
  metrics: AttemptMetrics | null
  attemptsUsed: number
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
  schools: SchoolDoc[] // 신규+기존 매칭 포함
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
