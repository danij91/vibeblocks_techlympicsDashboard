# Techlympics 운영자(Admin) 사용 안내 / Admin User Guide

> 대상: 대회 주최측 운영자(admin 역할) / For competition organizers with the **admin** role.
> 접속 주소 / URL: **https://vibeblocks.co/techlympics**

---

## 한국어 안내

### 1. 처음 시작하기 — 계정과 권한

1. 운영 총괄(master)에게 **운영자 초대코드**(`V-`로 시작, 10자)를 받습니다.
2. https://vibeblocks.co/techlympics 에 접속해 **로그인**합니다 (Google 계정 또는 이메일/비밀번호).
3. 아직 역할이 없는 계정이라면 로그인 후 안내 화면이 나옵니다. **초대코드 입력**란에 받은 `V-` 코드를 넣으면 운영자 권한이 부여되고, 이후부터는 로그인하면 바로 **운영자 콘솔(`/admin`)**로 이동합니다.
- 화면 오른쪽 위에서 **언어(English / Bahasa Melayu)** 를 전환할 수 있습니다.

### 2. 운영자 콘솔 한눈에 보기 — 탭 4개

| 탭 | 하는 일 |
|---|---|
| **Events** | 대회(이벤트) 만들기·수정, 기간·시도 횟수 설정, 동결(Freeze), 현황 통계 |
| **Import** | 학교 등록 — 한 곳씩 추가 또는 엑셀 일괄 업로드 |
| **Schools** | 학교·학급 관리 — 교사코드 확인/재발급, 학급 추가, 학급 랭킹 보기 |
| **Participants** | 등록된 전체 학생 조회 (학교·학년·이름 필터) |

### 3. Events — 대회 설정

- **New** 버튼으로 새 대회를 만들고, 폼에서 선택한 대회를 수정합니다.
- **기간(시작~종료)**: 학생 기록 **제출은 대회 기간 안에서만** 가능합니다. 학급 **참가(가입)는 기간과 무관**하게 언제든 가능합니다.
- **도전당 시도 횟수**: 숫자를 비우면(무제한 체크) 횟수 제한이 없습니다. 시도 횟수는 도전 종목별로 따로 계산됩니다.
- **동결(Freeze)**: 누르는 즉시 모든 제출이 차단됩니다(비상 정지·시상 직전 잠금용). Unfreeze로 해제합니다.
- 상단 통계 패널에서 학교·학급·참가자·제출 수를 확인합니다.

### 4. Import — 학교 등록

- **한 곳씩 추가**: 학교 이름 + 주(State, 드롭다운) + 등급(초등 Sekolah Rendah / 중등 Sekolah Menengah)을 입력합니다.
- **엑셀 일괄 등록**: 샘플 파일을 내려받아 양식을 맞춘 뒤 업로드 → 컬럼 매핑 확인 → 미리보기에서 행을 선택해 가져오기 → 결과(성공/건너뜀)를 다운로드해 확인합니다. 중복 행은 자동으로 건너뜁니다.
- 학급 추가는 여기가 아니라 **Schools 탭의 각 학교 행**에서 합니다.

### 5. Schools — 학교·학급·교사코드

- 학교 행을 펼치면 학급 목록·교사 목록이 보입니다.
- **교사코드(`T-`로 시작, 8자)**: 학교당 1개. 복사해서 **그 학교 선생님에게만** 전달하세요 — 선생님은 이 코드로 가입해 자기 학교에 연결됩니다. **학생에게 주는 코드가 아닙니다.**
- **교사코드 재발급(Reset)**: 코드가 유출됐을 때 사용합니다. 재발급 즉시 옛 코드는 무효가 되고, 이미 연결된 선생님 계정은 영향이 없습니다.
- **교사 연결 해지(Revoke)**: 잘못 연결된 교사 계정의 학교 연결을 끊습니다.
- **학급 추가**: 학교 등급에 맞는 학년(Standard 1–6 / Form 1–5)을 골라 만듭니다.
- **학급 랭킹 보기**: 학급별 리더보드를 바로 확인합니다. 정렬은 완료한 종목 수 ↓ → 완료 종목 평균 시간 ↑ 순이고, 아직 기록이 없는 학생도 맨 아래에 표시됩니다.
- ⚠️ 학생이 쓰는 **학급 참가코드(6자)는 운영자 콘솔에 표시되지 않습니다.** 참가코드 안내·재발급·QR은 각 학교 **선생님이 교사 콘솔에서** 처리합니다.

