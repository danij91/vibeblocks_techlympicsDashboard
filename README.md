# VibeBlocks Techlympics Dashboard

FC1 컴패티션 웹 — 학교/학급 랭킹 조회 + 교사 관리 + 주최측 운영. (HQ 프로젝트 vb-116)

## Stack

React + Vite + TS / Firebase Auth + Firestore (Spark, 무펑션 — rules가 무결성 전선) / Hosting.
Firebase 프로젝트: `techlympic-7ad8c` (컴패티션 전용 — 앱 본체 프로젝트와 분리).

## 실행

```bash
npm install
cp .env.example .env   # 실값은 vibeblocks-ignored-files 아카이브
npm run dev            # http://localhost:2180 (포트 2xxx 회사 표준)
npm run build          # tsc --noEmit + vite build
npm run deploy         # build + firebase deploy --only hosting
```

기본 `VITE_API_IMPL=mock` — Firestore 없이 시드 데이터로 동작. 데모 코드: 학급 `KEDAH7`, 교사 `T-KEDAH234`, 콘솔 `__mockRole('organizer')`.

## 구조 (소유권 = docs/CONTRACT.md §7)

```
src/api/        도메인 타입·코드체계·점수·api 계약 + mock/firestore 구현
src/pages/      라우트 진입점 (라우팅은 App.tsx — Claude 소유)
src/features/   ranking/ teacher/ organizer/ — task별 구현
firestore.rules Spark 무결성 (CONTRACT §4 invariants)
```

**개발 규칙은 [docs/CONTRACT.md](docs/CONTRACT.md)가 단일 진실원.** 계약 파일 변경은 카드 LOG로 Claude에 요청.
