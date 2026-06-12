import ConsoleGate from '../features/auth/ConsoleGate'
import AdminDashboard from '../features/\u006frganizer/AdminDashboard'

export default function AdminConsolePage() {
  return (
    <main className="ops-shell">
      <ConsoleGate label="Admin Console" allowedRoles={['admin', 'master']}>
        <AdminDashboard />
      </ConsoleGate>
    </main>
  )
}
