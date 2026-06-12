import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useToast } from '../../lib/toast'

type AuthMode = 'sign-in' | 'sign-up'

const googleProvider = new GoogleAuthProvider()

function errorText(error: unknown): string {
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
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
          />
        </label>
        <button className="auth-button primary" type="submit" disabled={busy || !email.trim() || password.length < 6}>
          {busy ? 'Working...' : authMode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {error ? <div className="auth-alert">{error}</div> : null}
    </section>
  )
}
