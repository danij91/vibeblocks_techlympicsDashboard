import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { classifyCode, normalizeCode } from '../api/codes'
import type { RoleDoc } from '../api/types'
import AuthHeader from '../features/auth/AuthHeader'
import AuthPanel from '../features/auth/AuthPanel'
import RoleLanding from '../features/auth/RoleLanding'
import TeacherCodeGate from '../features/auth/TeacherCodeGate'
import { useAuthSession } from '../features/auth/session'
import '../features/auth/auth.css'
import styles from '../features/ranking/publicPages.module.css'

export default function HomePage() {
  const navigate = useNavigate()
  const { user, loading: authLoading, isSignedIn } = useAuthSession()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)
  const [code, setCode] = useState('')
  const [teacherCode, setTeacherCode] = useState('')
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

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeCode(code)
    const kind = classifyCode(normalized)

    if (kind === 'join') {
      navigate(`/r/${normalized}`)
      return
    }

    if (kind === 'teacher') {
      setTeacherCode(normalized)
      setError(null)
      return
    }

    setError(
      kind === 'recovery'
        ? 'Recovery codes are used inside the VibeBlocks app.'
        : kind === 'invite'
          ? 'Sign in first, then redeem the admin invite from your account entry.'
          : 'Enter a 6-character class code, such as KEDAH7.',
    )
  }

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
          <p>
            Use a class code for rankings, a teacher code for school access, or sign in to continue to your console.
          </p>
        </div>
        <div className="auth-layout">
          <div className="auth-stack">
            {isSignedIn ? <AuthHeader user={user} role={role} label="Techlympics account" onRefresh={refreshRole} /> : null}
            <form className={styles.codeForm} onSubmit={submitCode}>
              <label htmlFor="class-code">Class, teacher, or invite code</label>
              <div className={styles.codeEntry}>
                <input
                  id="class-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    setTeacherCode('')
                    if (error) setError(null)
                  }}
                  placeholder="KEDAH7"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit">Continue</button>
              </div>
              {error ? <p className={styles.formError}>{error}</p> : null}
            </form>
            {teacherCode ? (
              <TeacherCodeGate
                user={user}
                initialCode={teacherCode}
                onCancel={() => setTeacherCode('')}
                onBound={async () => {
                  await refreshRole()
                  navigate('/teacher', { replace: true })
                }}
              />
            ) : null}
          </div>
          {authLoading || roleLoading ? (
            <section className="auth-panel">
              <p className="auth-eyebrow">Session</p>
              <h2>Checking account...</h2>
            </section>
          ) : isSignedIn ? (
            <RoleLanding user={user} onRoleChanged={refreshRole} />
          ) : (
            <AuthPanel title="Sign in for teacher, admin, or master access" onSignedIn={refreshRole} />
          )}
        </div>
      </section>
    </main>
  )
}
