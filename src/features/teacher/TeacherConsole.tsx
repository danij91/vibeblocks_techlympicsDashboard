import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../../api'
import type {
  ChallengeDef,
  ClassDoc,
  ClassPath,
  LeaderboardRow,
  ParticipantDoc,
  ParticipantPath,
  ParticipantStatus,
  RoleDoc,
  TeacherSchoolView,
} from '../../api/types'
import AuthHeader from '../auth/AuthHeader'
import TeacherCodeGate from '../auth/TeacherCodeGate'
import { useAuthSession } from '../auth/session'
import '../auth/auth.css'
import LeaderboardTable from '../ranking/LeaderboardTable'
import { ShimmerText } from '../../lib/Shimmer'
import { useToast } from '../../lib/toast'

type ActiveClass = {
  school: TeacherSchoolView
  classInfo: ClassDoc
}
type WorkspaceMode = 'participants' | 'ranking'
type ClassViewMode = 'cards' | 'list'
type GradeFilter = 'all' | `grade:${number}` | 'other'

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

function classGrade(className: string): number | 'other' {
  const match = className.trim().match(/^(\d+)/)
  if (!match) return 'other'
  const grade = Number(match[1])
  return Number.isFinite(grade) && grade > 0 ? grade : 'other'
}

function gradeValue(classInfo: ClassDoc): GradeFilter {
  const grade = classGrade(classInfo.name)
  return grade === 'other' ? 'other' : `grade:${grade}`
}

function gradeLabel(value: GradeFilter): string {
  if (value === 'all') return 'All'
  if (value === 'other') return 'Other'
  return `Grade ${value.replace('grade:', '')}`
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
  if (status === 'withdrawn') return 'Withdrawn'
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

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export default function TeacherConsole() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, loading: authLoading, isSignedIn } = useAuthSession()
  const [role, setRole] = useState<RoleDoc | null>(null)
  const [schools, setSchools] = useState<TeacherSchoolView[]>([])
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [loadingSchools, setLoadingSchools] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [notice, setNotice] = useState('')
  const [showGate, setShowGate] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('participants')

  const refreshRole = useCallback(async () => {
    if (!isSignedIn) {
      setRole(null)
      return
    }
    setRoleLoading(true)
    try {
      setRole(await api.getMyRole())
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setRoleLoading(false)
    }
  }, [isSignedIn, toast])

  const refreshSchools = useCallback(async () => {
    if (!isSignedIn) return
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
      setNotice(nextSchools.length === 0 ? 'Add your first school with a teacher code.' : '')
    } catch (error) {
      setSchools([])
      setShowGate(true)
      setNotice(errorText(error) === 'FORBIDDEN' ? 'Teacher code required.' : errorText(error))
    } finally {
      setLoadingSchools(false)
    }
  }, [isSignedIn])

  useEffect(() => {
    if (authLoading) return
    if (!isSignedIn) {
      setBootstrapping(false)
      navigate('/', { replace: true })
      return
    }
    setBootstrapping(true)
    void Promise.all([refreshRole(), refreshSchools()]).finally(() => setBootstrapping(false))
  }, [authLoading, isSignedIn, navigate, refreshRole, refreshSchools, user?.uid])

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
    await refreshRole()
    await refreshSchools()
    setShowGate(false)
    setNotice('')
    toast('School added.', 'success')
  }

  const refreshAll = async () => {
    await Promise.all([refreshRole(), refreshSchools()])
  }

  if (authLoading || !isSignedIn || bootstrapping) {
    return (
      <main className="teacher-page">
        <style>{teacherStyles}</style>
        <section className="teacher-shell" aria-label="Teacher dashboard">
          <div className="panel muted loading-panel">Loading teacher console...</div>
        </section>
      </main>
    )
  }

  return (
    <main className="teacher-page">
      <style>{teacherStyles}</style>
      <section className="teacher-shell" aria-label="Teacher dashboard">
        <AuthHeader user={user} role={role} label="Teacher Console" onRefresh={refreshAll} />
        <header className="teacher-topbar">
          <div>
            <p className="teacher-kicker">Techlympics 2026</p>
            <h1>Teacher Console</h1>
          </div>
        </header>

        {notice ? <div className="notice info">{notice}</div> : null}

        {showGate || schools.length === 0 ? (
          <TeacherCodeGate user={user} onBound={handleBound} onCancel={schools.length > 0 ? () => setShowGate(false) : undefined} />
        ) : null}

        {loadingSchools || roleLoading ? <div className="panel muted">Loading teacher schools...</div> : null}

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
              setWorkspaceMode('participants')
            }}
            onSelectClass={(classId) => {
              setSelectedClassId(classId)
              setWorkspaceMode('participants')
            }}
            workspaceMode={workspaceMode}
            onWorkspaceMode={setWorkspaceMode}
            onClassChanged={refreshSchools}
          />
        ) : null}
      </section>
    </main>
  )
}

