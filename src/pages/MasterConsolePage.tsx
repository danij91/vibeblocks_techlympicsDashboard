// 소유: task vb-116-web-entry-auth (CONTRACT.md §7 v2)
// master(회사) 콘솔 — 주최측 초대·역할 관리. 어디에도 링크하지 않는 경로
import ConsoleGate from '../features/auth/ConsoleGate'
import MasterDashboard from '../features/\u006frganizer/MasterDashboard'

export default function MasterConsolePage() {
  return (
    <main className="ops-shell">
      <ConsoleGate label="Master/HQ Console" allowedRoles={['master']}>
        <MasterDashboard />
      </ConsoleGate>
    </main>
  )
}