### 6. Participants — 참가자 조회

- 등록된 전체 학생을 학교·학년·이름으로 필터해 확인합니다.

### 7. 계정 관리

- 오른쪽 위 계정 메뉴: **비밀번호 변경**(현재 비밀번호로 재인증 후 변경), **로그아웃**, **계정 삭제**.
- 비밀번호를 잊었으면 로그인 화면의 **비밀번호 재설정 메일**을 이용하세요.

### 8. 자주 묻는 것

| 상황 | 답 |
|---|---|
| 선생님이 가입을 못 해요 | Schools 탭에서 그 학교의 교사코드를 복사해 다시 전달하세요. 코드를 Reset 했다면 새 코드를 보내야 합니다. |
| 학생 참가코드를 알려달라고 해요 | 운영자 콘솔엔 없습니다 — 해당 학교 선생님에게 안내하세요. |
| 제출을 급히 막아야 해요 | Events 탭에서 해당 대회를 **Freeze** 하세요. 즉시 차단됩니다. |
| 기간이 지났는데 제출이 안 돼요 | 정상입니다 — 제출은 대회 기간 내에서만 가능합니다. 필요하면 기간을 수정하세요. |

---

## English Guide

### 1. Getting started — account & access

1. Get an **admin invite code** (starts with `V-`, 10 characters) from the platform master.
2. Go to https://vibeblocks.co/techlympics and **sign in** (Google account or email/password).
3. If your account has no role yet, a landing screen appears after sign-in. Enter your `V-` code in the **invite code** field — your account becomes an admin, and from then on signing in takes you straight to the **Admin Console (`/admin`)**.
- You can switch the language (**English / Bahasa Melayu**) at the top right.

### 2. Admin Console at a glance — four tabs

| Tab | What it does |
|---|---|
| **Events** | Create/edit events, set period & attempt limits, freeze, view stats |
| **Import** | Register schools — one at a time or via Excel upload |
| **Schools** | Manage schools & classes — teacher codes, add classes, view class rankings |
| **Participants** | Browse all registered students (filter by school, grade, name) |

### 3. Events

- Use **New** to create an event; the form edits the currently selected event.
- **Period (start–end)**: students can **submit records only during the event period**. **Joining a class is allowed anytime**, regardless of the period.
- **Attempts per challenge**: leave unlimited or set a number. Attempts are counted per challenge.
- **Freeze**: instantly blocks all submissions (emergency stop / lock before awards). Use Unfreeze to resume.
- The stats panel shows school / class / participant / submission counts.

### 4. Import — registering schools

- **Add one school**: school name + state (dropdown) + level (Primary — Sekolah Rendah / Secondary — Sekolah Menengah).
- **Excel bulk import**: download the sample file, fill it in, upload → check the column mapping → select rows in the preview and import → download the result (imported/skipped). Duplicate rows are skipped automatically.
- Classes are added not here but **from each school row in the Schools tab**.

### 5. Schools — schools, classes, teacher codes

- Expand a school row to see its classes and teachers.
- **Teacher code (`T-`, 8 characters)**: one per school. Copy it and give it **only to that school's teachers** — they sign up with it and get bound to the school. **It is not a student code.**
- **Reset teacher code**: use when a code has leaked. The old code becomes invalid immediately; already-bound teacher accounts are unaffected.
- **Revoke a teacher binding**: disconnects a wrongly bound teacher account from the school.
- **Add a class**: pick the grade matching the school level (Standard 1–6 / Form 1–5).
- **View ranking**: opens the class leaderboard. Sorting: more completed challenges first → lower average time on completed ones → earlier update. Students with no record yet are listed at the bottom.
- ⚠️ The student **join code (6 characters) is not shown in the admin console.** Join codes, resets, and QR sharing are handled by each school's **teacher in the Teacher Console**.

### 6. Participants

- Browse every registered student, filtered by school, grade, or name.

### 7. Account management

- Account menu (top right): **Change password** (re-authenticate with your current password), **Sign out**, **Delete account**.
- Forgot your password? Use **password reset email** on the sign-in screen.

### 8. FAQ

| Situation | Answer |
|---|---|
| A teacher can't sign up | Copy the school's teacher code from the Schools tab and send it again. If you reset the code, send the new one. |
| Someone asks for a student join code | It's not in the admin console — refer them to the school's teacher. |
| Submissions must stop right now | **Freeze** the event in the Events tab. It blocks immediately. |
| Submissions fail after the end date | Expected — submissions only work during the event period. Edit the period if needed. |
