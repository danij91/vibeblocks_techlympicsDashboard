import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RankingPage from './pages/RankingPage'
import TeacherPage from './pages/TeacherPage'
import OrganizerPage from './pages/OrganizerPage'
import AdminPage from './pages/AdminPage'

// 라우트 소유권 = docs/CONTRACT.md §7 — 각 페이지 파일은 담당 task만 수정.
// 이 파일(App.tsx)은 Claude 소유: 라우트 추가·변경은 카드 LOG로 요청.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/r/:joinCode" element={<RankingPage />} />
      <Route path="/join/:joinCode" element={<RankingPage />} />
      <Route path="/teacher/*" element={<TeacherPage />} />
      <Route path="/organizer/*" element={<OrganizerPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
    </Routes>
  )
}
