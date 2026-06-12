import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { api } from '../../api'
import type { RoleDoc } from '../../api/types'
import { auth } from '../../lib/firebase'
import { useToast } from '../../lib/toast'
import { userLabel } from './session'

function accountDeleteErrorText(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'auth/requires-recent-login' || message.includes('REAUTH_REQUIRED')) {
    return 'Please sign in again, then delete the account from this screen.'
  }
  return message
}

export default function AuthHeader({
  user,
  label,
  onRefresh,
}: {
  user: User | null
  role: RoleDoc | null
  label: string
  onRefresh?: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const logout = async () => {
    setBusy(true)
    setError('')
    window.__mockRole?.(null)
    try {
      await signOut(auth)
      navigate('/', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  const deleteAccount = async () => {
    const confirmed = window.confirm(
      'Delete this account? This removes your teacher bindings and role. You may need to sign in again before deleting.',
    )
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      await api.deleteMyAccount()
      window.__mockRole?.(null)
      await signOut(auth).catch(() => undefined)
      toast('Account deleted.', 'success')
      navigate('/', { replace: true })
    } catch (err) {
      const message = accountDeleteErrorText(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="auth-header">
        <div>
          <p className="auth-eyebrow">{label}</p>
          <strong>{userLabel(user)}</strong>
        </div>
        <div className="auth-header-actions">
          {onRefresh ? (
            <button className="auth-button" type="button" onClick={() => void onRefresh()} disabled={busy}>
              Refresh
            </button>
          ) : null}
          <button className="auth-button danger" type="button" onClick={() => void deleteAccount()} disabled={busy}>
            {busy ? 'Working...' : 'Delete account'}
          </button>
          <button className="auth-button" type="button" onClick={() => void logout()} disabled={busy}>
            Sign out
          </button>
        </div>
      </header>
      {error ? <div className="auth-alert">{error}</div> : null}
    </>
  )
}
