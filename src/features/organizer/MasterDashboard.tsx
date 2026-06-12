import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import type { AdminInviteDoc, Role, RoleDoc } from '../../api/types'
import { useToast } from '../../lib/toast'
import AdminDashboard from './AdminDashboard'
import './admin.css'

type MasterTab = 'users' | 'invites'
type ConsoleTab = 'master' | 'admin'
type RoleFilter = Role | 'all'
type RoleWithProfile = RoleDoc & { name?: string; displayName?: string }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatDateTime(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function userName(role: RoleDoc) {
  const profile = role as RoleWithProfile
  return profile.name || profile.displayName || '-'
}

function roleSearchText(role: RoleDoc) {
  return `${role.uid} ${role.email ?? ''} ${userName(role)}`.toLowerCase()
}

export default function MasterDashboard() {
  const toast = useToast()
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('master')
  const [tab, setTab] = useState<MasterTab>('users')
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roles, setRoles] = useState<RoleDoc[]>([])
  const [invites, setInvites] = useState<AdminInviteDoc[]>([])
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [query, setQuery] = useState('')
  const [invite, setInvite] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [revokingUid, setRevokingUid] = useState('')
  const [deletingInviteCode, setDeletingInviteCode] = useState('')

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roles.filter((item) => {
      const roleMatches = roleFilter === 'all' || item.role === roleFilter
      const queryMatches = !q || roleSearchText(item).includes(q)
      return roleMatches && queryMatches
    })
  }, [query, roleFilter, roles])

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      const current = await api.getMyRole()
      setRole(current)
      if (current?.role === 'master') {
        const [nextRoles, nextInvites] = await Promise.all([api.listRoles(), api.listAdminInvites()])
        setRoles(nextRoles)
        setInvites(nextInvites)
      } else {
        setRoles([])
        setInvites([])
      }
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

  const deleteInvite = async (code: string) => {
    const ok = window.confirm(`Delete invite ${code}?`)
    if (!ok) return
    setDeletingInviteCode(code)
    setError('')
    try {
      await api.deleteAdminInvite(code)
      setNotice('Invite deleted.')
      toast('Invite deleted.', 'success')
      await refresh()
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setDeletingInviteCode('')
    }
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
          <p className="ops-subtle">Create admin invites and manage assigned users.</p>
        </div>
        <div className="ops-row-actions">
          <button className="ops-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>

      <nav className="ops-tabs ops-console-switcher" aria-label="Console switcher">
        <button
          className={`ops-tab ${consoleTab === 'master' ? 'active' : ''}`}
          aria-current={consoleTab === 'master' ? 'page' : undefined}
          onClick={() => setConsoleTab('master')}
        >
          Master 기능
        </button>
        <button
          className={`ops-tab ${consoleTab === 'admin' ? 'active' : ''}`}
          aria-current={consoleTab === 'admin' ? 'page' : undefined}
          onClick={() => setConsoleTab('admin')}
        >
          Admin 콘솔
        </button>
      </nav>

      {error && <div className="ops-alert">{error}</div>}
      {notice && <div className="ops-alert ops-success">{notice}</div>}

      {consoleTab === 'admin' ? (
        <AdminDashboard embedded />
      ) : (
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
              <div className="ops-panel">
                <div className="ops-tabs">
                  <button className={`ops-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
                  <button className={`ops-tab ${tab === 'invites' ? 'active' : ''}`} onClick={() => setTab('invites')}>Invite codes</button>
                </div>

                {tab === 'users' ? (
                  <UsersTable
                    query={query}
                    roleFilter={roleFilter}
                    roles={filteredRoles}
                    revokingUid={revokingUid}
                    onQuery={setQuery}
                    onRevoke={revoke}
                    onRoleFilter={setRoleFilter}
                  />
                ) : (
                  <InvitesPanel
                    creatingInvite={creatingInvite}
                    deletingInviteCode={deletingInviteCode}
                    invite={invite}
                    invites={invites}
                    onCopyInvite={copyInvite}
                    onCreateInvite={createInvite}
                    onDeleteInvite={deleteInvite}
                  />
                )}
              </div>
            ) : (
              <div className="ops-panel">
                <p className="ops-eyebrow">Master required</p>
                <h2>User management is locked</h2>
                <p className="ops-subtle">Use a master role to create invites and revoke roles.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function UsersTable({
  roles,
  roleFilter,
  query,
  revokingUid,
  onRoleFilter,
  onQuery,
  onRevoke,
}: {
  roles: RoleDoc[]
  roleFilter: RoleFilter
  query: string
  revokingUid: string
  onRoleFilter: (role: RoleFilter) => void
  onQuery: (query: string) => void
  onRevoke: (uid: string) => Promise<void>
}) {
  return (
    <section className="ops-subsection">
      <div className="ops-topbar">
        <div>
          <h2>Users</h2>
          <p className="ops-subtle">Filter by role, name, or email.</p>
        </div>
        <div className="ops-filter-bar">
          <label className="ops-label">Role
            <select className="ops-select" value={roleFilter} onChange={(event) => onRoleFilter(event.target.value as RoleFilter)}>
              <option value="all">All</option>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
              <option value="master">Master</option>
            </select>
          </label>
          <label className="ops-label">Search
            <input className="ops-input" value={query} onChange={(event) => onQuery(event.target.value)} />
          </label>
        </div>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead><tr><th>Name</th><th>Email</th><th>UID</th><th>Role</th><th>Invite</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {roles.map((item) => (
              <tr key={item.uid}>
                <td>{userName(item)}</td>
                <td>{item.email ?? '-'}</td>
                <td><code>{item.uid}</code></td>
                <td><span className="ops-pill">{item.role}</span></td>
                <td>{item.inviteCode ?? '-'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>
                  <button className="ops-button danger" disabled={revokingUid === item.uid} onClick={() => void onRevoke(item.uid)}>
                    {revokingUid === item.uid ? 'Revoking...' : 'Revoke'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {roles.length === 0 && <p className="ops-subtle">No users match the filter.</p>}
    </section>
  )
}

function InvitesPanel({
  invites,
  invite,
  creatingInvite,
  deletingInviteCode,
  onCreateInvite,
  onCopyInvite,
  onDeleteInvite,
}: {
  invites: AdminInviteDoc[]
  invite: string
  creatingInvite: boolean
  deletingInviteCode: string
  onCreateInvite: () => Promise<void>
  onCopyInvite: () => Promise<void>
  onDeleteInvite: (code: string) => Promise<void>
}) {
  return (
    <section className="ops-subsection">
      <div className="ops-topbar">
        <div>
          <h2>Admin invite</h2>
          <p className="ops-subtle">Issue and delete one-time invite codes for host admin accounts.</p>
        </div>
        <button className="ops-button primary" disabled={creatingInvite} onClick={() => void onCreateInvite()}>
          {creatingInvite ? 'Creating...' : 'Create invite'}
        </button>
      </div>

      {invite && (
        <div className="ops-card">
          <p className="ops-eyebrow">New invite</p>
          <h3><code>{invite}</code></h3>
          <div className="ops-row-actions" style={{ marginTop: 8 }}>
            <button className="ops-button" onClick={() => void onCopyInvite()}>Copy</button>
          </div>
        </div>
      )}

      <div className="ops-table-wrap" style={{ marginTop: 12 }}>
        <table className="ops-table compact">
          <thead><tr><th>Code</th><th>Status</th><th>Used by</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {invites.map((item) => (
              <tr key={item.code}>
                <td><code>{item.code}</code></td>
                <td><span className={`ops-pill ${item.usedBy ? 'warn' : 'ok'}`}>{item.usedBy ? 'Used' : 'Unused'}</span></td>
                <td>{item.usedBy ?? '-'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>
                  <button className="ops-button danger" disabled={deletingInviteCode === item.code} onClick={() => void onDeleteInvite(item.code)}>
                    {deletingInviteCode === item.code ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invites.length === 0 && <p className="ops-subtle">No invite codes issued.</p>}
    </section>
  )
}
