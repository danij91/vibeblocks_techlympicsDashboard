import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { AdminInviteDoc, Role, RoleDoc } from '../../api/types'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import AdminDashboard from './AdminDashboard'
import './admin.css'

type MasterTab = 'users' | 'invites'
type ConsoleTab = 'master' | 'admin'
type RoleFilter = Role | 'all'
type RoleWithProfile = RoleDoc & { name?: string; displayName?: string }
type SearchParamSetter = ReturnType<typeof useSearchParams>[1]

const masterTabs: MasterTab[] = ['users', 'invites']
const consoleTabs: ConsoleTab[] = ['master', 'admin']

function parseMasterTab(value: string | null): MasterTab {
  return masterTabs.includes(value as MasterTab) ? (value as MasterTab) : 'users'
}

function parseConsoleTab(value: string | null): ConsoleTab {
  return consoleTabs.includes(value as ConsoleTab) ? (value as ConsoleTab) : 'master'
}

function updateQueryParams(
  searchParams: URLSearchParams,
  setSearchParams: SearchParamSetter,
  patch: Record<string, string | null | undefined>,
  replace = false,
) {
  const next = new URLSearchParams(searchParams)
  Object.entries(patch).forEach(([key, value]) => {
    const normalized = value?.trim()
    if (normalized) next.set(key, normalized)
    else next.delete(key)
  })
  if (next.toString() === searchParams.toString()) return
  setSearchParams(next, { replace })
}

