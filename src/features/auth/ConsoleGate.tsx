import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../api'
import type { Role, RoleDoc } from '../../api/types'
import AuthHeader from './AuthHeader'
import AuthPanel from './AuthPanel'
import RoleLanding from './RoleLanding'
import { useAuthSession } from './session'
import './auth.css'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function ConsoleGate({
  label,
  allowedRoles,
  children,
}: {
  label: string
  allowedRoles: Role[]
  children: ReactNode
}) {
  const { user, loading: authLoading, isSignedIn } = useAuthSession()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)
  const [error, setError] = useState('')

  const refreshRole = async () => {
    if (!isSignedIn) {
      setRole(null)
      return
    }
    setRoleLoading(true)
    setError('')
    try {
      setRole(await api.getMyRole())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRoleLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    void refreshRole()
  }, [authLoading, isSignedIn, user?.uid])

  if (authLoading || roleLoading) {
    return (
      <section className="auth-stack">
        <section className="auth-panel">
          <p className="auth-eyebrow">{label}</p>
          <h2>Checking access...</h2>
        </section>
      </section>
    )
  }

  if (!isSignedIn) {
    return (
      <section className="auth-stack">
        <AuthPanel title={`Sign in for ${label}`} onSignedIn={refreshRole} />
      </section>
    )
  }

  if (error) {
    return (
      <section className="auth-stack">
        <AuthHeader user={user} role={role} label={label} onRefresh={refreshRole} />
        <div className="auth-alert">{error}</div>
      </section>
    )
  }

  if (!role || !allowedRoles.includes(role.role)) {
    return (
      <section className="auth-stack">
        <AuthHeader user={user} role={role} label={label} onRefresh={refreshRole} />
        <RoleLanding user={user} title={`${label} access required`} onRoleChanged={refreshRole} />
      </section>
    )
  }

  return (
    <>
      <AuthHeader user={user} role={role} label={label} onRefresh={refreshRole} />
      {children}
    </>
  )
}
