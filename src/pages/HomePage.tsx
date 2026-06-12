import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { RoleDoc } from '../api/types'
import AuthHeader from '../features/auth/AuthHeader'
import AuthPanel from '../features/auth/AuthPanel'
import RoleLanding from '../features/auth/RoleLanding'
import TeacherCodeGate from '../features/auth/TeacherCodeGate'
import { useAuthSession } from '../features/auth/session'
import '../features/auth/auth.css'
import styles from '../features/ranking/publicPages.module.css'

type EntryMode = 'choice' | 'sign-in' | 'teacher'

export default function HomePage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, isSignedIn } = useAuthSession()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)
  const [entryMode, setEntryMode] = useState<EntryMode>('choice')
  const [error, setError] = useState<string | null>(null)

  const refreshRole = async () => {
    if (!isSignedIn) {
      setRole(null)
      return
    }
    setRoleLoading(true)
    setError(null)
    try {
      setRole(await api.getMyRole())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRoleLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    void refreshRole()
  }, [authLoading, isSignedIn, user?.uid])

  useEffect(() => {
    if (!isSignedIn || !role) return
    if (role.role === 'master') navigate('/master', { replace: true })
    else if (role.role === 'admin') navigate('/admin', { replace: true })
    else if (role.role === 'teacher') navigate('/teacher', { replace: true })
  }, [isSignedIn, navigate, role])

  const isChecking = authLoading || roleLoading
  const showRoleLanding = isSignedIn && !role && !isChecking

  return (
    <main className={styles.shell}>
      <section className={styles.homeHero} aria-labelledby="home-title">
        <div className={styles.brandBar}>
          <span className={styles.brandMark}>VB</span>
          <span>VibeBlocks Techlympics</span>
        </div>
        <div className={styles.homeCopy}>
          <p className={styles.kicker}>FC-1 Competition Platform</p>
          <h1 id="home-title">Enter Techlympics.</h1>
          <p>Sign in to continue to your console, or create a teacher account with a teacher code.</p>
        </div>
        <div className="auth-layout">
          <div className="auth-stack">
            {isSignedIn ? <AuthHeader user={user} role={role} label="Techlympics account" onRefresh={refreshRole} /> : null}
            {!isSignedIn && entryMode === 'choice' ? (
              <section className="auth-panel">
                <div className="auth-panel-head">
                  <p className="auth-eyebrow">Start</p>
                  <h2>Choose how to continue</h2>
                </div>
                <div className="home-entry-grid">
                  <button className="role-choice" type="button" onClick={() => { setEntryMode('sign-in'); setError(null) }}>
                    <span>Account</span>
                    <strong>Sign in</strong>
                  </button>
                  <button className="role-choice" type="button" onClick={() => { setEntryMode('teacher'); setError(null) }}>
                    <span>Teacher code</span>
                    <strong>I have a teacher code</strong>
                  </button>
                </div>
              </section>
            ) : null}

            {!isSignedIn && entryMode === 'sign-in' ? (
              <AuthPanel title="Sign in" mode="sign-in" onSignedIn={refreshRole} />
            ) : null}

            {!isSignedIn && entryMode !== 'choice' ? (
              <button className="auth-button" type="button" onClick={() => { setEntryMode('choice'); setError(null) }}>
                Back
              </button>
            ) : null}

            {entryMode === 'teacher' ? (
              <TeacherCodeGate
                user={user}
                onCancel={() => setEntryMode('choice')}
                onBound={async () => {
                  await refreshRole()
                  navigate('/teacher', { replace: true })
                }}
              />
            ) : null}
            {error ? <p className={styles.formError}>{error}</p> : null}
          </div>
          {isChecking ? (
            <section className="auth-panel">
              <p className="auth-eyebrow">Session</p>
              <h2>Checking account...</h2>
            </section>
          ) : showRoleLanding ? (
            <RoleLanding user={user} onRoleChanged={refreshRole} />
          ) : !isSignedIn && entryMode === 'teacher' ? (
            <section className="auth-panel">
              <p className="auth-eyebrow">Teacher sign-up</p>
              <h2>Teacher code required</h2>
              <p>Enter the teacher code from your event host. Class codes are used in the VibeBlocks app.</p>
            </section>
          ) : !isSignedIn && entryMode === 'sign-in' ? (
            <section className="auth-panel">
              <p className="auth-eyebrow">Console access</p>
              <h2>Sign in only</h2>
              <p>New teacher accounts start from the teacher code flow.</p>
            </section>
          ) : (
            <section className="auth-panel">
              <p className="auth-eyebrow">Entry</p>
              <h2>Teacher code or sign in</h2>
              <p>Admin invites are redeemed after sign in.</p>
            </section>
          )}
        </div>
      </section>
    </main>
  )
}