function closeQueryModal(searchParams: URLSearchParams, setSearchParams: SearchParamSetter) {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  updateQueryParams(searchParams, setSearchParams, { modal: null, uid: null }, true)
}

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
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const consoleTab = parseConsoleTab(searchParams.get('console'))
  const tab = consoleTab === 'master' ? parseMasterTab(searchParams.get('tab')) : 'users'
  const modal = searchParams.get('modal')
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [roles, setRoles] = useState<RoleDoc[]>([])
  const [invites, setInvites] = useState<AdminInviteDoc[]>([])
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(() => {
    const value = searchParams.get('role')
    return value === 'teacher' || value === 'admin' || value === 'master' ? value : 'all'
  })
  const [query, setQuery] = useState(() => searchParams.get('userQuery') ?? '')
  const [invite, setInvite] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [revokingUid, setRevokingUid] = useState('')
  const [deletingInviteCode, setDeletingInviteCode] = useState('')
  const pendingRole = useMemo(() => {
    if (modal !== 'revoke-role') return null
    const uid = searchParams.get('uid')
    return roles.find((item) => item.uid === uid) ?? null
  }, [modal, roles, searchParams])

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

  useEffect(() => {
    const value = searchParams.get('role')
    setRoleFilter(value === 'teacher' || value === 'admin' || value === 'master' ? value : 'all')
    setQuery(searchParams.get('userQuery') ?? '')
  }, [paramsKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateQueryParams(searchParams, setSearchParams, { userQuery: query.trim() || null }, true)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, paramsKey, setSearchParams])

  const selectConsoleTab = (next: ConsoleTab) => {
    updateQueryParams(searchParams, setSearchParams, {
      console: next,
      tab: next === 'master' ? parseMasterTab(searchParams.get('tab')) : null,
      school: null,
      class: null,
      modal: null,
      teacher: null,
      uid: null,
    }, false)
  }

  const selectMasterTab = (next: MasterTab) => {
    updateQueryParams(searchParams, setSearchParams, { console: 'master', tab: next, modal: null, uid: null }, false)
  }

  const changeRoleFilter = (next: RoleFilter) => {
    setRoleFilter(next)
    updateQueryParams(searchParams, setSearchParams, { role: next === 'all' ? null : next }, true)
  }

  const createInvite = async () => {
    setCreatingInvite(true)
    setError('')
    try {
      const code = await api.createAdminInvite()
      setInvite(code)
      setNotice(t('master.adminInviteCreated'))
      toast(t('master.adminInviteCreated'), 'success')
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
    setNotice(t('master.inviteCodeCopied'))
    toast(t('master.inviteCodeCopied'), 'success')
  }

  const deleteInvite = async (code: string) => {
    const ok = window.confirm(t('master.deleteInviteConfirm', { code }))
    if (!ok) return
    setDeletingInviteCode(code)
    setError('')
    try {
      await api.deleteAdminInvite(code)
      setNotice(t('master.inviteDeleted'))
      toast(t('master.inviteDeleted'), 'success')
      await refresh()
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setDeletingInviteCode('')
    }
  }

  const openRevoke = (uid: string) => {
    updateQueryParams(searchParams, setSearchParams, { console: 'master', modal: 'revoke-role', uid }, false)
  }

  const revoke = async (uid: string) => {
    setRevokingUid(uid)
    setError('')
    try {
      await api.revokeRole(uid)
      setNotice(t('master.roleRevoked'))
      toast(t('master.roleRevoked'), 'success')
      await refresh()
      closeQueryModal(searchParams, setSearchParams)
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
          <p className="ops-eyebrow">{t('master.techlympicsHq')}</p>
          <h1>{t('master.console')}</h1>
          <p className="ops-subtle">{t('master.description')}</p>
        </div>
        <div className="ops-row-actions">
          <button className="ops-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t('common.refreshing') : t('common.refresh')}</button>
        </div>
      </div>

      <nav className="ops-tabs ops-console-switcher" aria-label={t('master.console')}>
        <button
          className={`ops-tab ${consoleTab === 'master' ? 'active' : ''}`}
          aria-current={consoleTab === 'master' ? 'page' : undefined}
          onClick={() => selectConsoleTab('master')}
        >
          {t('master.masterFeatures')}
        </button>
        <button
          className={`ops-tab ${consoleTab === 'admin' ? 'active' : ''}`}
          aria-current={consoleTab === 'admin' ? 'page' : undefined}
          onClick={() => selectConsoleTab('admin')}
        >
          {t('master.adminConsole')}
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
              <h2>{t('common.currentRole')}</h2>
              {role ? (
                <p><span className="ops-pill ok">{role.role}</span> <code>{role.uid}</code></p>
              ) : (
                <p className="ops-subtle">{t('master.noRoleAssigned')}</p>
              )}
            </div>
          </section>

          <section className="ops-stack">
            {role?.role === 'master' ? (
              <div className="ops-panel">
                <div className="ops-tabs">
                  <button className={`ops-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => selectMasterTab('users')}>{t('master.users')}</button>
                  <button className={`ops-tab ${tab === 'invites' ? 'active' : ''}`} onClick={() => selectMasterTab('invites')}>{t('master.inviteCodes')}</button>
                </div>

                {tab === 'users' ? (
                  <UsersTable
                    query={query}
                    roleFilter={roleFilter}
                    roles={filteredRoles}
                    revokingUid={revokingUid}
                    onQuery={setQuery}
                    onRevoke={openRevoke}
                    onRoleFilter={changeRoleFilter}
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
                <p className="ops-eyebrow">{t('master.masterRequired')}</p>
                <h2>{t('master.lockedTitle')}</h2>
                <p className="ops-subtle">{t('master.lockedBody')}</p>
              </div>
            )}
          </section>
        </div>
      )}
      {pendingRole && (
        <RoleRevokeModal
          busy={revokingUid === pendingRole.uid}
          role={pendingRole}
          onClose={() => closeQueryModal(searchParams, setSearchParams)}
          onConfirm={() => void revoke(pendingRole.uid)}
        />
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
  onRevoke: (uid: string) => void
}) {
  const t = useT()
  return (
    <section className="ops-subsection">
      <div className="ops-topbar">
        <div>
          <h2>{t('master.users')}</h2>
          <p className="ops-subtle">{t('master.filterUsers')}</p>
        </div>
        <div className="ops-filter-bar">
          <label className="ops-label">{t('common.role')}
            <select className="ops-select" value={roleFilter} onChange={(event) => onRoleFilter(event.target.value as RoleFilter)}>
              <option value="all">{t('common.all')}</option>
              <option value="teacher">{t('common.teacher')}</option>
              <option value="admin">{t('common.admin')}</option>
              <option value="master">{t('common.master')}</option>
            </select>
          </label>
          <label className="ops-label">{t('common.search')}
            <input className="ops-input" value={query} onChange={(event) => onQuery(event.target.value)} />
          </label>
        </div>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead><tr><th>{t('common.name')}</th><th>{t('common.email')}</th><th>{t('common.uid')}</th><th>{t('common.role')}</th><th>{t('common.invite')}</th><th>{t('common.created')}</th><th>{t('common.action')}</th></tr></thead>
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
                    {revokingUid === item.uid ? t('admin.revoking') : t('admin.revoke')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {roles.length === 0 && <p className="ops-subtle">{t('master.noUsers')}</p>}
    </section>
  )
}

function RoleRevokeModal({
  role,
  busy,
  onClose,
  onConfirm,
}: {
  role: RoleDoc
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <div className="ops-modal-backdrop" role="presentation" onClick={onClose}>
      <section aria-modal="true" className="ops-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ops-topbar">
          <h2>{t('admin.revoke')}</h2>
          <button className="ops-button" disabled={busy} onClick={onClose}>{t('common.close')}</button>
        </div>
        <p>{t('master.revokeRoleConfirm')}</p>
        <p className="ops-subtle"><code>{role.email ?? role.uid}</code></p>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button className="ops-button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button className="ops-button danger" disabled={busy} onClick={onConfirm}>
            {busy ? t('admin.revoking') : t('admin.revoke')}
          </button>
        </div>
      </section>
    </div>
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
  const t = useT()
  return (
    <section className="ops-subsection">
      <div className="ops-topbar">
        <div>
          <h2>{t('common.adminInvite')}</h2>
          <p className="ops-subtle">{t('master.issueInvites')}</p>
        </div>
        <button className="ops-button primary" disabled={creatingInvite} onClick={() => void onCreateInvite()}>
          {creatingInvite ? t('admin.creating') : t('master.createInvite')}
        </button>
      </div>

      {invite && (
        <div className="ops-card">
          <p className="ops-eyebrow">{t('master.newInvite')}</p>
          <h3><code>{invite}</code></h3>
          <div className="ops-row-actions" style={{ marginTop: 8 }}>
            <button className="ops-button" onClick={() => void onCopyInvite()}>{t('common.copy')}</button>
          </div>
        </div>
      )}

      <div className="ops-table-wrap" style={{ marginTop: 12 }}>
        <table className="ops-table compact">
          <thead><tr><th>{t('common.code')}</th><th>{t('common.status')}</th><th>{t('master.usedBy')}</th><th>{t('common.created')}</th><th>{t('common.action')}</th></tr></thead>
          <tbody>
            {invites.map((item) => (
              <tr key={item.code}>
                <td><code>{item.code}</code></td>
                <td><span className={`ops-pill ${item.usedBy ? 'warn' : 'ok'}`}>{item.usedBy ? t('common.used') : t('common.unused')}</span></td>
                <td>{item.usedBy ?? '-'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>
                  <button className="ops-button danger" disabled={deletingInviteCode === item.code} onClick={() => void onDeleteInvite(item.code)}>
                    {deletingInviteCode === item.code ? t('master.deleting') : t('master.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invites.length === 0 && <p className="ops-subtle">{t('master.noInvites')}</p>}
    </section>
  )
}
