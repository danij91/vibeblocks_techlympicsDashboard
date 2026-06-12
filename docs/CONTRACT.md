# vb-116 공유 계약 (CONTRACT) — v6 (2026-06-12 3차 개정)

> **v6 변경 (학교 등급·학년 — vib-318):**
> A. **SchoolLevel 도입** (말레이시아 체계): `primary`=Sekolah Rendah(Standard/Tahun 1-6) / `secondary`=Sekolah Menengah(Form/Tingkatan 1-5). `SchoolDoc.level?` — 신규 생성(단건 추가·벌크 import)은 입력, legacy 학교는 admin이 Schools 표 Level 셀에서 후설정. **teacher는 등급 변경 불가** (import된 학교에 교사코드로 가입만) — 학교명 아래 등급 표시만.
> B. **ClassDoc.grade?** — 학급 학년(숫자). 생성 시 school.level 기준 선택지(Standard 1-6 / Form 1-5). 표시 라벨은 level 기반(`lib/grade.ts` formatGrade). 학년 필터는 grade 필드 우선, 없으면 학급명 앞자리 파싱(legacy). level 미설정 학교는 학년 선택 비활성(주최측 문의 안내).
> C. api: `addClass(s, name, grade?)` / `setSchoolLevel(s, level)`(admin/master 전용). `ImportRow.level?` — import 셀 자유표기(primary/rendah·secondary/menengah) 파싱.
> D. rules: school keys에 `level`(enum 검증, admin write 경로만). class keys에 `grade`(int 1-6).
> E. v4-E("grade 입력 폐지")는 **앱 참가자 grade** 한정 — 학급 grade는 본 개정으로 정식 모델.
> F. **`deleteEvent(eventId)`** (admin/master): 이벤트 연쇄 삭제 — 학교(teachers)·학급(board·participants·attempts)·joinCodes/teacherCodes 매핑까지 클라이언트 배치 삭제(Spark, 400/batch). rules: events/schools/classes/participants/attempts delete = isAdmin() (attempts 개별 조작 금지는 운영 규율). UI = Events 탭 danger 버튼 + 카운트 명시 ConfirmModal.
> G. **admin 가입 = 같은 코드 입력칸** — TeacherCodeGate가 `classifyCode`로 분기: V-초대코드면 (로그인 상태) 즉시 redeem / (비로그인) 가입 후 redeem → /admin. **admin 진입은 어디에도 별도 노출 안 함** — RoleLanding의 "Admin invite" 선택지 제거, 설명 텍스트도 중립화. api 추가: `validateAdminInvite(code)`(가입 전 코드 검증, 무인증). `onBound(role)`로 콜러가 /teacher·/admin 분기.

> **v4 변경:**
> A. **랭킹 정렬 v4** (`scoring.ts`): 완료 종목 수 내림차순 → 완료분 평균 오름차순 → 갱신시각. **미시도 포함 전원 표시** (완료 0 = rank '-', 최하단). LeaderboardRow에 `completedCount` 추가. 무순위제(3개 미완) 폐지.
> B. api 추가: `addClass`(admin+해당교 teacher) / `listSchoolTeachers`·`revokeTeacherBinding` / `listAdminInvites`·`deleteAdminInvite` / `deleteMyAccount`. mock 구현 완료, firestore = NOT_IMPLEMENTED_V4 스텁(api-rules-v4 담당).
> C. **email 기록**: bindTeacherSchool·redeemAdminInvite·roles 생성 시 본인 email 저장(+기존 계정 다음 로그인 백필) — Users 화면 표시용.
> D. 복원 로직: 거절(rejected)·탈퇴(withdrawn) 참가는 자동 복원 대상에서 제외 — 최신 유효 참가 우선, 없으면 신규 가입 흐름.
> E. grade 입력 폐지(앱) — 학급명이 학년 정보. 비번 재설정(sendPasswordResetEmail)·계정 탈퇴 동선 추가.

