import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RankingPage from './pages/RankingPage'
import TeacherPage from './pages/TeacherPage'
import AdminConsolePage from './pages/AdminConsolePage'
import MasterConsolePage from './pages/MasterConsolePage'

// 라우트 소유권 = docs/CONTRACT.md §7 — 각 페이지 파일은 담당 task만 수정.
// 이 파일(App.tsx)은 Claude 소유: 라우트 추가·변경은 카드 LOG로 요청.
// v2: /admin = 주최측(role:admin) 콘솔, /master = 회사(role:master) 콘솔 (링크 없는 경로)
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/r/:joinCode" element={<RankingPage />} />
      <Route path="/join/:joinCode" element={<RankingPage />} />
      <Route path="/teacher/*" element={<TeacherPage />} />
      <Route path="/admin/*" element={<AdminConsolePage />} />
      <Route path="/master/*" element={<MasterConsolePage />} />
      {/* 구 경로 호환 */}
      <Route path="/organizer/*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