function Dashboard({
  schools,
  activeSchool,
  activeClass,
  selectedClassId,
  onSelectSchool,
  onSelectClass,
  workspaceMode,
  onWorkspaceMode,
  onClassChanged,
}: {
  schools: TeacherSchoolView[]
  activeSchool: TeacherSchoolView
  activeClass: ActiveClass | null
  selectedClassId: string
  onSelectSchool: (schoolId: string) => void
  onSelectClass: (classId: string) => void
  workspaceMode: WorkspaceMode
  onWorkspaceMode: (mode: WorkspaceMode) => void
  onClassChanged: () => Promise<void>
}) {
  const [classView, setClassView] = useState<ClassViewMode>('cards')
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all')
  const [addClassOpen, setAddClassOpen] = useState(false)
  const gradeOptions = useMemo(() => {
    const grades = new Set<number>()
    let hasOther = false
    activeSchool.classes.forEach((classInfo) => {
      const grade = classGrade(classInfo.name)
      if (grade === 'other') hasOther = true
      else grades.add(grade)
    })
    const options: GradeFilter[] = ['all', ...Array.from(grades).sort((a, b) => a - b).map((grade) => `grade:${grade}` as GradeFilter)]
    if (hasOther) options.push('other')
    return options
  }, [activeSchool.classes])
  const filteredClasses = useMemo(
    () => activeSchool.classes.filter((classInfo) => gradeFilter === 'all' || gradeValue(classInfo) === gradeFilter),
    [activeSchool.classes, gradeFilter],
  )
  const selectedClassVisible = activeClass ? filteredClasses.some((classInfo) => classInfo.id === activeClass.classInfo.id) : false

  useEffect(() => {
    if (!gradeOptions.includes(gradeFilter)) {
      setGradeFilter('all')
    }
  }, [gradeFilter, gradeOptions])

  useEffect(() => {
    if (filteredClasses.length === 0) return
    if (filteredClasses.some((classInfo) => classInfo.id === selectedClassId)) return
    onSelectClass(filteredClasses[0].id)
  }, [filteredClasses, onSelectClass, selectedClassId])

  const changeGradeFilter = (value: GradeFilter) => {
    setGradeFilter(value)
    const nextClasses = activeSchool.classes.filter((classInfo) => value === 'all' || gradeValue(classInfo) === value)
    if (nextClasses.length > 0 && !nextClasses.some((classInfo) => classInfo.id === selectedClassId)) {
      onSelectClass(nextClasses[0].id)
    }
  }

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

      <div className="class-toolbar">
        <div>
          <h2>{activeSchool.school.name}</h2>
          <p>
            {filteredClasses.length} of {activeSchool.classes.length} classes
          </p>
        </div>
        <div className="class-toolbar-actions">
          {gradeOptions.length > 1 ? (
            <div className="grade-filter" aria-label="Class grade filter">
              <div className="segmented compact-segmented grade-filter-tabs" role="group" aria-label="Class grade">
                {gradeOptions.map((option) => (
                  <button key={option} type="button" className={gradeFilter === option ? 'active' : ''} onClick={() => changeGradeFilter(option)}>
                    {gradeLabel(option)}
                  </button>
                ))}
              </div>
              <label className="grade-filter-select">
                Grade
                <select value={gradeFilter} onChange={(event) => changeGradeFilter(event.target.value as GradeFilter)}>
                  {gradeOptions.map((option) => (
                    <option key={option} value={option}>
                      {gradeLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <div className="segmented compact-segmented" role="group" aria-label="Class view">
            <button type="button" className={classView === 'cards' ? 'active' : ''} onClick={() => setClassView('cards')}>
              Cards
            </button>
            <button type="button" className={classView === 'list' ? 'active' : ''} onClick={() => setClassView('list')}>
              List
            </button>
          </div>
          <button type="button" onClick={() => setAddClassOpen(true)}>
            Add class
          </button>
        </div>
      </div>

      {filteredClasses.length > 0 ? (
        classView === 'cards' ? (
          <section className="class-grid" aria-label={`${activeSchool.school.name} classes`}>
            {filteredClasses.map((classInfo) => (
              <ClassCard
                key={classInfo.id}
                schoolName={activeSchool.school.name}
                classInfo={classInfo}
                selected={classInfo.id === selectedClassId}
                onSelect={() => onSelectClass(classInfo.id)}
                onViewRanking={() => {
                  onSelectClass(classInfo.id)
                  onWorkspaceMode('ranking')
                }}
                onClassChanged={onClassChanged}
              />
            ))}
          </section>
        ) : (
          <ClassListView
            schoolName={activeSchool.school.name}
            classes={filteredClasses}
            selectedClassId={selectedClassId}
            onSelectClass={onSelectClass}
            onViewRanking={(classId) => {
              onSelectClass(classId)
              onWorkspaceMode('ranking')
            }}
            onClassChanged={onClassChanged}
          />
        )
      ) : activeSchool.classes.length > 0 ? (
        <div className="panel muted">No classes in this grade.</div>
      ) : null}

      {activeClass && selectedClassVisible ? (
        <ClassWorkspace
          activeClass={activeClass}
          mode={workspaceMode}
          onModeChange={onWorkspaceMode}
          onClassChanged={onClassChanged}
        />
      ) : (
        <div className="panel">No classes yet.</div>
      )}

      {addClassOpen ? (
        <AddClassModal
          school={activeSchool}
          onClose={() => setAddClassOpen(false)}
          onCreated={async (classInfo) => {
            await onClassChanged()
            onSelectClass(classInfo.id)
            onWorkspaceMode('participants')
            setAddClassOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}

function ClassListView({
  schoolName,
  classes,
  selectedClassId,
  onSelectClass,
  onViewRanking,
  onClassChanged,
}: {
  schoolName: string
  classes: ClassDoc[]
  selectedClassId: string
  onSelectClass: (classId: string) => void
  onViewRanking: (classId: string) => void
  onClassChanged: () => Promise<void>
}) {
  const selectedClass = classes.find((classInfo) => classInfo.id === selectedClassId) ?? classes[0]

  return (
    <section className="class-list-layout" aria-label={`${schoolName} class list`}>
      <div className="class-list" role="list">
        {classes.map((classInfo) => (
          <button
            key={classInfo.id}
            type="button"
            className={`class-list-item ${classInfo.id === selectedClass.id ? 'active' : ''}`}
            onClick={() => onSelectClass(classInfo.id)}
          >
            <span>{classInfo.name}</span>
            <strong>{classInfo.joinCode}</strong>
            <em>{classInfo.joinActive ? 'Active' : 'Disabled'}</em>
          </button>
        ))}
      </div>
      <ClassCard
        schoolName={schoolName}
        classInfo={selectedClass}
        selected
        onSelect={() => onSelectClass(selectedClass.id)}
        onViewRanking={() => onViewRanking(selectedClass.id)}
        onClassChanged={onClassChanged}
      />
    </section>
  )
}

function AddClassModal({
  school,
  onClose,
  onCreated,
}: {
  school: TeacherSchoolView
  onClose: () => void
  onCreated: (classInfo: ClassDoc) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const createClass = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast('Enter a class name.', 'error')
      return
    }
    setBusy(true)
    try {
      const classInfo = await api.addClass({ eventId: school.school.eventId, schoolId: school.school.id }, trimmed)
      toast(`${classInfo.name} added.`, 'success')
      await onCreated(classInfo)
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="dialog-panel"
        aria-label="Add class"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void createClass()
        }}
      >
        <h2>Add class</h2>
        <label>
          Class name
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: 4 Amanah" />
        </label>
        <div className="row-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Adding...' : 'Add class'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ClassCard({
  schoolName,
  classInfo,
  selected,
  onSelect,
  onViewRanking,
  onClassChanged,
}: {
  schoolName: string
  classInfo: ClassDoc
  selected: boolean
  onSelect: () => void
  onViewRanking: () => void
  onClassChanged: () => Promise<void>
}) {
  const toast = useToast()
  const [qrOpen, setQrOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'reset' | 'toggle' | ''>('')
  const url = joinUrl(classInfo.joinCode)
  const grade = classGrade(classInfo.name)
  const gradeText = grade === 'other' ? null : `Grade ${grade}`

  const resetCode = async () => {
    if (!window.confirm('Reset this class code? The old code becomes invalid immediately.')) return
    setBusyAction('reset')
    try {
      const nextCode = await api.resetJoinCode(classPath(classInfo))
      toast(`Class code reset to ${nextCode}.`, 'success')
      await onClassChanged()
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusyAction('')
    }
  }

  const toggleActive = async () => {
    const nextActive = !classInfo.joinActive
    setBusyAction('toggle')
    try {
      await api.setJoinActive(classPath(classInfo), nextActive)
      toast(nextActive ? 'Class code enabled.' : 'Class code disabled for new joins.', 'success')
      await onClassChanged()
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusyAction('')
    }
  }

  const copyClassCode = async () => {
    try {
      await copyText(classInfo.joinCode)
      toast(`Class code ${classInfo.joinCode} copied.`, 'success')
    } catch (error) {
      toast(errorText(error), 'error')
    }
  }

  return (
    <article className={`class-card ${selected ? 'selected' : ''}`}>
      <button className="class-card-select" type="button" onClick={onSelect} aria-pressed={selected}>
        <span className="class-card-title">
          <span>{classInfo.name}</span>
          {gradeText ? <span className="class-grade-chip">{gradeText}</span> : null}
        </span>
        <strong>
          <ShimmerText busy={busyAction !== ''}>{classInfo.joinCode}</ShimmerText>
        </strong>
        <em>
          <ShimmerText busy={busyAction === 'toggle'}>{classInfo.joinActive ? 'Active for new joins' : 'New joins disabled'}</ShimmerText>
        </em>
      </button>
      <button className="qr-box" type="button" onClick={() => setQrOpen(true)} aria-label={`Open QR code for ${classInfo.name}`}>
        <QRCodeSVG value={url} size={112} marginSize={1} />
      </button>
      <div className="row-actions compact">
        <button className="secondary" type="button" onClick={copyClassCode}>
          Copy
        </button>
        <button className="secondary" type="button" onClick={onViewRanking}>
          Ranking
        </button>
        <button className="secondary" type="button" onClick={toggleActive} disabled={busyAction === 'toggle'}>
          {busyAction === 'toggle' ? 'Saving...' : classInfo.joinActive ? 'Disable' : 'Enable'}
        </button>
        <button className="danger" type="button" onClick={resetCode} disabled={busyAction === 'reset'}>
          {busyAction === 'reset' ? 'Resetting...' : 'Reset'}
        </button>
      </div>
      {qrOpen ? (
        <PrintSheet schoolName={schoolName} classInfo={classInfo} joinUrlValue={url} onClose={() => setQrOpen(false)} />
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop print-modal" role="presentation" onClick={onClose}>
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label={`${classInfo.name} QR code`} onClick={(event) => event.stopPropagation()}>
        <div className="print-toolbar">
          <button className="ghost" type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={() => window.print()}>
            Print
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
          <p className="print-description">
            Students scan this with their phone camera to open the VibeBlocks app and fill the class code automatically. If the app is not installed,
            they will be sent to the install guide.
          </p>
        </section>
      </div>
    </div>
  )
}

function ClassWorkspace({
  activeClass,
  mode,
  onModeChange,
  onClassChanged,
}: {
  activeClass: ActiveClass
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
  onClassChanged: () => Promise<void>
}) {
  const toast = useToast()
  const [participants, setParticipants] = useState<ParticipantDoc[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [includePending, setIncludePending] = useState(true)
  const [busyParticipantId, setBusyParticipantId] = useState<string>('')
  const [busyBulk, setBusyBulk] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('')
  const [error, setError] = useState('')

  const loadClassData = useCallback(async () => {
    setLoadingData(true)
    setError('')
    try {
      const [nextParticipants, nextLeaderboard] = await Promise.all([
        api.listParticipants(classPath(activeClass.classInfo)),
        api.getLeaderboardByPath(classPath(activeClass.classInfo), { includePending }),
      ])
      setParticipants(nextParticipants)
      setLeaderboard(nextLeaderboard)
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoadingData(false)
    }
  }, [activeClass.classInfo, includePending])

  useEffect(() => {
    void loadClassData()
  }, [loadClassData])

  const setStatus = async (participant: ParticipantDoc, status: ParticipantStatus) => {
    if (status === 'rejected' && !window.confirm(`Reject ${participant.name}?`)) return
    setBusyParticipantId(participant.id)
    setError('')
    try {
      await api.setParticipantStatus(participantPath(participant), status)
      await loadClassData()
      toast(`${participant.name} marked ${statusLabel(status).toLowerCase()}.`, 'success')
    } catch (err) {
      setError(errorText(err))
      toast(errorText(err), 'error')
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
      toast(count === 0 ? 'No pending participants.' : `Approved ${count} participant${count === 1 ? '' : 's'}.`, count === 0 ? 'info' : 'success')
    } catch (err) {
      setError(errorText(err))
      toast(errorText(err), 'error')
    } finally {
      setBusyBulk(false)
    }
  }

  const pendingCount = participants.filter((participant) => participant.status === 'pending').length
  const rankedRows = leaderboard.filter((row) => row.rank !== null).length
  const unrankedRows = leaderboard.filter((row) => row.rank === null && row.attemptsUsed.c1 + row.attemptsUsed.c2 + row.attemptsUsed.c3 > 0).length
  const pendingRows = leaderboard.filter((row) => row.status === 'pending').length

  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="teacher-kicker">{activeClass.school.school.name}</p>
          <h2>{activeClass.classInfo.name}</h2>
        </div>
        <div className="workspace-actions">
          <div className="segmented" role="group" aria-label="Class workspace">
            <button type="button" className={mode === 'participants' ? 'active' : ''} onClick={() => onModeChange('participants')}>
              Participants
            </button>
            <button type="button" className={mode === 'ranking' ? 'active' : ''} onClick={() => onModeChange('ranking')}>
              Ranking
            </button>
          </div>
          {mode === 'participants' ? (
            <button type="button" onClick={approveAll} disabled={busyBulk || pendingCount === 0}>
              {busyBulk ? 'Approving...' : `Approve all (${pendingCount})`}
            </button>
          ) : (
            <button className="secondary" type="button" onClick={() => void loadClassData()} disabled={loadingData}>
              {loadingData ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>
      </header>
      {error ? <div className={`notice ${error === 'No pending participants.' ? 'info' : 'error'}`}>{error}</div> : null}
      {mode === 'participants' ? (
        <div className="workspace-grid">
          <ParticipantsTable participants={participants} busyParticipantId={busyParticipantId} onStatus={setStatus} />
          <RankingSummary rows={leaderboard} loading={loadingData} onOpen={() => onModeChange('ranking')} />
        </div>
      ) : (
        <RankingWorkspace
          rows={leaderboard}
          challenges={activeClass.school.event.challenges}
          attemptsPerChallenge={activeClass.school.event.attemptsPerChallenge}
          includePending={includePending}
          onIncludePending={setIncludePending}
          loading={loadingData}
          lastUpdated={lastUpdated}
          rankedRows={rankedRows}
          unrankedRows={unrankedRows}
          pendingRows={pendingRows}
        />
      )}
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

function RankingSummary({ rows, loading, onOpen }: { rows: LeaderboardRow[]; loading: boolean; onOpen: () => void }) {
  const rankedRows = rows.filter((row) => row.rank !== null).length
  const pendingRows = rows.filter((row) => row.status === 'pending').length
  const visibleRows = rows.filter((row) => row.rank !== null || row.attemptsUsed.c1 + row.attemptsUsed.c2 + row.attemptsUsed.c3 > 0).length

  return (
    <section className="panel table-panel">
      <header className="panel-header">
        <h3>Ranking</h3>
        <span>{loading ? 'Loading' : `${rankedRows} ranked`}</span>
      </header>
      <div className="ranking-summary">
        <strong>{visibleRows}</strong>
        <span>visible participants</span>
        <strong>{pendingRows}</strong>
        <span>pending included</span>
        <button className="secondary" type="button" onClick={onOpen}>
          Ranking
        </button>
      </div>
    </section>
  )
}

function RankingWorkspace({
  rows,
  challenges,
  attemptsPerChallenge,
  includePending,
  onIncludePending,
  loading,
  lastUpdated,
  rankedRows,
  unrankedRows,
  pendingRows,
}: {
  rows: LeaderboardRow[]
  challenges: ChallengeDef[]
  attemptsPerChallenge: number | null
  includePending: boolean
  onIncludePending: (value: boolean) => void
  loading: boolean
  lastUpdated: string
  rankedRows: number
  unrankedRows: number
  pendingRows: number
}) {
  return (
    <section className="ranking-panel" aria-label="Class ranking">
      <div className="ranking-toolbar">
        <div className="segmented" role="group" aria-label="Registration filter">
          <button type="button" className={!includePending ? 'active' : ''} onClick={() => onIncludePending(false)}>
            Registered
          </button>
          <button type="button" className={includePending ? 'active' : ''} onClick={() => onIncludePending(true)}>
            Include pending
          </button>
        </div>
        <p>
          {rankedRows} ranked
          {unrankedRows > 0 ? ` - ${unrankedRows} unranked` : ''}
          {includePending && pendingRows > 0 ? ` - ${pendingRows} pending` : ''}
          {lastUpdated ? ` - updated ${lastUpdated}` : ''}
        </p>
      </div>
      <div className="ranking-table-shell">
        {loading ? <div className="panel muted">Loading ranking...</div> : null}
        <LeaderboardTable rows={rows} challenges={challenges} attemptsPerChallenge={attemptsPerChallenge} />
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
.table-actions,
.workspace-actions,
.class-toolbar-actions,
.ranking-toolbar {
  display: flex;
  align-items: center;
}
.teacher-topbar,
.workspace-header,
.panel-header,
.class-toolbar {
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
.table-actions,
.workspace-actions,
.class-toolbar-actions {
  gap: 8px;
  flex-wrap: wrap;
}
.loading-panel {
  display: grid;
  min-height: 180px;
  place-items: center;
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
input,
select {
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
.class-toolbar {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #dfe5f1;
  border-radius: 8px;
  padding: 14px 16px;
}
.class-toolbar h2,
.dialog-panel h2 {
  margin: 0;
  letter-spacing: 0;
}
.class-toolbar p {
  margin: 4px 0 0;
  color: #667085;
  font-weight: 800;
}
.compact-segmented button {
  min-width: 72px;
}
.grade-filter {
  display: flex;
  min-width: 0;
}
.grade-filter-tabs {
  max-width: min(54vw, 520px);
  overflow-x: auto;
}
.grade-filter-tabs button {
  flex: 0 0 auto;
  white-space: nowrap;
}
.grade-filter-select {
  display: none;
  min-width: 160px;
}
.class-list-layout {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
}
.class-list {
  align-self: start;
  background: white;
  border: 1px solid #dfe5f1;
  border-radius: 8px;
  display: grid;
  overflow: hidden;
}
.class-list-item {
  align-items: center;
  background: white;
  border-bottom: 1px solid #edf1f8;
  border-radius: 0;
  color: #172033;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  justify-content: stretch;
  min-height: 54px;
  padding: 0 14px;
  text-align: left;
}
.class-list-item:last-child {
  border-bottom: 0;
}
.class-list-item.active {
  background: #eef4ff;
  color: #1746ad;
}
.class-list-item span {
  overflow-wrap: anywhere;
}
.class-list-item strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0;
}
.class-list-item em {
  color: #667085;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
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
.class-card-title {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.class-card-title > span:first-child {
  font-size: 16px;
  overflow-wrap: anywhere;
}
.class-grade-chip {
  border: 1px solid #c9d8ff;
  border-radius: 999px;
  background: #eef4ff;
  color: #1746ad;
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
  padding: 5px 7px;
  text-transform: uppercase;
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
.class-card-select em {
  color: #667085;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
}
.qr-box {
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex;
  justify-content: center;
  min-height: 136px;
  width: 100%;
}
.qr-box:hover {
  border-color: #2459d6;
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
.status.withdrawn {
  background: #f2f4f7;
  color: #667085;
}
.public-id {
  color: #667085;
  display: block;
  font-size: 12px;
  margin-top: 3px;
}
.ranking-summary {
  display: grid;
  gap: 7px;
}
.ranking-summary strong {
  color: #172033;
  font-size: 30px;
  line-height: 1;
}
.ranking-summary span {
  color: #667085;
  font-size: 13px;
  font-weight: 800;
}
.ranking-summary button {
  margin-top: 8px;
  width: max-content;
}
.ranking-panel {
  display: grid;
  gap: 12px;
}
.ranking-toolbar {
  justify-content: space-between;
  gap: 12px;
}
.ranking-toolbar p {
  margin: 0;
  color: #667085;
  font-weight: 700;
}
.ranking-table-shell {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #dfe5f1;
  border-radius: 8px;
  background: white;
  box-shadow: 0 8px 22px rgba(29, 44, 77, .06);
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: rgba(15, 23, 42, .42);
  display: grid;
  place-items: center;
  padding: clamp(12px, 4vw, 24px);
}
.dialog-panel,
.print-dialog {
  width: min(680px, calc(100vw - 24px));
}
.print-dialog {
  max-height: calc(100dvh - 24px);
  overflow: auto;
  overscroll-behavior: contain;
}
.dialog-panel {
  background: white;
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, .22);
  display: grid;
  gap: 16px;
  padding: 20px;
}
.dialog-panel .row-actions {
  justify-content: flex-end;
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
  box-sizing: border-box;
  color: #111827;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-height: calc(100vh - 120px);
  padding: 48px;
  width: 100%;
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
.print-qr svg {
  height: auto;
  max-width: min(280px, 60vw);
}
.print-code {
  font-size: 42px;
  font-weight: 900;
  margin: 0 0 20px;
}
.print-description {
  color: #344054;
  font-size: 18px;
  line-height: 1.6;
  margin: 0;
  max-width: 520px;
  text-align: center;
}
@media (max-width: 820px) {
  .teacher-page {
    padding: 14px;
  }
  .teacher-topbar,
  .workspace-header,
  .class-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .workspace-grid {
    grid-template-columns: 1fr;
  }
  .class-list-layout {
    grid-template-columns: 1fr;
  }
  .workspace-actions,
  .ranking-toolbar,
  .class-toolbar-actions {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }
  .grade-filter,
  .grade-filter-select {
    width: 100%;
  }
  .grade-filter-tabs {
    max-width: 100%;
  }
}
@media (max-width: 560px) {
  .teacher-page {
    padding: 10px;
  }
  .class-grid {
    grid-template-columns: 1fr;
  }
  .class-card,
  .panel,
  .workspace {
    padding: 12px;
  }
  .grade-filter-tabs {
    display: none;
  }
  .grade-filter-select {
    display: grid;
  }
  .print-toolbar {
    margin-bottom: 8px;
  }
  .print-sheet {
    aspect-ratio: auto;
    max-height: none;
    overflow: visible;
    padding: 18px;
  }
  .print-sheet h1 {
    font-size: clamp(20px, 6.5vw, 28px);
  }
  .print-sheet h2 {
    font-size: clamp(18px, 5.8vw, 24px);
  }
  .print-qr {
    margin: 18px 0 12px;
  }
  .print-qr svg {
    max-width: min(220px, 68vw);
  }
  .print-code {
    font-size: clamp(26px, 9vw, 38px);
    margin-bottom: 12px;
  }
  .print-description {
    font-size: 14px;
    line-height: 1.45;
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
  .print-sheet svg,
  .print-qr svg {
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }
  .print-qr {
    display: block !important;
  }
  .print-sheet {
    height: 100vh;
    max-height: none;
    width: 100%;
  }
}
`