> **이 문서가 모든 task의 단일 진실원.** 여기 어긋나는 구현이 버그다.
> 기획 원문: HQ `_ops/projects/vb-116-fc1-competition-platform.md`
> v2 변경: 역할 재정립(teacher/admin/master) · 3도전 시간 랭킹 · EN+BM.
>
> **v3 (2026-06-12) 변경:**
> ① **웹에서 학급코드 입력 없음** — 랭킹은 콘솔 전용 (teacher: 학급→랭킹 / admin: 학교→학급→랭킹, `getLeaderboardByPath`). 공개 랭킹 `/r` 제거, `/join`은 앱 안내 랜딩만. **"school code"라는 표현·개념 금지** — teacher code로 통일.
> ② 첫화면 = **로그인/가입 선택 분기**. 가입은 교사코드 게이트 통과 후에만 — 코드 입력 후 화면엔 가입 UI만(sign in 금지).
> ③ `withdrawn` 상태 — 탈퇴(기록·시도 보존, 랭킹·보드 제외). `joinClass`가 같은 ownerUid 기존 참가를 부활 처리(시도 비충전).
> ④ `attemptsPerChallenge: null` = 무제한.
> ⑤ 시도는 이벤트 기간 `[startsAt, endsAt]` 내에만 (`EVENT_NOT_OPEN`) — **참가(join)는 기간 무관**, frozen만 차단.
> ⑥ joinCode 리셋/비활성 (`resetJoinCode`/`setJoinActive`) — 학급·참가자·기록 불변, 옛 코드 즉시 무효 / 비활성은 신규 참가만 차단(`JOIN_DISABLED`).
> ⑦ admin 콘솔에 joinCode **비노출** (교사·학생 영역). admin은 교사코드 발급·전달만.
> ⑧ 공용 토스트 `src/lib/toast.tsx`(Claude 소유) — 상태 변경 액션은 토스트 피드백 필수.

## §0. 변경 규칙

- 이 문서·`src/api/types.ts`·`src/api/index.ts`(시그니처)·`src/api/codes.ts`(포맷)·`src/api/scoring.ts`·`App.tsx`(라우트)·`package.json` = **Claude 소유**. 변경 필요하면 카드 LOG에 요청.
- `AttemptMetrics`는 PROVISIONAL — 필드 추가 허용, 삭제·의미 변경은 Claude 경유.

## §R. 역할 (v2 재정립 — DB·코드·rules 전부 이 값)

| role 값 | 누구 | 콘솔 | 비고 |
|---|---|---|---|
| `teacher` | 선생님 | `/teacher` | 교사코드 게이트 가입, 학교 바인딩 |
| `admin` | **주최측** (외부 파트너) | `/admin` | master가 초대코드 발급 |
| `master` | 회사(희용·HQ) | `/master` | 어디에도 링크 없는 경로. 시드 1회 |

권한 포함관계: master ⊇ admin ⊇ (teacher는 바인딩 학교 한정). 리다이렉트 우선순위 master > admin > teacher. **익명 세션은 "로그인"으로 취급하지 않는다.**

## §1. Firestore 경로 (v2)

```
events/{eventId}                      기간·challenges[3]·attemptsPerChallenge·visibility·scoringVersion·frozen
  schools/{schoolId}                  이름·state·zone·teacherCode
    teachers/{uid}                    교사 바인딩 {code, boundAt}
    classes/{classId}                 이름·joinCode
      board/{participantId}           리더보드 비정규화 (BoardEntryDoc — bests: slot→BoardBest)
      participants/{participantId}    ParticipantDoc
        attempts/{pid}_{slot}_{n}     AttemptDoc (create-only) — 슬롯별 상한 물리 강제
joinCodes/{CODE} · teacherCodes/{T-CODE} · recoveryCodes/{sha256}(+claims/{uid})
adminInvites/{V-CODE}                 {createdBy, usedBy: null|uid}   ← 구 organizerInvites
roles/{uid}                           {role: teacher|admin|master, ...}
```

시각 필드 = Timestamp 저장, api 경계 ISO 변환. 문서 ID = 자동 ID(경로=capability).

## §2. 코드 포맷 — v1과 동일 (`codes.ts`)

학급 6자 / 교사 `T-`8 / 복구 `R-`12 / publicId `P-`4 / 초대 `V-`10. 알파벳 0/O/1/I/L 제외. `classifyCode()`로 한 입력칸 자동 분기.

## §3. capability 패턴 — v1과 동일

코드 → 매핑 문서 get(list 금지) → 본체 경로. `/r/:joinCode`는 코드 노출 의도된 동작.

## §4. 무결성 invariants (rules가 보장)

1. attempt ID `{pid}_{slot}_{n}` + create-only → **슬롯당** attemptsPerChallenge 초과 물리 불가 (slot ∈ c1/c2/c3)
2. `eventOpen()`: frozen·마감 후 participant/attempt 생성 거부
3. attempt·participant 생성 = ownerUid 본인만
4. board entry: 본인 것만 + **bests의 각 슬롯이 실제 attempt 원본과 일치** (`bests[s].metrics == attempts/{pid}_{s}_{bests[s].attemptNo}.metrics`, timeSec == metrics.averageTimeSec, 성공 런만)
5. ownerUid 재바인딩 = recovery claims 증명, 타 필드 불변
6. 교사 바인딩 = code == school.teacherCode
7. rejected는 attempt 생성 불가 (기록 보존)
8. 학생은 타인 participant/attempt 읽기 불가 — 공개 표면은 board뿐
9. roles 생성: master만 (또는 adminInvite redeem으로 본인 admin 등록). master 문서는 콘솔 시드 전용 — rules로 생성 불가

