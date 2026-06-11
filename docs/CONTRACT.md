# vb-116 공유 계약 (CONTRACT) — Phase 0 확정본

> **이 문서가 5개 task의 단일 진실원.** 여기 어긋나는 구현이 버그다.
> 기획 원문: HQ `_ops/projects/vb-116-fc1-competition-platform.md`

## §0. 변경 규칙

- 이 문서·`src/api/types.ts`·`src/api/index.ts`(시그니처)·`src/api/codes.ts`(포맷)·`App.tsx`(라우트)·`package.json` = **Claude 소유**. 변경 필요하면 카드 LOG에 요청을 남기고 진행하지 말 것.
- `AttemptMetrics`는 PROVISIONAL — 필드 추가는 허용(맵 저장), 삭제·의미 변경은 Claude 경유.

## §1. Firestore 경로

```
events/{eventId}                      기간·maxAttempts·visibility·scoringVersion·frozen
  schools/{schoolId}                  이름·state·zone·teacherCode
    teachers/{uid}                    교사 바인딩 {code, boundAt}
    classes/{classId}                 이름·joinCode
      board/{participantId}           리더보드 비정규화 (BoardEntryDoc)
      participants/{participantId}    ParticipantDoc
        attempts/{participantId}_{n}  AttemptDoc (create-only)
joinCodes/{CODE}                      → {eventId, schoolId, classId}
teacherCodes/{T-CODE}                 → {eventId, schoolId}
recoveryCodes/{sha256hex}             → {eventId, schoolId, classId, participantId}
  claims/{uid}                        기기 재바인딩 증명 {claimedAt}
organizerInvites/{V-CODE}             {createdBy, usedBy: null|uid}
roles/{uid}                           {role: teacher|organizer|admin, ...}
```

- 문서 ID(eventId 등)는 Firestore 자동 ID — **추측 불가능한 경로 = 접근 능력(capability)**.
- 시각 필드는 Firestore에 **Timestamp**로 저장, api 경계에서 ISO string 변환. (rules의 `request.time < e.endsAt` 비교 때문 — string 저장 금지)

## §2. 코드 포맷 (`src/api/codes.ts`)

| 코드 | 포맷 | 용도 |
|---|---|---|
| 학급코드 | 6자 (`K7XM3Q`) | 학생 참가 + 랭킹 조회 |
| 교사코드 | `T-` + 8자 | 교사 가입 게이트 (학교 단위) |
| 복구코드 | `R-` + 12자 | 참가 복원 (비밀) |
| publicId | `P-` + 4자 | 참가자 공개 식별 (권한 없음) |
| 초대코드 | `V-` + 10자 | organizer 초대 |

