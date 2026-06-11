import { useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { api } from '../../api'
import { normalizeCode } from '../../api/codes'
import type { EventDoc, SchoolDoc } from '../../api/types'
import AuthPanel from './AuthPanel'
import { isRealUser } from './session'

type GateStep = 'code' | 'confirm' | 'auth'
type ValidatedTeacherCode = {
  code: string
  event: EventDoc
  school: Pick<SchoolDoc, 'id' | 'name'>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function TeacherCodeGate({
  user,
  initialCode = '',
  onBound,
  onCancel,
}: {
  user: User | null
  initialCode?: string
  onBound: () => void | Promise<void>
  onCancel?: () => void
}) {
  const [step, setStep] = useState<GateStep>('code')
  const [code, setCode] = useState(initialCode)
  const [validated, setValidated] = useState<ValidatedTeacherCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const validateCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const normalized = normalizeCode(code)
      const result = await api.validateTeacherCode(normalized)
      setValidated({ code: normalized, ...result })
      setStep('confirm')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const bindValidatedSchool = async () => {
    if (!validated) return
    setBusy(true)
    setError('')
    try {
      await api.bindTeacherSchool(validated.code)
      await onBound()
      setCode('')
      setValidated(null)
      setStep('code')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-panel" aria-label="Teacher code gate">
      <div className="auth-steps" aria-label="Teacher onboarding progress">
        <span className={step === 'code' ? 'active' : ''}>Code</span>
        <span className={step === 'confirm' ? 'active' : ''}>Confirm</span>
        <span className={step === 'auth' ? 'active' : ''}>Account</span>
      </div>

      {step === 'code' ? (
        <form className="auth-form" onSubmit={validateCode}>
          <label>
            Teacher code
            <input
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="T-KEDAH234"
              autoComplete="one-time-code"
            />
          </label>
          <div className="auth-actions">
            {onCancel ? (
              <button className="auth-button" type="button" onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            <button className="auth-button primary" type="submit" disabled={busy || code.trim().length === 0}>
              {busy ? 'Checking...' : 'Continue'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'confirm' && validated ? (
        <div className="auth-confirm">
          <p className="auth-eyebrow">{validated.event.name}</p>
          <h2>{validated.school.name}</h2>
          <p>Confirm this school before adding it to your teacher account.</p>
          <div className="auth-actions">
            <button className="auth-button" type="button" onClick={() => setStep('code')} disabled={busy}>
              Change code
            </button>
            {isRealUser(user) ? (
              <button className="auth-button primary" type="button" onClick={() => void bindValidatedSchool()} disabled={busy}>
                {busy ? 'Adding...' : 'Add school'}
              </button>
            ) : (
              <button className="auth-button primary" type="button" onClick={() => setStep('auth')} disabled={busy}>
                Continue to sign in
              </button>
            )}
          </div>
        </div>
      ) : null}

      {step === 'auth' ? <AuthPanel title="Sign in to bind teacher code" onSignedIn={bindValidatedSchool} /> : null}
      {error ? <div className="auth-alert">{error}</div> : null}
    </section>
  )
}
