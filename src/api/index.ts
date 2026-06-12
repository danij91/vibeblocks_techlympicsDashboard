// ============================================================
// CompetitionApi v2 — 앱·웹 공용 단일 계약 (CONTRACT.md §5)
// v2: 역할 teacher/admin/master + 3도전·시간 랭킹 (2026-06-11)
// Spark 구조: 구현 = Firestore 직접 + rules 방어. 시그니처 변경은 Claude 승인 경유.
// ============================================================
import type {
  AdminInviteDoc,
  AttemptMetrics,
  ChallengeSlot,
  ClassDoc,
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
  SchoolLevel,
  SchoolPath,
  SubmitResult,
  TeacherBinding,
  TeacherSchoolView,
} from './types'
import { createFirestoreApi } from './firestore'
import { createMockApi } from './mock'

export interface CompetitionApi {
  // ---------- 학생 (앱이 동일 계약 사용 — CONTRACT §5.1) ----------
  /** 학급코드 검증 + 학급/학교/이벤트 정보 ("○○학교 3-2반 맞으세요?") */
  getClassByJoinCode(joinCode: string): Promise<JoinInfo>
  /** 참가 등록 — participant 생성, 복구코드 발급. 익명 인증 선행 필요 */
  joinClass(joinCode: string, profile: { name: string; grade?: string }): Promise<JoinResult>
  /** 복구코드로 기존 참가 복원 (기기 변경·재설치). ownerUid 재바인딩 포함 */
  resumeParticipant(recoveryCode: string): Promise<ResumeResult>
  /** 도전 슬롯별 공식 기록 제출. 슬롯당 시도 상한·마감은 rules가 강제 — 초과 시 throw */
  submitAttempt(p: ParticipantPath, slot: ChallengeSlot, metrics: AttemptMetrics): Promise<SubmitResult>
  /** 학급 리더보드 — 도전별 최고기록 + 평균 오름차순. 앱(joinCode 기반) 전용 */
  getLeaderboard(joinCode: string, opts?: { includePending?: boolean }): Promise<LeaderboardRow[]>
  /** v3: 본인 참가 탈퇴 — status→withdrawn (기록·시도 보존, 랭킹 제외). 같은 기기 재가입 시 joinClass가 부활 처리(시도 비충전) */
  withdraw(p: ParticipantPath): Promise<void>
  /** 본인 참가 현황 (도전별 잔여 시도·최고기록) — 앱 도전 카드용 */
  getMyProgress(p: ParticipantPath): Promise<{ attemptsUsed: Record<ChallengeSlot, number>; bests: Partial<Record<ChallengeSlot, number>> }>

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
  /** v3: 콘솔용 경로 기반 리더보드 (teacher: 학급→랭킹 / admin: 학교→학급→랭킹 — joinCode 비노출) */
  getLeaderboardByPath(c: ClassPath, opts?: { includePending?: boolean }): Promise<LeaderboardRow[]>
  /** v3: 학급코드 리셋 — 새 코드 발급, 옛 코드 즉시 무효. 학급·참가자·기록 불변 */
  resetJoinCode(c: ClassPath): Promise<string>
  /** v3: 학급코드 활성/비활성 — 비활성 시 신규 참가만 차단 */
  setJoinActive(c: ClassPath, active: boolean): Promise<void>
  /** v4: 반 추가 — admin + 해당 학교 바인딩 teacher. joinCode 자동 발급. v5: grade = 학년 (school.level 기준) */
  addClass(s: SchoolPath, name: string, grade?: number): Promise<ClassDoc>
  /** v5: 학교 등급 설정 — admin/master 전용 (teacher는 등급 변경 불가, import된 학교에 코드로 가입만) */
  setSchoolLevel(s: SchoolPath, level: SchoolLevel): Promise<void>

  // ---------- 주최측 admin (웹 — CONTRACT §5.3) ----------
  listEvents(): Promise<EventDoc[]>
  createEvent(input: {
    name: string
    startsAt: string
    endsAt: string
    attemptsPerChallenge?: number | null // null = 무제한
    challenges?: { slot: ChallengeSlot; missionId: number; name: string }[]
  }): Promise<EventDoc>
  updateEvent(
    eventId: string,
    patch: Partial<Pick<EventDoc, 'name' | 'startsAt' | 'endsAt' | 'attemptsPerChallenge' | 'frozen' | 'visibility'>>,
  ): Promise<void>
  /** v6: 이벤트 삭제 — admin/master. 하위 학교·학급·참가자·기록 + joinCode/teacherCode 매핑까지 연쇄 삭제 (복구 불가) */
  deleteEvent(eventId: string): Promise<void>
  /** xlsx/csv 매핑 결과 일괄 등록 — 학교·학급 생성 + 코드 발급. 중복(학교명+학급명)은 skip */
  importSchools(eventId: string, rows: ImportRow[]): Promise<ImportResult>
  listEventSchools(eventId: string): Promise<OrganizerSchoolView[]>
  resetTeacherCode(s: SchoolPath): Promise<string>
  getEventStats(eventId: string): Promise<EventStats>
  /** v4: 학교에 바인딩된 교사 목록 (admin/master) */
  listSchoolTeachers(s: SchoolPath): Promise<TeacherBinding[]>
  /** v4: 교사 바인딩 해제 (admin/master) */
  revokeTeacherBinding(s: SchoolPath, uid: string): Promise<void>

  // ---------- master 회사 (웹 — CONTRACT §5.4) ----------
  /** master 전용: 주최측(admin) 초대코드 발급 */
  createAdminInvite(): Promise<string>
  /** 로그인 사용자가 초대코드 사용 → admin(주최측) 역할 획득 */
  redeemAdminInvite(code: string): Promise<void>
  /** v6: 초대코드 사전 검증(미사용 여부) — 가입 전 게이트용, 무인증 호출 가능 */
  validateAdminInvite(code: string): Promise<void>
  listRoles(): Promise<RoleDoc[]>
  revokeRole(uid: string): Promise<void>
  /** v4: 발급한 초대코드 목록/삭제 (master) */
  listAdminInvites(): Promise<AdminInviteDoc[]>
  deleteAdminInvite(code: string): Promise<void>
  /** v4: 본인 계정 탈퇴 — 바인딩·role 정리 후 Auth 삭제 */
  deleteMyAccount(): Promise<void>

  // ---------- 공통 ----------
  /** 현재 로그인 사용자의 역할 (없으면 null). 익명 세션은 역할 없음 취급 */
  getMyRole(): Promise<RoleDoc | null>
}

// 구현 스위치 — mock = UI 개발용 (CONTRACT §8) / firestore = 실서비스 (v2)
const impl = import.meta.env.VITE_API_IMPL ?? 'mock'
export const api: CompetitionApi = impl === 'firestore' ? createFirestoreApi() : createMockApi()
