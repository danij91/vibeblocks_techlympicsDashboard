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

type EntryMode = 'teacher' | 'sign-in'

export default function HomePage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, isSignedIn } = useAuthSession()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)
  const [entryMode, setEntryMode] = useState<EntryMode>('teacher')
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
            {!isSignedIn && entryMode === 'sign-in' ? (
              <AuthPanel title="Sign in" mode="sign-in" onSignedIn={refreshRole} />
            ) : null}

            {!isSignedIn && entryMode === 'sign-in' ? (
              <button className="auth-button" type="button" onClick={() => { setEntryMode('teacher'); setError(null) }}>
                Back to teacher code
              </button>
            ) : null}

            {!isSignedIn && entryMode === 'teacher' ? (
              <TeacherCodeGate
                user={user}
                entryAside={
                  <>
                    <span className="home-entry-or">or</span>
                    <button className="auth-button" type="button" onClick={() => { setEntryMode('sign-in'); setError(null) }}>
                      Sign in
                    </button>
                  </>
                }
                onBound={async () => {
                  await refreshRole()
                  navigate('/teacher', { replace: true })
                }}
              />
            ) : null}
            {error ? <p className={styles.formError}>{error}</p> : null}
            {isChecking ? (
              <section className="auth-panel">
                <p className="auth-eyebrow">Session</p>
                <h2>Checking account...</h2>
              </section>
            ) : null}
            {showRoleLanding ? <RoleLanding user={user} onRoleChanged={refreshRole} /> : null}
          </div>
        </div>
      </section>
    </main>
  )
}
