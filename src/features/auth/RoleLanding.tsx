import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { signOut } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import TeacherCodeGate from './TeacherCodeGate'

type LandingPanel = 'teacher' | null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function RoleLanding({
  user,
  title,
  onRoleChanged,
}: {
  user: User | null
  title?: string
  onRoleChanged: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const t = useT()
  const [panel, setPanel] = useState<LandingPanel>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const displayTitle = title ?? t('auth.chooseEntry')

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      window.__mockRole?.(null)
      await signOut(auth)
      toast(t('auth.signedOut'), 'success')
      navigate('/', { replace: true })
    } catch (err) {
      const message = errorText(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="role-landing" aria-label={t('auth.entryChoices')}>
      <div className="auth-panel-head">
        <p className="auth-eyebrow">{t('auth.signedIn')}</p>
        <h2>{displayTitle}</h2>
        <p>{t('auth.roleLandingBody')}</p>
      </div>

      <div className="role-choice-grid">
        <button className="role-choice" type="button" onClick={() => { setPanel('teacher'); setError('') }}>
          <span>{t('common.teacherCode')}</span>
          <strong>{t('auth.addSchool')}</strong>
        </button>
        <button className="role-choice" type="button" onClick={() => void logout()} disabled={busy}>
          <span>{t('common.account')}</span>
          <strong>{t('auth.signOut')}</strong>
        </button>
      </div>

      {panel === 'teacher' ? (
        <TeacherCodeGate
          user={user}
          onCancel={() => setPanel(null)}
          onBound={async (role) => {
            await onRoleChanged()
            navigate(role === 'admin' ? '/admin' : '/teacher', { replace: true })
          }}
        />
      ) : null}

      {error ? <div className="auth-alert">{error}</div> : null}
    </section>
  )
}
