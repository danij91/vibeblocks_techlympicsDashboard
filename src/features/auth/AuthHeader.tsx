import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import type { RoleDoc } from '../../api/types'
import { auth } from '../../lib/firebase'
import { userLabel } from './session'

export default function AuthHeader({
  user,
  role,
  label,
  onRefresh,
}: {
  user: User | null
  role: RoleDoc | null
  label: string
  onRefresh?: () => void | Promise<void>
}) {
  const navigate = useNavigate()

  const logout = async () => {
    window.__mockRole?.(null)
    await signOut(auth)
    navigate('/', { replace: true })
  }

  return (
    <header className="auth-header">
      <div>
        <p className="auth-eyebrow">{label}</p>
        <strong>{userLabel(user)}</strong>
      </div>
      <div className="auth-header-actions">
        <span className={`auth-role ${role?.role ?? 'none'}`}>{role?.role ?? 'no role'}</span>
        {onRefresh ? (
          <button className="auth-button" type="button" onClick={() => void onRefresh()}>
            Refresh
          </button>
        ) : null}
        <button className="auth-button" type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </header>
  )
}
