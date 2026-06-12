import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { RoleDoc } from '../../api/types'
import { useToast } from '../../lib/toast'
import './admin.css'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default function MasterDashboard() {
  const toast = useToast()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roles, setRoles] = useState<RoleDoc[]>([])
  const [invite, setInvite] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [revokingUid, setRevokingUid] = useState('')

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      const current = await api.getMyRole()
      setRole(current)
      if (current?.role === 'master') setRoles(await api.listRoles())
      else setRoles([])
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const createInvite = async () => {
    setCreatingInvite(true)
    setError('')
    try {
      const code = await api.createAdminInvite()
      setInvite(code)
      setNotice('Admin invite created.')
      toast('Admin invite created.', 'success')
      await refresh()
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setCreatingInvite(false)
    }
  }

  const copyInvite = async () => {
    if (!invite) return
    await navigator.clipboard.writeText(invite)
    setNotice('Invite code copied.')
    toast('Invite code copied.', 'success')
  }

  const revoke = async (uid: string) => {
    const ok = window.confirm('Revoke this role?')
    if (!ok) return
    setRevokingUid(uid)
    setError('')
    try {
      await api.revokeRole(uid)
      setNotice('Role revoked.')
      toast('Role revoked.', 'success')
      await refresh()
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setRevokingUid('')
    }
  }

  return (
    <section className="ops-workspace">
      <div className="ops-topbar">
        <div>
          <p className="ops-eyebrow">Techlympics HQ</p>
          <h1>Master/HQ Console</h1>
          <p className="ops-subtle">Create admin invites and manage assigned roles.</p>
        </div>
        <div className="ops-row-actions">
          <button className="ops-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>

      {error && <div className="ops-alert">{error}</div>}
      {notice && <div className="ops-alert ops-success">{notice}</div>}

      <div className="ops-grid">
        <section className="ops-stack">
          <div className="ops-panel">
            <h2>Current role</h2>
            {role ? (
              <p><span className="ops-pill ok">{role.role}</span> <code>{role.uid}</code></p>
            ) : (
              <p className="ops-subtle">No role assigned.</p>
            )}
          </div>
        </section>

        <section className="ops-stack">
          {role?.role === 'master' ? (
            <>
              <div className="ops-panel">
                <div className="ops-topbar">
                  <div>
                    <h2>Admin invite</h2>
                    <p className="ops-subtle">Issue one-time invite codes for host admin accounts.</p>
                  </div>
                  <button className="ops-button primary" disabled={creatingInvite} onClick={() => void createInvite()}>
                    {creatingInvite ? 'Creating...' : 'Create invite'}
                  </button>
                </div>
                {invite && (
                  <div className="ops-card">
                    <p className="ops-eyebrow">New invite</p>
                    <h3><code>{invite}</code></h3>
                    <div className="ops-row-actions" style={{ marginTop: 8 }}>
                      <button className="ops-button" onClick={() => void copyInvite()}>Copy</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="ops-panel">
                <h2>Roles</h2>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>UID</th><th>Role</th><th>Email</th><th>Invite</th><th>Created</th><th>Action</th></tr></thead>
                    <tbody>
                      {roles.map((item) => (
                        <tr key={item.uid}>
                          <td><code>{item.uid}</code></td>
                          <td><span className="ops-pill">{item.role}</span></td>
                          <td>{item.email ?? ''}</td>
                          <td>{item.inviteCode ?? ''}</td>
                          <td>{item.createdAt}</td>
                          <td>
                            <button className="ops-button danger" disabled={revokingUid === item.uid} onClick={() => void revoke(item.uid)}>
                              {revokingUid === item.uid ? 'Revoking...' : 'Revoke'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="ops-panel">
              <p className="ops-eyebrow">Master required</p>
              <h2>Role management is locked</h2>
              <p className="ops-subtle">Use a master role to create invites and revoke roles.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
