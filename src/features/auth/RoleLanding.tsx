import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { api } from '../../api'
import { classifyCode, normalizeCode } from '../../api/codes'
import TeacherCodeGate from './TeacherCodeGate'

type LandingPanel = 'teacher' | 'invite' | 'ranking' | null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function RoleLanding({
  user,
  title = 'Choose your Techlympics entry',
  onRoleChanged,
}: {
  user: User | null
  title?: string
  onRoleChanged: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [panel, setPanel] = useState<LandingPanel>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [rankingCode, setRankingCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const redeemInvite = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.redeemAdminInvite(normalizeCode(inviteCode))
      await onRoleChanged()
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const openRanking = (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeCode(rankingCode)
    if (classifyCode(normalized) !== 'join') {
      setError('Enter a 6-character class code to view rankings.')
      return
    }
    navigate(`/r/${normalized}`)
  }

  return (
    <section className="role-landing" aria-label="Account entry choices">
      <div className="auth-panel-head">
        <p className="auth-eyebrow">Signed in</p>
        <h2>{title}</h2>
        <p>Your account can enter as a teacher, redeem an admin invite, or view a class ranking.</p>
      </div>

      <div className="role-choice-grid">
        <button className="role-choice" type="button" onClick={() => { setPanel('teacher'); setError('') }}>
          <span>Teacher code</span>
          <strong>Add school</strong>
        </button>
        <button className="role-choice" type="button" onClick={() => { setPanel('invite'); setError('') }}>
          <span>Admin invite</span>
          <strong>Join host console</strong>
        </button>
        <button className="role-choice" type="button" onClick={() => { setPanel('ranking'); setError('') }}>
          <span>Class code</span>
          <strong>View ranking</strong>
        </button>
      </div>

      {panel === 'teacher' ? (
        <TeacherCodeGate
          user={user}
          onCancel={() => setPanel(null)}
          onBound={async () => {
            await onRoleChanged()
            navigate('/teacher', { replace: true })
          }}
        />
      ) : null}

      {panel === 'invite' ? (
        <form className="auth-panel auth-form" onSubmit={redeemInvite}>
          <label>
            Admin invite code
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="V-..." />
          </label>
          <div className="auth-actions">
            <button className="auth-button" type="button" onClick={() => setPanel(null)}>
              Cancel
            </button>
            <button className="auth-button primary" type="submit" disabled={busy || !inviteCode.trim()}>
              {busy ? 'Redeeming...' : 'Redeem invite'}
            </button>
          </div>
        </form>
      ) : null}

      {panel === 'ranking' ? (
        <form className="auth-panel auth-form" onSubmit={openRanking}>
          <label>
            Class code
            <input value={rankingCode} onChange={(event) => setRankingCode(event.target.value.toUpperCase())} placeholder="KEDAH7" />
          </label>
          <div className="auth-actions">
            <button className="auth-button" type="button" onClick={() => setPanel(null)}>
              Cancel
            </button>
            <button className="auth-button primary" type="submit" disabled={!rankingCode.trim()}>
              View ranking
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="auth-alert">{error}</div> : null}
    </section>
  )
}
