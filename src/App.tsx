import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import JoinLandingPage from './pages/JoinLandingPage'
import TeacherPage from './pages/TeacherPage'
import AdminConsolePage from './pages/AdminConsolePage'
import MasterConsolePage from './pages/MasterConsolePage'
import { ToastProvider } from './lib/toast'

// 라우트 소유권 = docs/CONTRACT.md §7 — 각 페이지 파일은 담당 task만 수정.
// 이 파일(App.tsx)은 Claude 소유: 라우트 추가·변경은 카드 LOG로 요청.
// v3: 공개 랭킹(/r) 제거 — 랭킹은 콘솔 전용(teacher: 학급→랭킹 / admin: 학교→학급→랭킹).
//     /join = QR 폴백 랜딩(앱 안내)만.
export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:joinCode" element={<JoinLandingPage />} />
        <Route path="/teacher/*" element={<TeacherPage />} />
        <Route path="/admin/*" element={<AdminConsolePage />} />
        <Route path="/master/*" element={<MasterConsolePage />} />
        {/* 구 경로 호환 */}
        <Route path="/organizer/*" element={<Navigate to="/admin" replace />} />
        <Route path="/r/:joinCode" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
