import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import * as XLSX from 'xlsx'
import { api } from '../../api'
import type { EventDoc, EventStats, ImportResult, ImportRow, OrganizerSchoolView } from '../../api/types'
import { sampleImportRows } from './fixtures/sampleImportRows'
import './organizer.css'

type OrganizerTab = 'events' | 'import' | 'schools' | 'print'
type ImportField = keyof ImportRow

interface ParsedWorkbook {
  fileName: string
  sheets: Record<string, string[][]>
  sheetName: string
}

interface PreviewRow {
  index: number
  source: Record<string, string>
  mapped: ImportRow
  selected: boolean
  warnings: string[]
}

const requiredFields: ImportField[] = ['schoolName', 'className']
const importFields: ImportField[] = ['schoolName', 'className', 'state', 'zone']

const fieldLabels: Record<ImportField, string> = {
  schoolName: 'School name',
  className: 'Class name',
  state: 'State',
  zone: 'Zone',
}

const blankEvent = () => {
  const start = new Date()
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  return {
    name: '',
    startsAt: toDateTimeLocal(start.toISOString()),
    endsAt: toDateTimeLocal(end.toISOString()),
    attemptsPerChallenge: 3,
  }
}

function toDateTimeLocal(iso: string) {
  return iso.slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  return new Date(value).toISOString()
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizedCell(value: unknown) {
  return String(value ?? '').trim()
}

function pickInitialMapping(headers: string[]): Record<ImportField, string> {
  const findHeader = (candidates: string[]) =>
    headers.find((header) => candidates.some((candidate) => header.toLowerCase().replace(/\s+/g, '').includes(candidate))) ?? ''
  return {
    schoolName: findHeader(['school', 'schoolname', 'nama sekolah', 'sekolah']),
    className: findHeader(['class', 'classname', 'kelas']),
    state: findHeader(['state', 'negeri']),
    zone: findHeader(['zone', 'zon']),
  }
}

function buildPreview(rows: string[][], mapping: Record<ImportField, string>, selected: Set<number>): PreviewRow[] {
  const headers = rows[0] ?? []
  const body = rows.slice(1).filter((row) => row.some((cell) => normalizedCell(cell)))
  const seen = new Map<string, number>()
  return body.map((row, bodyIndex) => {
    const source = Object.fromEntries(headers.map((header, i) => [header, normalizedCell(row[i])]))
    const mapped: ImportRow = {
      schoolName: normalizedCell(source[mapping.schoolName]),
      className: normalizedCell(source[mapping.className]),
      state: normalizedCell(source[mapping.state]) || undefined,
      zone: normalizedCell(source[mapping.zone]) || undefined,
    }
    const warnings: string[] = []
    requiredFields.forEach((field) => {
      if (!mapped[field]?.trim()) warnings.push(`${fieldLabels[field]} empty`)
    })
    const dupKey = `${mapped.schoolName.toLowerCase()}::${mapped.className.toLowerCase()}`
    if (mapped.schoolName && mapped.className) {
      const first = seen.get(dupKey)
      if (first !== undefined) warnings.push(`Duplicate of row ${first + 2}`)
      else seen.set(dupKey, bodyIndex)
    }
    return {
      index: bodyIndex,
      source,
      mapped,
      selected: selected.has(bodyIndex),
      warnings,
    }
  })
}

async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheets = Object.fromEntries(
    workbook.SheetNames.map((name) => [
      name,
      XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, defval: '' }) as string[][],
    ]),
  )
  return { fileName: file.name, sheets, sheetName: workbook.SheetNames[0] ?? '' }
}

function downloadSampleWorkbook() {
  const worksheet = XLSX.utils.json_to_sheet(sampleImportRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'schools')
  XLSX.writeFile(workbook, 'techlympics-import-sample.xlsx')
}

function downloadResultWorkbook(rows: PreviewRow[], schools: OrganizerSchoolView[]) {
  const output = rows.map((row) => {
    const school = schools.find((item) => item.school.name.toLowerCase() === row.mapped.schoolName.toLowerCase())
    const classInfo = school?.classes.find((item) => item.classInfo.name.toLowerCase() === row.mapped.className.toLowerCase())
    return {
      ...row.source,
      schoolName: row.mapped.schoolName,
      className: row.mapped.className,
      state: row.mapped.state ?? '',
      zone: row.mapped.zone ?? '',
      teacherCode: school?.school.teacherCode ?? '',
      joinCode: classInfo?.classInfo.joinCode ?? '',
      importStatus: classInfo ? 'created-or-existing' : 'skipped',
    }
  })
  const worksheet = XLSX.utils.json_to_sheet(output)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'import-result')
  XLSX.writeFile(workbook, 'techlympics-import-result.xlsx')
}

