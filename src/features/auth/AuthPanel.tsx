import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { auth } from '../../lib/firebase'

type AuthMode = 'sign-in' | 'sign-up'

const googleProvider = new GoogleAuthProvider()

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function AuthPanel({
  title = 'Sign in',
  onSignedIn,
}: {
  title?: string
  onSignedIn?: () => void | Promise<void>
}) {
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const finish = async () => {
    if (onSignedIn) await onSignedIn()
  }

  const signInWithGoogle = async () => {
    setBusy(true)
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
      await finish()
    } catch (err) {
      setError(errorText(err))
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
    } catch (err) {
      setError(errorText(err))
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
      <div className="auth-segmented" role="group" aria-label="Authentication mode">
        <button type="button" className={authMode === 'sign-in' ? 'active' : ''} onClick={() => setAuthMode('sign-in')}>
          Sign in
        </button>
        <button type="button" className={authMode === 'sign-up' ? 'active' : ''} onClick={() => setAuthMode('sign-up')}>
          Create account
        </button>
      </div>
      <button className="auth-button google" type="button" onClick={signInWithGoogle} disabled={busy}>
        Continue with Google
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
