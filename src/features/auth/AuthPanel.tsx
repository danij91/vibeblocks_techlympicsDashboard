import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useToast } from '../../lib/toast'

type AuthMode = 'sign-in' | 'sign-up'

const googleProvider = new GoogleAuthProvider()

function errorText(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/user-not-found') return 'No account was found for that email address.'
  if (code === 'auth/invalid-email') return 'Enter a valid email address.'
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment, then try again.'
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.'
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Email or password is incorrect.'
  return error instanceof Error ? error.message : String(error)
}

export default function AuthPanel({
  title = 'Sign in',
  mode,
  onSignedIn,
}: {
  title?: string
  mode?: AuthMode
  onSignedIn?: () => void | Promise<void>
}) {
  const [selectedMode, setSelectedMode] = useState<AuthMode>(mode ?? 'sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const authMode = mode ?? selectedMode
  const isFixedMode = Boolean(mode)

  const finish = async () => {
    if (onSignedIn) await onSignedIn()
  }

  const signInWithGoogle = async () => {
    setBusy(true)
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
      await finish()
      toast(authMode === 'sign-up' ? 'Account ready.' : 'Signed in.', 'success')
    } catch (err) {
      const message = errorText(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const signInWithEmail = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (authMode === 'sign-up') {
        await createUserWithEmailAndPassword(auth, email.trim(), password)
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
      await finish()
      toast(authMode === 'sign-up' ? 'Account created.' : 'Signed in.', 'success')
    } catch (err) {
      const message = errorText(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault()
    setResetBusy(true)
    setResetError('')
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim())
      setResetOpen(false)
      toast('Password reset email sent. Check your inbox.', 'success')
    } catch (err) {
      const message = errorText(err)
      setResetError(message)
      toast(message, 'error')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <section className="auth-panel" aria-label={title}>
      <div className="auth-panel-head">
        <p className="auth-eyebrow">Account</p>
        <h2>{title}</h2>
      </div>
      {!isFixedMode ? (
        <div className="auth-segmented" role="group" aria-label="Authentication mode">
          <button type="button" className={authMode === 'sign-in' ? 'active' : ''} onClick={() => setSelectedMode('sign-in')}>
            Sign in
          </button>
          <button type="button" className={authMode === 'sign-up' ? 'active' : ''} onClick={() => setSelectedMode('sign-up')}>
            Create account
          </button>
        </div>
      ) : null}
      <button className="auth-button google" type="button" onClick={signInWithGoogle} disabled={busy}>
        {authMode === 'sign-up' ? 'Create account with Google' : 'Continue with Google'}
      </button>
      <form className="auth-form" onSubmit={signInWithEmail}>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
        </label>
        <label>
          <span>Password</span>
          <div className="auth-password-field">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
            />
            <button
              className="auth-icon-button"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>
        <button className="auth-button primary" type="submit" disabled={busy || !email.trim() || password.length < 6}>
          {busy ? 'Working...' : authMode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {authMode === 'sign-in' ? (
        <div className="auth-reset">
          <button
            className="auth-link-button"
            type="button"
            onClick={() => {
              setResetEmail(email.trim())
              setResetError('')
              setResetOpen(true)
            }}
          >
            Forgot password?
          </button>
        </div>
      ) : null}
      {error ? <div className="auth-alert">{error}</div> : null}
      {resetOpen ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
            <div className="auth-panel-head">
              <p className="auth-eyebrow">Password reset</p>
              <h2 id="password-reset-title">Send reset email</h2>
            </div>
            <form className="auth-form" onSubmit={resetPassword}>
              <label>
                Email
                <input
                  autoFocus
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                />
              </label>
              {resetError ? <div className="auth-alert">{resetError}</div> : null}
              <div className="auth-actions auth-modal-actions">
                <button className="auth-button" type="button" onClick={() => setResetOpen(false)} disabled={resetBusy}>
                  Cancel
                </button>
                <button className="auth-button primary" type="submit" disabled={resetBusy || !resetEmail.trim()}>
                  {resetBusy ? 'Sending...' : 'Send email'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}