export default function OrganizerDashboard() {
  return <OrganizerWorkspace />
}

function OrganizerWorkspace() {
  const [tab, setTab] = useState<OrganizerTab>('events')
  const [events, setEvents] = useState<EventDoc[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [stats, setStats] = useState<EventStats | null>(null)
  const [schools, setSchools] = useState<OrganizerSchoolView[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0]

  const refresh = async (eventId = selectedEvent?.id) => {
    setError('')
    try {
      const nextEvents = await api.listEvents()
      setEvents(nextEvents)
      const nextEventId = eventId || nextEvents[0]?.id || ''
      setSelectedEventId(nextEventId)
      if (nextEventId) {
        const [nextStats, nextSchools] = await Promise.all([api.getEventStats(nextEventId), api.listEventSchools(nextEventId)])
        setStats(nextStats)
        setSchools(nextSchools)
      } else {
        setStats(null)
        setSchools([])
      }
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const printNotices = () => {
    window.setTimeout(() => window.print(), 50)
  }

  return (
    <section className="ops-workspace">
      <div className="ops-topbar">
        <div>
          <p className="ops-eyebrow">Techlympics admin</p>
          <h1>Admin Console</h1>
          <p className="ops-subtle">Manage events, school imports, codes, and class notices.</p>
        </div>
        <button className="ops-button" onClick={() => void refresh()}>Refresh</button>
      </div>

      {error && <div className="ops-alert">{error}</div>}
      {notice && <div className="ops-alert ops-success">{notice}</div>}

      <div className="ops-grid">
        <aside className="ops-panel">
          <h2>Events</h2>
          <div className="ops-event-list">
            {events.map((event) => (
              <button
                className={`ops-event-button ${event.id === selectedEvent?.id ? 'active' : ''}`}
                key={event.id}
                onClick={() => void refresh(event.id)}
              >
                <strong>{event.name}</strong>
                <br />
                <span className="ops-subtle">{toDateTimeLocal(event.startsAt)} - {toDateTimeLocal(event.endsAt)}</span>
                <br />
                <span className={`ops-pill ${event.frozen ? 'warn' : 'ok'}`}>{event.frozen ? 'Frozen' : 'Open'}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="ops-stack">
          <div className="ops-panel">
            <div className="ops-topbar">
              <div>
                <h2>{selectedEvent?.name ?? 'No event selected'}</h2>
                <p className="ops-subtle">Selected event controls</p>
              </div>
              {selectedEvent && <span className={`ops-pill ${selectedEvent.frozen ? 'warn' : 'ok'}`}>{selectedEvent.frozen ? 'Frozen' : 'Open'}</span>}
            </div>
            <div className="ops-tabs">
              {(['events', 'import', 'schools', 'print'] as OrganizerTab[]).map((item) => (
                <button className={`ops-tab ${tab === item ? 'active' : ''}`} key={item} onClick={() => setTab(item)}>
                  {item === 'events' ? 'Event setup' : item === 'import' ? 'Bulk import' : item === 'schools' ? 'Schools' : 'Print notices'}
                </button>
              ))}
            </div>
          </div>

          {stats && <StatsPanel stats={stats} />}
          {tab === 'events' && <EventEditor event={selectedEvent} onSaved={(message) => { setNotice(message); void refresh(selectedEvent?.id) }} />}
          {tab === 'import' && selectedEvent && <ImportWizard event={selectedEvent} onImported={async (message) => { setNotice(message); await refresh(selectedEvent.id) }} />}
          {tab === 'schools' && selectedEvent && <SchoolsPanel event={selectedEvent} schools={schools} onChanged={() => void refresh(selectedEvent.id)} />}
          {tab === 'print' && <PrintPanel schools={schools} onPrint={printNotices} />}
        </section>
      </div>
    </section>
  )
}

function StatsPanel({ stats }: { stats: EventStats }) {
  return (
    <section className="ops-panel">
      <div className="ops-stat-grid">
        <div className="ops-stat"><span className="ops-subtle">Schools</span><strong>{stats.schoolCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">Classes</span><strong>{stats.classCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">Participants</span><strong>{stats.participantCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">Submissions</span><strong>{stats.attemptCount}</strong></div>
      </div>
    </section>
  )
}

function EventEditor({ event, onSaved }: { event?: EventDoc; onSaved: (message: string) => void }) {
  const [form, setForm] = useState(blankEvent)
  const [error, setError] = useState('')

  useEffect(() => {
    if (event) {
      setForm({
        name: event.name,
        startsAt: toDateTimeLocal(event.startsAt),
        endsAt: toDateTimeLocal(event.endsAt),
        attemptsPerChallenge: event.attemptsPerChallenge,
      })
    }
  }, [event])

  const save = async () => {
    setError('')
    try {
      if (event) {
        await api.updateEvent(event.id, {
          name: form.name,
          startsAt: fromDateTimeLocal(form.startsAt),
          endsAt: fromDateTimeLocal(form.endsAt),
          attemptsPerChallenge: form.attemptsPerChallenge,
        })
        onSaved('Event updated.')
      } else {
        const created = await api.createEvent({
          name: form.name,
          startsAt: fromDateTimeLocal(form.startsAt),
          endsAt: fromDateTimeLocal(form.endsAt),
          attemptsPerChallenge: form.attemptsPerChallenge,
        })
        onSaved(`Event created: ${created.name}`)
      }
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const createNew = async () => {
    setError('')
    try {
      const created = await api.createEvent({
        name: form.name || 'New Techlympics Event',
        startsAt: fromDateTimeLocal(form.startsAt),
        endsAt: fromDateTimeLocal(form.endsAt),
        attemptsPerChallenge: form.attemptsPerChallenge,
      })
      onSaved(`Event created: ${created.name}`)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const toggleFrozen = async () => {
    if (!event) return
    const next = !event.frozen
    const ok = window.confirm(next ? 'Freeze this event and block new submissions?' : 'Unfreeze this event and allow submissions again?')
    if (!ok) return
    try {
      await api.updateEvent(event.id, { frozen: next })
      onSaved(next ? 'Event frozen.' : 'Event unfrozen.')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <h2>Event management</h2>
        {event && <button className={`ops-button ${event.frozen ? '' : 'danger'}`} onClick={() => void toggleFrozen()}>{event.frozen ? 'Unfreeze' : 'Freeze'}</button>}
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-form two">
        <label className="ops-label">Name<input className="ops-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="ops-label">Max attempts<input className="ops-input" min={1} type="number" value={form.attemptsPerChallenge} onChange={(e) => setForm({ ...form, attemptsPerChallenge: Number(e.target.value) })} /></label>
        <label className="ops-label">Starts at<input className="ops-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
        <label className="ops-label">Ends at<input className="ops-input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
      </div>
      <div className="ops-row-actions" style={{ marginTop: 12 }}>
        <button className="ops-button primary" onClick={() => void save()} disabled={!form.name.trim()}>{event ? 'Save selected event' : 'Create event'}</button>
        <button className="ops-button" onClick={() => void createNew()}>Create as new</button>
      </div>
    </section>
  )
}

function ImportWizard({ event, onImported }: { event: EventDoc; onImported: (message: string) => Promise<void> }) {
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [mapping, setMapping] = useState<Record<ImportField, string>>({ schoolName: '', className: '', state: '', zone: '' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [resultRows, setResultRows] = useState<PreviewRow[]>([])
  const [error, setError] = useState('')

  const rows = workbook ? workbook.sheets[workbook.sheetName] ?? [] : []
  const headers = rows[0] ?? []
  const preview = useMemo(() => buildPreview(rows, mapping, selected), [rows, mapping, selected])
  const importable = preview.filter((row) => row.selected)

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setResult(null)
    try {
      const parsed = await parseWorkbook(file)
      const nextRows = parsed.sheets[parsed.sheetName] ?? []
      const bodyIndexes = nextRows.slice(1).map((_, index) => index)
      setWorkbook(parsed)
      setSelected(new Set(bodyIndexes))
      setMapping(pickInitialMapping(nextRows[0] ?? []))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const importSelected = async () => {
    setError('')
    try {
      const response = await api.importSchools(event.id, importable.map((row) => row.mapped))
      setResult(response)
      setResultRows(importable)
      await onImported(`Import finished: ${response.classes.length} classes created, ${response.skipped.length} skipped.`)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const downloadResult = async () => {
    const latestSchools = await api.listEventSchools(event.id)
    downloadResultWorkbook(resultRows, latestSchools)
  }

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>Bulk import wizard</h2>
          <p className="ops-subtle">Upload xlsx/csv, map columns, review rows, then download codes.</p>
        </div>
        <button className="ops-button" onClick={downloadSampleWorkbook}>Download sample xlsx</button>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-form two">
        <label className="ops-label">Upload xlsx/csv<input className="ops-file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void loadFile(e.target.files?.[0])} /></label>
        {workbook && (
          <label className="ops-label">Sheet
            <select className="ops-select" value={workbook.sheetName} onChange={(e) => setWorkbook({ ...workbook, sheetName: e.target.value })}>
              {Object.keys(workbook.sheets).map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
          </label>
        )}
      </div>

      {workbook && (
        <>
          <div className="ops-panel" style={{ marginTop: 12 }}>
            <h3>Column mapping</h3>
            <div className="ops-form two" style={{ marginTop: 10 }}>
              {importFields.map((field) => (
                <label className="ops-label" key={field}>{fieldLabels[field]}
                  <select className="ops-select" value={mapping[field]} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                    <option value="">Not mapped</option>
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="ops-table-wrap" style={{ marginTop: 12 }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>School</th>
                  <th>Class</th>
                  <th>State</th>
                  <th>Zone</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.index}>
                    <td><input type="checkbox" checked={row.selected} onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(row.index)
                      else next.delete(row.index)
                      setSelected(next)
                    }} /></td>
                    <td>{row.mapped.schoolName}</td>
                    <td>{row.mapped.className}</td>
                    <td>{row.mapped.state}</td>
                    <td>{row.mapped.zone}</td>
                    <td>{row.warnings.length ? row.warnings.map((warning) => <span className="ops-pill warn" key={warning}>{warning}</span>) : <span className="ops-pill ok">Ready</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-row-actions" style={{ marginTop: 12 }}>
            <button className="ops-button primary" disabled={importable.length === 0} onClick={() => void importSelected()}>Import selected rows</button>
            <span className="ops-subtle">{importable.length} rows selected</span>
          </div>
        </>
      )}

      {result && (
        <div className="ops-alert ops-success" style={{ marginTop: 12 }}>
          Created {result.classes.length} classes. Skipped {result.skipped.length}.
          <div className="ops-row-actions" style={{ marginTop: 8 }}>
            <button className="ops-button" onClick={() => void downloadResult()}>Download result xlsx with codes</button>
          </div>
        </div>
      )}
    </section>
  )
}

function SchoolsPanel({ event, schools, onChanged }: { event: EventDoc; schools: OrganizerSchoolView[]; onChanged: () => void }) {
  const [error, setError] = useState('')

  const resetCode = async (schoolId: string) => {
    const ok = window.confirm('Reset this school teacher code? The previous code will stop being useful for new teacher binding.')
    if (!ok) return
    setError('')
    try {
      await api.resetTeacherCode({ eventId: event.id, schoolId })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <section className="ops-panel">
      <h2>School and class status</h2>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>School</th>
              <th>Teacher code</th>
              <th>Class</th>
              <th>Join code</th>
              <th>Participants</th>
              <th>Approved</th>
              <th>Submitted</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {schools.flatMap((school) =>
              school.classes.map((classStats, index) => (
                <tr key={`${school.school.id}-${classStats.classInfo.id}`}>
                  <td>{index === 0 ? <><strong>{school.school.name}</strong><br /><span className="ops-subtle">{school.school.state} {school.school.zone}</span></> : ''}</td>
                  <td>{index === 0 ? <code>{school.school.teacherCode}</code> : ''}</td>
                  <td>{classStats.classInfo.name}</td>
                  <td><code>{classStats.classInfo.joinCode}</code></td>
                  <td>{classStats.participantCount}</td>
                  <td>{classStats.approvedCount}</td>
                  <td>{classStats.submittedCount}</td>
                  <td>{index === 0 ? <button className="ops-button" onClick={() => void resetCode(school.school.id)}>Reset teacher code</button> : ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PrintPanel({ schools, onPrint }: { schools: OrganizerSchoolView[]; onPrint: () => void }) {
  const classCount = schools.reduce((sum, school) => sum + school.classes.length, 0)
  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>Class QR notices</h2>
          <p className="ops-subtle">{classCount} class notices ready. Each class prints on a separate page.</p>
        </div>
        <button className="ops-button primary" disabled={classCount === 0} onClick={onPrint}>Print all notices</button>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead><tr><th>School</th><th>Class</th><th>Join code</th><th>QR target</th></tr></thead>
          <tbody>
            {schools.flatMap((school) => school.classes.map((classStats) => {
              const url = `${window.location.origin}/join/${classStats.classInfo.joinCode}`
              return <tr key={classStats.classInfo.id}><td>{school.school.name}</td><td>{classStats.classInfo.name}</td><td><code>{classStats.classInfo.joinCode}</code></td><td>{url}</td></tr>
            }))}
          </tbody>
        </table>
      </div>
      <div className="ops-print-area">
        {schools.flatMap((school) => school.classes.map((classStats) => {
          const url = `${window.location.origin}/join/${classStats.classInfo.joinCode}`
          return (
            <section className="ops-print-sheet" key={classStats.classInfo.id}>
              <div>
                <p className="ops-eyebrow">Techlympics class access</p>
                <h2>{school.school.name}</h2>
                <h3>{classStats.classInfo.name}</h3>
                <QRCodeSVG value={url} size={220} />
                <div className="ops-print-code">{classStats.classInfo.joinCode}</div>
                <p>{url}</p>
              </div>
            </section>
          )
        }))}
      </div>
    </section>
  )
}
