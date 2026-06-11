import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { api } from '../../api'
import type {
  ClassDoc,
  ClassPath,
  EventDoc,
  LeaderboardRow,
  ParticipantDoc,
  ParticipantPath,
  ParticipantStatus,
  SchoolDoc,
  TeacherSchoolView,
} from '../../api/types'
import { normalizeCode } from '../../api/codes'
import { auth } from '../../lib/firebase'

type GateStep = 'code' | 'confirm' | 'auth'
type AuthMode = 'sign-in' | 'sign-up'
type ValidatedTeacherCode = {
  code: string
  event: EventDoc
  school: Pick<SchoolDoc, 'id' | 'name'>
}
type ActiveClass = {
  school: TeacherSchoolView
  classInfo: ClassDoc
}
type Notice = { kind: 'info' | 'error' | 'success'; text: string } | null

const googleProvider = new GoogleAuthProvider()

function classPath(classInfo: ClassDoc): ClassPath {
  return {
    eventId: classInfo.eventId,
    schoolId: classInfo.schoolId,
    classId: classInfo.id,
  }
}

function participantPath(participant: ParticipantDoc): ParticipantPath {
  return {
    eventId: participant.eventId,
    schoolId: participant.schoolId,
    classId: participant.classId,
    participantId: participant.id,
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusLabel(status: ParticipantStatus): string {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'UNKNOWN_ERROR'
}

function joinUrl(joinCode: string): string {
  if (typeof window === 'undefined') return `/join/${joinCode}`
  return `${window.location.origin}/join/${joinCode}`
}

export default function TeacherConsole() {
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [schools, setSchools] = useState<TeacherSchoolView[]>([])
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [loadingSchools, setLoadingSchools] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [showGate, setShowGate] = useState(false)

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  const refreshSchools = async () => {
    setLoadingSchools(true)
    try {
      const nextSchools = await api.listMySchools()
      setSchools(nextSchools)
      setSelectedSchoolId((current) => {
        if (current && nextSchools.some((view) => view.school.id === current)) return current
        return nextSchools[0]?.school.id ?? ''
      })
      setSelectedClassId((current) => {
        if (current && nextSchools.some((view) => view.classes.some((classInfo) => classInfo.id === current))) return current
        return nextSchools[0]?.classes[0]?.id ?? ''
      })
      setShowGate(nextSchools.length === 0)
      setNotice(null)
    } catch (error) {
      setSchools([])
      setShowGate(true)
      setNotice({ kind: 'info', text: errorText(error) === 'FORBIDDEN' ? 'Teacher code required.' : errorText(error) })
    } finally {
      setLoadingSchools(false)
    }
  }

  useEffect(() => {
    void refreshSchools()
  }, [])

  const activeSchool = useMemo(
    () => schools.find((view) => view.school.id === selectedSchoolId) ?? schools[0],
    [schools, selectedSchoolId],
  )
  const activeClass: ActiveClass | null = useMemo(() => {
    if (!activeSchool) return null
    const classInfo = activeSchool.classes.find((item) => item.id === selectedClassId) ?? activeSchool.classes[0]
    return classInfo ? { school: activeSchool, classInfo } : null
  }, [activeSchool, selectedClassId])

  const handleBound = async () => {
    await refreshSchools()
    setShowGate(false)
    setNotice({ kind: 'success', text: 'School added.' })
  }

  const handleSignOut = async () => {
    await signOut(auth)
    setUser(null)
    setSchools([])
    setShowGate(true)
    setNotice({ kind: 'info', text: 'Signed out.' })
  }

  return (
    <main className="teacher-page">
      <style>{teacherStyles}</style>
      <section className="teacher-shell" aria-label="Teacher dashboard">
        <header className="teacher-topbar">
          <div>
            <p className="teacher-kicker">Techlympics 2026</p>
            <h1>Teacher Console</h1>
          </div>
          <div className="teacher-actions">
            {user ? <span className="teacher-user">{user.email ?? 'Signed in'}</span> : null}
            {schools.length > 0 ? (
              <button className="secondary" type="button" onClick={() => setShowGate(true)}>
                Add school
              </button>
            ) : null}
            {user ? (
              <button className="ghost" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </header>

        {notice ? <div className={`notice ${notice.kind}`}>{notice.text}</div> : null}

        {showGate || schools.length === 0 ? (
          <TeacherGate user={user} onBound={handleBound} onCancel={schools.length > 0 ? () => setShowGate(false) : undefined} />
        ) : null}

        {loadingSchools ? <div className="panel muted">Loading teacher schools...</div> : null}

        {!showGate && schools.length > 0 && activeSchool ? (
          <Dashboard
            schools={schools}
            activeSchool={activeSchool}
            activeClass={activeClass}
            selectedClassId={selectedClassId}
            onSelectSchool={(schoolId) => {
              const nextSchool = schools.find((view) => view.school.id === schoolId)
              setSelectedSchoolId(schoolId)
              setSelectedClassId(nextSchool?.classes[0]?.id ?? '')
            }}
            onSelectClass={setSelectedClassId}
            onClassChanged={refreshSchools}
          />
        ) : null}
      </section>
    </main>
  )
}

function TeacherGate({
  user,
  onBound,
  onCancel,
}: {
  user: User | null
  onBound: () => Promise<void>
  onCancel?: () => void
}) {
  const [step, setStep] = useState<GateStep>('code')
  const [code, setCode] = useState('')
  const [validated, setValidated] = useState<ValidatedTeacherCode | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(user ? 'sign-in' : 'sign-up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const validateCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const normalized = normalizeCode(code)
      const result = await api.validateTeacherCode(normalized)
      setValidated({ code: normalized, ...result })
      setStep('confirm')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const bindValidatedSchool = async () => {
    if (!validated) return
    setBusy(true)
    setError('')
    try {
      await api.bindTeacherSchool(validated.code)
      await onBound()
      setCode('')
      setValidated(null)
      setStep('code')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const signInWithGoogle = async () => {
    setBusy(true)
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
      await bindValidatedSchool()
    } catch (err) {
      setError(errorText(err))
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
      await bindValidatedSchool()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <section className="gate panel">
      <div className="gate-steps" aria-label="Teacher onboarding progress">
        <span className={step === 'code' ? 'active' : ''}>Code</span>
        <span className={step === 'confirm' ? 'active' : ''}>Confirm</span>
        <span className={step === 'auth' ? 'active' : ''}>Account</span>
      </div>

      {step === 'code' ? (
        <form className="gate-form" onSubmit={validateCode}>
          <label>
            Teacher code
            <input
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="T-KEDAH234"
              autoComplete="one-time-code"
            />
          </label>
          <div className="row-actions">
            {onCancel ? (
              <button className="ghost" type="button" onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            <button type="submit" disabled={busy || code.trim().length === 0}>
              {busy ? 'Checking...' : 'Continue'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'confirm' && validated ? (
        <div className="confirm-school">
          <p className="teacher-kicker">{validated.event.name}</p>
          <h2>{validated.school.name}</h2>
          <p>Is this your school?</p>
          <div className="row-actions">
            <button className="ghost" type="button" onClick={() => setStep('code')} disabled={busy}>
              Change code
            </button>
            {user ? (
              <button type="button" onClick={bindValidatedSchool} disabled={busy}>
                {busy ? 'Adding...' : 'Add school'}
              </button>
            ) : (
              <button type="button" onClick={() => setStep('auth')} disabled={busy}>
                Yes, continue
              </button>
            )}
          </div>
        </div>
      ) : null}

      {step === 'auth' ? (
        <div className="auth-panel">
          <div className="segmented" role="group" aria-label="Authentication mode">
            <button type="button" className={authMode === 'sign-up' ? 'active' : ''} onClick={() => setAuthMode('sign-up')}>
              Sign up
            </button>
            <button type="button" className={authMode === 'sign-in' ? 'active' : ''} onClick={() => setAuthMode('sign-in')}>
              Sign in
            </button>
          </div>
          <button className="google" type="button" onClick={signInWithGoogle} disabled={busy}>
            Continue with Google
          </button>
          <form className="gate-form" onSubmit={signInWithEmail}>
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
            <div className="row-actions">
              <button className="ghost" type="button" onClick={() => setStep('confirm')} disabled={busy}>
                Back
              </button>
              <button type="submit" disabled={busy || !email.trim() || password.length < 6}>
                {busy ? 'Working...' : authMode === 'sign-up' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {error ? <div className="notice error">{error}</div> : null}
    </section>
  )
}

function Dashboard({
  schools,
  activeSchool,
  activeClass,
  selectedClassId,
  onSelectSchool,
  onSelectClass,
  onClassChanged,
}: {
  schools: TeacherSchoolView[]
  activeSchool: TeacherSchoolView
  activeClass: ActiveClass | null
  selectedClassId: string
  onSelectSchool: (schoolId: string) => void
  onSelectClass: (classId: string) => void
  onClassChanged: () => Promise<void>
}) {
  return (
    <section className="dashboard">
      <div className="school-tabs" role="tablist" aria-label="Schools">
        {schools.map((view) => (
          <button
            key={view.school.id}
            type="button"
            className={view.school.id === activeSchool.school.id ? 'active' : ''}
            onClick={() => onSelectSchool(view.school.id)}
          >
            {view.school.name}
          </button>
        ))}
      </div>

      <section className="class-grid" aria-label={`${activeSchool.school.name} classes`}>
        {activeSchool.classes.map((classInfo) => (
          <ClassCard
            key={classInfo.id}
            schoolName={activeSchool.school.name}
            classInfo={classInfo}
            selected={classInfo.id === selectedClassId}
            onSelect={() => onSelectClass(classInfo.id)}
          />
        ))}
      </section>

      {activeClass ? <ClassWorkspace activeClass={activeClass} onClassChanged={onClassChanged} /> : <div className="panel">No classes yet.</div>}
    </section>
  )
}

function ClassCard({
  schoolName,
  classInfo,
  selected,
  onSelect,
}: {
  schoolName: string
  classInfo: ClassDoc
  selected: boolean
  onSelect: () => void
}) {
  const [printOpen, setPrintOpen] = useState(false)
  const url = joinUrl(classInfo.joinCode)

  const printCard = () => {
    setPrintOpen(true)
    window.setTimeout(() => window.print(), 80)
  }

  return (
    <article className={`class-card ${selected ? 'selected' : ''}`}>
      <button className="class-card-select" type="button" onClick={onSelect} aria-pressed={selected}>
        <span>{classInfo.name}</span>
        <strong>{classInfo.joinCode}</strong>
      </button>
      <div className="qr-box">
        <QRCodeSVG value={url} size={112} marginSize={1} />
      </div>
      <div className="row-actions compact">
        <a className="secondary link-button" href={`/join/${classInfo.joinCode}`}>
          Join link
        </a>
        <button className="secondary" type="button" onClick={printCard}>
          Print
        </button>
      </div>
      {printOpen ? (
        <PrintSheet schoolName={schoolName} classInfo={classInfo} joinUrlValue={url} onClose={() => setPrintOpen(false)} />
      ) : null}
    </article>
  )
}

function PrintSheet({
  schoolName,
  classInfo,
  joinUrlValue,
  onClose,
}: {
  schoolName: string
  classInfo: ClassDoc
  joinUrlValue: string
  onClose: () => void
}) {
  return (
    <div className="print-modal">
      <div className="print-toolbar">
        <button className="ghost" type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" onClick={() => window.print()}>
          Print again
        </button>
      </div>
      <section className="print-sheet" aria-label={`${classInfo.name} print sheet`}>
        <p className="print-kicker">Techlympics 2026</p>
        <h1>{schoolName}</h1>
        <h2>{classInfo.name}</h2>
        <div className="print-qr">
          <QRCodeSVG value={joinUrlValue} size={280} marginSize={2} />
        </div>
        <p className="print-code">{classInfo.joinCode}</p>
        <ol>
          <li>Open the Techlympics join page.</li>
          <li>Scan this QR code or enter the class code.</li>
          <li>Register your name, then submit your FC-1 run.</li>
        </ol>
      </section>
    </div>
  )
}

function ClassWorkspace({ activeClass, onClassChanged }: { activeClass: ActiveClass; onClassChanged: () => Promise<void> }) {
  const [participants, setParticipants] = useState<ParticipantDoc[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [busyParticipantId, setBusyParticipantId] = useState<string>('')
  const [busyBulk, setBusyBulk] = useState(false)
  const [error, setError] = useState('')

  const loadClassData = async () => {
    setError('')
    try {
      const [nextParticipants, nextLeaderboard] = await Promise.all([
        api.listParticipants(classPath(activeClass.classInfo)),
        api.getLeaderboard(activeClass.classInfo.joinCode, { includePending: true }),
      ])
      setParticipants(nextParticipants)
      setLeaderboard(nextLeaderboard)
    } catch (err) {
      setError(errorText(err))
    }
  }

  useEffect(() => {
    void loadClassData()
  }, [activeClass.classInfo.id])

  const setStatus = async (participant: ParticipantDoc, status: ParticipantStatus) => {
    if (status === 'rejected' && !window.confirm(`Reject ${participant.name}?`)) return
    setBusyParticipantId(participant.id)
    setError('')
    try {
      await api.setParticipantStatus(participantPath(participant), status)
      await loadClassData()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyParticipantId('')
    }
  }

  const approveAll = async () => {
    setBusyBulk(true)
    setError('')
    try {
      const count = await api.bulkApprove(classPath(activeClass.classInfo))
      await loadClassData()
      await onClassChanged()
      setError(count === 0 ? 'No pending participants.' : '')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyBulk(false)
    }
  }

  const pendingCount = participants.filter((participant) => participant.status === 'pending').length

  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="teacher-kicker">{activeClass.school.school.name}</p>
          <h2>{activeClass.classInfo.name}</h2>
        </div>
        <button type="button" onClick={approveAll} disabled={busyBulk || pendingCount === 0}>
          {busyBulk ? 'Approving...' : `Approve all (${pendingCount})`}
        </button>
      </header>
      {error ? <div className={`notice ${error === 'No pending participants.' ? 'info' : 'error'}`}>{error}</div> : null}
      <div className="workspace-grid">
        <ParticipantsTable participants={participants} busyParticipantId={busyParticipantId} onStatus={setStatus} />
        <LeaderboardPreview rows={leaderboard} />
      </div>
    </section>
  )
}

function ParticipantsTable({
  participants,
  busyParticipantId,
  onStatus,
}: {
  participants: ParticipantDoc[]
  busyParticipantId: string
  onStatus: (participant: ParticipantDoc, status: ParticipantStatus) => Promise<void>
}) {
  return (
    <section className="panel table-panel">
      <header className="panel-header">
        <h3>Participants</h3>
        <span>{participants.length}</span>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Public ID</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((participant) => (
              <tr key={participant.id} className={participant.status === 'pending' ? 'pending-row' : ''}>
                <td>{participant.name}</td>
                <td>{participant.publicId}</td>
                <td>{formatDate(participant.registeredAt)}</td>
                <td>
                  <span className={`status ${participant.status}`}>{statusLabel(participant.status)}</span>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={busyParticipantId === participant.id || participant.status === 'approved'}
                      onClick={() => onStatus(participant, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={busyParticipantId === participant.id || participant.status === 'rejected'}
                      onClick={() => onStatus(participant, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LeaderboardPreview({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <section className="panel table-panel">
      <header className="panel-header">
        <h3>Leaderboard</h3>
        <span>{rows.length}</span>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Status</th>
              <th>Score</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.publicId} className={row.status === 'pending' ? 'pending-row' : ''}>
                <td>{row.rank ?? '-'}</td>
                <td>
                  {row.name}
                  <span className="public-id">{row.publicId}</span>
                </td>
                <td>
                  <span className={`status ${row.status}`}>{statusLabel(row.status)}</span>
                </td>
                <td>{row.averageSec === null ? '-' : `${row.averageSec.toFixed(1)}s`}</td>
                <td>{row.attemptsUsed.c1 + row.attemptsUsed.c2 + row.attemptsUsed.c3}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const teacherStyles = `
.teacher-page {
  min-height: 100vh;
  padding: 24px;
  background: #f4f6fb;
}
.teacher-shell {
  max-width: 1180px;
  margin: 0 auto;
}
.teacher-topbar,
.workspace-header,
.panel-header,
.row-actions,
.teacher-actions,
.table-actions {
  display: flex;
  align-items: center;
}
.teacher-topbar,
.workspace-header,
.panel-header {
  justify-content: space-between;
  gap: 16px;
}
.teacher-topbar {
  margin-bottom: 20px;
}
.teacher-topbar h1,
.workspace-header h2,
.confirm-school h2,
.print-sheet h1,
.print-sheet h2 {
  margin: 0;
  letter-spacing: 0;
}
.teacher-kicker,
.print-kicker {
  margin: 0 0 6px;
  color: #5d6474;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
.teacher-actions,
.row-actions,
.table-actions {
  gap: 8px;
  flex-wrap: wrap;
}
.teacher-user {
  color: #515766;
  font-size: 14px;
}
button,
.link-button {
  border: 0;
  border-radius: 8px;
  background: #2459d6;
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
}
button:disabled {
  cursor: not-allowed;
  opacity: .55;
}
button.secondary,
.link-button.secondary {
  background: #e9edf7;
  color: #1d2c4d;
}
button.ghost {
  background: transparent;
  color: #35415d;
  border: 1px solid #cbd3e3;
}
button.danger {
  background: #fff0f0;
  color: #b42318;
}
button.google {
  width: 100%;
  background: #111827;
}
.panel,
.class-card,
.workspace {
  background: white;
  border: 1px solid #dfe5f1;
  border-radius: 8px;
  box-shadow: 0 8px 22px rgba(29, 44, 77, .06);
}
.panel,
.workspace {
  padding: 18px;
}
.muted {
  color: #667085;
}
.notice {
  border-radius: 8px;
  margin: 12px 0;
  padding: 12px 14px;
  font-weight: 700;
}
.notice.info {
  background: #eef4ff;
  color: #2459d6;
}
.notice.error {
  background: #fff1f0;
  color: #b42318;
}
.notice.success {
  background: #ecfdf3;
  color: #027a48;
}
.gate {
  margin-bottom: 18px;
  max-width: 560px;
}
.gate-steps,
.segmented,
.school-tabs {
  display: flex;
  gap: 6px;
}
.gate-steps {
  margin-bottom: 16px;
}
.gate-steps span {
  border-radius: 999px;
  background: #edf1f8;
  color: #667085;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 800;
}
.gate-steps span.active,
.segmented button.active,
.school-tabs button.active {
  background: #dbe7ff;
  color: #1746ad;
}
.gate-form {
  display: grid;
  gap: 14px;
}
label {
  color: #344054;
  display: grid;
  gap: 6px;
  font-size: 14px;
  font-weight: 800;
}
input {
  border: 1px solid #cbd3e3;
  border-radius: 8px;
  min-height: 42px;
  padding: 0 12px;
  font: inherit;
}
.confirm-school p {
  color: #5d6474;
}
.auth-panel {
  display: grid;
  gap: 14px;
}
.segmented {
  background: #edf1f8;
  border-radius: 8px;
  padding: 4px;
}
.segmented button {
  flex: 1;
  background: transparent;
  color: #566176;
}
.dashboard {
  display: grid;
  gap: 18px;
}
.school-tabs {
  overflow-x: auto;
  padding-bottom: 2px;
}
.school-tabs button {
  background: white;
  border: 1px solid #dfe5f1;
  color: #2f3a52;
  white-space: nowrap;
}
.class-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.class-card {
  display: grid;
  gap: 12px;
  padding: 14px;
}
.class-card.selected {
  border-color: #2459d6;
}
.class-card-select {
  align-items: flex-start;
  background: transparent;
  color: #172033;
  display: grid;
  justify-content: stretch;
  min-height: 0;
  padding: 0;
  text-align: left;
}
.class-card-select span {
  font-size: 16px;
}
.class-card-select strong,
.print-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0;
}
.class-card-select strong {
  color: #2459d6;
  font-size: 24px;
}
.qr-box {
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex;
  justify-content: center;
  min-height: 136px;
}
.compact {
  justify-content: space-between;
}
.workspace {
  display: grid;
  gap: 16px;
}
.workspace-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, .75fr);
}
.table-panel {
  min-width: 0;
}
.panel-header h3 {
  margin: 0;
}
.panel-header span {
  color: #667085;
  font-weight: 800;
}
.table-scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  min-width: 100%;
  width: 100%;
}
th,
td {
  border-bottom: 1px solid #edf1f8;
  padding: 12px 10px;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}
th {
  color: #667085;
  font-size: 12px;
  text-transform: uppercase;
}
.pending-row {
  background: #fffbeb;
}
.status {
  border-radius: 999px;
  display: inline-flex;
  font-size: 12px;
  font-weight: 900;
  padding: 5px 9px;
}
.status.approved {
  background: #ecfdf3;
  color: #027a48;
}
.status.pending {
  background: #fff7d6;
  color: #9a6700;
}
.status.rejected {
  background: #fff1f0;
  color: #b42318;
}
.public-id {
  color: #667085;
  display: block;
  font-size: 12px;
  margin-top: 3px;
}
.print-modal {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: rgba(15, 23, 42, .42);
  display: grid;
  place-items: center;
  padding: 24px;
}
.print-toolbar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.print-sheet {
  aspect-ratio: 1 / 1.414;
  background: white;
  color: #111827;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-height: calc(100vh - 120px);
  padding: 48px;
  width: min(680px, 92vw);
}
.print-sheet h1 {
  font-size: 34px;
  text-align: center;
}
.print-sheet h2 {
  color: #2459d6;
  font-size: 28px;
  margin-top: 8px;
}
.print-qr {
  margin: 32px 0 16px;
}
.print-code {
  font-size: 42px;
  font-weight: 900;
  margin: 0 0 20px;
}
.print-sheet ol {
  color: #344054;
  font-size: 18px;
  line-height: 1.6;
  margin: 0;
}
@media (max-width: 820px) {
  .teacher-page {
    padding: 14px;
  }
  .teacher-topbar,
  .workspace-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}
@media print {
  body {
    background: white;
  }
  .teacher-shell > :not(.dashboard),
  .dashboard > :not(.class-grid),
  .class-card > :not(.print-modal),
  .class-card:not(:has(.print-modal)),
  .print-toolbar {
    display: none !important;
  }
  .teacher-page,
  .teacher-shell,
  .dashboard,
  .class-grid,
  .class-card,
  .print-modal {
    display: block !important;
    padding: 0 !important;
    margin: 0 !important;
    background: white !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  .print-modal {
    position: static;
  }
  .print-sheet {
    height: 100vh;
    max-height: none;
    width: 100%;
  }
}
`