## §5. CompetitionApi v2 (`src/api/index.ts` 전문 참조)

- **§5.1 학생**: `getClassByJoinCode` / `joinClass` / `resumeParticipant` / **`submitAttempt(p, slot, metrics)`** / `getLeaderboard` / **`getMyProgress`**. 앱은 이 계약 그대로 vendor 사용.
- **§5.2 교사**: v1과 동일 6종.
- **§5.3 주최측(admin)**: `listEvents`/`createEvent`(challenges·attemptsPerChallenge)/`updateEvent`/`importSchools`/`listEventSchools`/`resetTeacherCode`/`getEventStats`
- **§5.4 master**: `createAdminInvite` / `redeemAdminInvite`(역할없는 로그인 사용자가 호출) / `listRoles` / `revokeRole`
- 에러코드: v1 동일 + `NO_ATTEMPTS_LEFT`는 슬롯 단위.

## §6. 기록·랭킹 v2 (`scoring.ts`)

- 유효 기록 = `successRate === 1 && averageTimeSec !== null`. 실패 런 = 시도만 소모.
- 도전당 기록 = 유효 기록 중 **최소 시간** (`isBetter`).
- **랭킹 = 3개 도전 최고기록의 평균, 오름차순** (`averageSec`·`compareEntries`). 동률 = 갱신시각 빠른 순.
- **3개 미완 = 무순위(rank null)** — 표 하단에 기록만 표시.
- 점수·별점 공식 폐기 (raw 보존이라 복원 가능). scoringVersion = 'v2'.

## §7. 웹 라우트·소유권 (v2 run)

| 라우트 | 파일 범위 | task |
|---|---|---|
| `/` (로그인+코드 진입), 역할 리다이렉트, 역할없음 랜딩(교사코드/초대코드/랭킹 3택), 로그아웃 헤더 | `pages/HomePage.tsx` `pages/AdminConsolePage.tsx` `pages/MasterConsolePage.tsx` `features/auth/**` `features/organizer/**` | vb-116-web-entry-auth |
| `/r/:joinCode` `/join/:joinCode` — 도전별 컬럼+평균 랭킹 | `pages/RankingPage.tsx` `features/ranking/**` | vb-116-web-ranking-v2 |
| (api·rules·시드 v3) | `src/api/firestore.ts`(v3 스텁 4종 실구현 + 기간·무제한·withdrawn·joinActive) `firestore.rules` `firestore.indexes.json` `scripts/**` | vb-116-api-rules-v3 |
| `/teacher/*` | (v2 run에서 동결 — 임시 호환 패치 상태 유지) | — |

공용(App.tsx·lib/·index.css·package.json) = Claude 소유. 제공 deps: react-router-dom, firebase, qrcode.react, xlsx.

## §7a. 앱 소유권 (v2 run)

| 영역 | 파일 범위 | task |
|---|---|---|
| Techlympics 화면 교체(학생 전용·3도전 카드·제출) + vendored api v2 동기화 | `src/features/fc1/pages/TechlympicsPage.tsx` `src/features/fc1/competition/**` (qr/ 제외) | vb-116-app-techlympics |
| QR 스캐너·딥링크(pendingJoinCode) + 네이티브 설정 | `src/features/fc1/competition/qr/**` + ios/android 설정 | vb-116-app-qr-link |

**cross-card 인터페이스**: qr 모듈이 `competition/qr/pending.ts`로 `setPendingJoinCode/consumePendingJoinCode` 제공(소유=qr task) — techlympics task는 import만. UserSandbox 등 공유 파일 후킹은 통합 시 Claude.

## §8. mock (`src/api/mock.ts` v2)

시드: 도전 3(미션 201/202/203), `KEDAH7` 보드 — 완주 2명(랭킹)·부분 2명(무순위). 교사 `T-KEDAH234`. 콘솔 `__mockRole('teacher'|'admin'|'master'|null)`.

## §9. 결정 로그 (v2 확정)

전국/학교 랭킹 **안 만듦** / 언어 **EN+BM + 전환 버튼**(localStorage, 인쇄물 병기 — i18n은 wave 2 단독 task) / 도메인 = 배포 전 희용 통보 / QR UX = 코드 자동입력+**커서 다음 칸**, 로그인 게이트 통과 시에도 pendingJoinCode 유지, 미설치 폴백 = 웹 `/join` "설치 후 재스캔" 안내.