알파벳 = `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (0/O/1/I/L 제외). 입력칸 하나 → `classifyCode()`로 자동 분기.

## §3. capability 패턴

코드 → `joinCodes/{code}` 등 매핑 문서 **get** (list는 rules가 금지) → 본체 경로 획득. 경로를 모르면 도달 불가 = code-only 공개의 구현체. URL `/r/:joinCode`, `/join/:joinCode`는 코드를 그대로 노출(공유 가능, 의도된 동작).

## §4. 무결성 invariants (rules가 보장 — 어기면 firestore.rules 버그)

1. attempt는 `{participantId}_{n}` 고정 ID + create-only → maxAttempts 초과 물리 불가
2. `eventOpen()`: frozen이거나 endsAt 지나면 participant/attempt 생성 거부
3. attempt·participant 생성은 ownerUid == 본인 익명 uid만
4. board entry는 본인 것만 + `metrics == attempts/{pid}_{bestAttemptNo}.metrics` 일치 필수 (비정규화 위변조 차단)
5. ownerUid 재바인딩은 `recoveryCodes/{hash}/claims/{uid}` 존재 시에만 (코드 지식 증명), 다른 필드 변경 불가
6. 교사 바인딩 create는 제출한 code == school.teacherCode일 때만
7. rejected 참가자는 attempt 생성 불가 (기록은 보존)
8. 학생은 타인 participant/attempt 읽기 불가 — 공개 표면은 board뿐

## §5. CompetitionApi (`src/api/index.ts` — 전체 시그니처는 코드 참조)

- **§5.1 학생**: `getClassByJoinCode` / `joinClass` / `resumeParticipant` / `submitAttempt` / `getLeaderboard`. **앱(FC1)도 이 계약 그대로 사용** — 앱 task는 `types.ts`·`codes.ts`·`scoring.ts`·(완성 후)`firestore.ts`를 앱 repo로 vendor 복사 (통합 시 Claude가 동기화 책임).
- **§5.2 교사**: `validateTeacherCode`(무인증) / `bindTeacherSchool` / `listMySchools` / `listParticipants` / `setParticipantStatus` / `bulkApprove`
- **§5.3 주최측**: `listEvents` / `createEvent` / `updateEvent`(frozen 포함) / `importSchools` / `listEventSchools` / `resetTeacherCode` / `getEventStats`
- **§5.4 admin**: `createOrganizerInvite` / `redeemOrganizerInvite` / `listRoles` / `revokeRole`
- 에러는 `Error(code)` — `CLASS_NOT_FOUND` `EVENT_FROZEN` `NO_ATTEMPTS_LEFT` `RECOVERY_NOT_FOUND` `TEACHER_CODE_NOT_FOUND` `FORBIDDEN` `REJECTED` `INVITE_NOT_FOUND` `DUPLICATE_CLASS` `EMPTY_FIELD` 등. UI는 코드 기준 분기.

## §6. 점수 (PROVISIONAL — `src/api/scoring.ts`)

점수는 **저장하지 않는다**. raw `AttemptMetrics`만 저장, 표시 시점 `computeScore(m, event.scoringVersion)`.
v1 = `successRate×400 + stars×150 + max(0, 600 − averageTimeSec×4)` 반올림. 정렬 = `compareEntries`(점수↓ → 시간↑ → 제출시각↑). Monday 확정 시 버전 추가 — 과거 기록 재채점 자동.

## §7. 라우트·소유권 (웹)

| 라우트 | 파일 범위 | task |
|---|---|---|
| `/`, `/r/:joinCode`, `/join/:joinCode` | `src/pages/HomePage.tsx` `RankingPage.tsx` `src/features/ranking/**` | vb-116-web-ranking |
| `/teacher/*` | `src/pages/TeacherPage.tsx` `src/features/teacher/**` | vb-116-web-teacher |
| `/organizer/*`, `/admin/*` | `src/pages/OrganizerPage.tsx` `AdminPage.tsx` `src/features/organizer/**` | vb-116-web-organizer |
| (api·rules·시드) | `src/api/**` `firestore.rules` `firestore.indexes.json` `scripts/**` | vb-116-api-rules |

공용(`App.tsx`·`lib/`·전역 css·`package.json`) = Claude 소유. 의존성 추가 필요 시 카드 LOG 요청 (현재 제공: react-router-dom, firebase, qrcode.react, xlsx).

## §8. mock (`src/api/mock.ts`)

UI task는 `VITE_API_IMPL=mock`(기본)으로 개발. 시드: 이벤트 `Techlympics 2026 (Demo)`, 학급코드 `KEDAH7`(보드 4명) `KEDAH8` `SELFC2`, 교사코드 `T-KEDAH234` `T-SEL23456`. 콘솔 `__mockRole('teacher'|'organizer'|'admin'|null)`로 역할 전환 (mock 전용 — firestore 구현엔 없음).

## §9. 미결 (구현은 미결에 안 막히게 설계됨)

측정 항목·점수 공식 확정(Monday) / 전국·학교 랭킹 노출 / 언어(우선 EN, BM 추후) / 도메인(현재 `techlympic-7ad8c.web.app`) / App Check 도입 시점.
