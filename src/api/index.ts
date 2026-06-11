// ============================================================
// CompetitionApi — 앱·웹 공용 단일 계약 (CONTRACT.md §5)
// Spark 구조: 구현 = Firestore 직접 + rules 방어. Blaze 전환 시
// 이 인터페이스 그대로 callable 호출로 내부만 교체한다.
// 시그니처 변경은 Claude 승인 경유.
// ============================================================
import type {
  AttemptMetrics,
  ClassPath,
  EventDoc,
  EventStats,
  ImportResult,
  ImportRow,
  JoinInfo,
  JoinResult,
  LeaderboardRow,
  OrganizerSchoolView,
  ParticipantDoc,
  ParticipantPath,
  ParticipantStatus,
  ResumeResult,
  RoleDoc,
  SchoolPath,
  SubmitResult,
  TeacherSchoolView,
} from './types'
import { createMockApi } from './mock'

export interface CompetitionApi {
  // ---------- 학생 (앱이 동일 계약 사용 — CONTRACT §5.1) ----------
  /** 학급코드 검증 + 학급/학교/이벤트 정보 ("○○학교 3-2반 맞으세요?") */
  getClassByJoinCode(joinCode: string): Promise<JoinInfo>
  /** 참가 등록 — participant 생성, 복구코드 발급. 익명 인증 선행 필요 */
  joinClass(joinCode: string, profile: { name: string; grade?: string }): Promise<JoinResult>
  /** 복구코드로 기존 참가 복원 (기기 변경·재설치). ownerUid 재바인딩 포함 */
  resumeParticipant(recoveryCode: string): Promise<ResumeResult>
  /** 공식 기록 제출. 시도 상한·마감은 rules가 강제 — 초과 시 throw */
  submitAttempt(p: ParticipantPath, metrics: AttemptMetrics): Promise<SubmitResult>
  /** 학급 리더보드 (board 비정규화 문서 — 읽기 1회/행) */
  getLeaderboard(joinCode: string, opts?: { includePending?: boolean }): Promise<LeaderboardRow[]>

  // ---------- 교사 (웹 — CONTRACT §5.2) ----------
  /** 가입 게이트: 교사코드 → 학교 정보 (가입 전, 무인증 호출 가능) */
  validateTeacherCode(code: string): Promise<{ event: EventDoc; school: { id: string; name: string } }>
  /** 로그인 직후 학교 바인딩 (코드 재검증). 재호출 = 학교 추가 */
  bindTeacherSchool(code: string): Promise<SchoolPath>
  listMySchools(): Promise<TeacherSchoolView[]>
  listParticipants(c: ClassPath): Promise<ParticipantDoc[]>
  setParticipantStatus(p: ParticipantPath, status: ParticipantStatus): Promise<void>
  /** 학급 내 모든 pending → approved. 처리 건수 반환 */
  bulkApprove(c: ClassPath): Promise<number>

  // ---------- 주최측 (웹 — CONTRACT §5.3) ----------
  listEvents(): Promise<EventDoc[]>
  createEvent(input: {
    name: string
    startsAt: string
    endsAt: string
    maxAttempts?: number
  }): Promise<EventDoc>
  updateEvent(
    eventId: string,
    patch: Partial<Pick<EventDoc, 'name' | 'startsAt' | 'endsAt' | 'maxAttempts' | 'frozen' | 'visibility'>>,
  ): Promise<void>
  /** xlsx/csv 매핑 결과 일괄 등록 — 학교·학급 생성 + 코드 발급. 중복(학교명+학급명)은 skip */
  importSchools(eventId: string, rows: ImportRow[]): Promise<ImportResult>
  listEventSchools(eventId: string): Promise<OrganizerSchoolView[]>
  resetTeacherCode(s: SchoolPath): Promise<string>
  getEventStats(eventId: string): Promise<EventStats>

  // ---------- admin (웹 — CONTRACT §5.4) ----------
  createOrganizerInvite(): Promise<string>
  /** 로그인한 사용자가 초대코드 사용 → organizer 역할 획득 */
  redeemOrganizerInvite(code: string): Promise<void>
  listRoles(): Promise<RoleDoc[]>
  revokeRole(uid: string): Promise<void>

  // ---------- 공통 ----------
  /** 현재 로그인 사용자의 역할 (없으면 null) */
  getMyRole(): Promise<RoleDoc | null>
}

// 구현 스위치 — task vb-116-api-rules가 ./firestore.ts 구현 후 연결.
// mock은 UI task 병렬 개발용 (시드 데이터 내장, CONTRACT §8)
const impl = import.meta.env.VITE_API_IMPL ?? 'mock'
if (impl !== 'mock') {
  // TODO(vb-116-api-rules): import { createFirestoreApi } from './firestore'
  throw new Error(`VITE_API_IMPL=${impl} 구현 전 — vb-116-api-rules task 담당`)
}
export const api: CompetitionApi = createMockApi()
