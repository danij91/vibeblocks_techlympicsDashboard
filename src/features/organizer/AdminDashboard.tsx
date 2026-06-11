import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { RoleDoc } from '../../api/types'
import './organizer.css'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default function AdminDashboard() {
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roles, setRoles] = useState<RoleDoc[]>([])
  const [invite, setInvite] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    setError('')
    try {
      const current = await api.getMyRole()
      setRole(current)
      if (current?.role === 'admin') setRoles(await api.listRoles())
      else setRoles([])
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const createInvite = async () => {
    setError('')
    try {
      const code = await api.createOrganizerInvite()
      setInvite(code)
      setNotice('Organizer invite created.')
      await refresh()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const copyInvite = async () => {
    if (!invite) return
    await navigator.clipboard.writeText(invite)
    setNotice('Invite code copied.')
  }

  const redeem = async (code = redeemCode) => {
    setError('')
    try {
      await api.redeemOrganizerInvite(code)
      setRedeemCode('')
      setNotice('Invite redeemed. Current user is now organizer.')
      await refresh()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const revoke = async (uid: string) => {
    const ok = window.confirm('Revoke this role?')
    if (!ok) return
    setError('')
    try {
      await api.revokeRole(uid)
      setNotice('Role revoked.')
      await refresh()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <main className="ops-shell">
      <div className="ops-topbar">
        <div>
          <p className="ops-eyebrow">Techlympics access</p>
          <h1>Admin Console</h1>
          <p className="ops-subtle">Create organizer invites, redeem invites, and manage assigned roles.</p>
        </div>
        <div className="ops-row-actions">
          <button className="ops-button" onClick={() => { window.__mockRole?.('admin'); void refresh() }}>Mock admin</button>
          <button className="ops-button" onClick={() => { window.__mockRole?.(null); void refresh() }}>Clear mock role</button>
          <button className="ops-button" onClick={() => void refresh()}>Refresh</button>
        </div>
      </div>

      {error && <div className="ops-alert">{error}</div>}
      {notice && <div className="ops-alert ops-success">{notice}</div>}

      <div className="ops-grid">
        <section className="ops-stack">
          <div className="ops-panel">
            <h2>Redeem organizer invite</h2>
            <p className="ops-subtle">Organizer candidates can enter a V-code here after login.</p>
            <div className="ops-form" style={{ marginTop: 10 }}>
              <label className="ops-label">Invite code<input className="ops-input" value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder="V-..." /></label>
              <button className="ops-button primary" disabled={!redeemCode.trim()} onClick={() => void redeem()}>Redeem invite</button>
            </div>
          </div>

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
          {role?.role === 'admin' ? (
            <>
              <div className="ops-panel">
                <div className="ops-topbar">
                  <div>
                    <h2>Organizer invite</h2>
                    <p className="ops-subtle">Issue one-time invite codes for organizer accounts.</p>
                  </div>
                  <button className="ops-button primary" onClick={() => void createInvite()}>Create invite</button>
                </div>
                {invite && (
                  <div className="ops-card">
                    <p className="ops-eyebrow">New invite</p>
                    <h3><code>{invite}</code></h3>
                    <div className="ops-row-actions" style={{ marginTop: 8 }}>
                      <button className="ops-button" onClick={() => void copyInvite()}>Copy</button>
                      <button className="ops-button" onClick={() => void redeem(invite)}>Redeem in this session</button>
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
                          <td><button className="ops-button danger" onClick={() => void revoke(item.uid)}>Revoke</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="ops-panel">
              <p className="ops-eyebrow">Admin required</p>
              <h2>Role management is locked</h2>
              <p className="ops-subtle">Use an admin role to create invites and revoke roles.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
