import { Fragment, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../api'
import { formatSec } from '../../api/scoring'
import type { ChallengeDef, ChallengeSlot, EventDoc, EventStats, ImportResult, ImportRow, LeaderboardRow } from '../../api/types'
import { useToast } from '../../lib/toast'
import { sampleImportRows } from './fixtures/sampleImportRows'
import './admin.css'

type AdminTab = 'events' | 'import' | 'schools'
type ImportField = keyof ImportRow
type AdminSchoolView = Awaited<ReturnType<typeof api.listEventSchools>>[number]

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

interface EventForm {
  name: string
  startsAt: string
  endsAt: string
  attemptsPerChallenge: number | null
}

const requiredFields: ImportField[] = ['schoolName', 'className']
const importFields: ImportField[] = ['schoolName', 'className', 'state', 'zone']

const fieldLabels: Record<ImportField, string> = {
  schoolName: 'School name',
  className: 'Class name',
  state: 'State',
  zone: 'Zone',
}

const fallbackChallenges: ChallengeDef[] = [
  { slot: 'c1', missionId: 201, name: 'Challenge 1' },
  { slot: 'c2', missionId: 202, name: 'Challenge 2' },
  { slot: 'c3', missionId: 203, name: 'Challenge 3' },
]

function blankEvent(): EventForm {
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

function normalizedSearch(value: string | undefined) {
  return (value ?? '').trim().toLowerCase()
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

function downloadResultWorkbook(rows: PreviewRow[], schools: AdminSchoolView[]) {
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
      importStatus: classInfo ? 'created-or-existing' : 'skipped',
    }
  })
  const worksheet = XLSX.utils.json_to_sheet(output)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'import-result')
  XLSX.writeFile(workbook, 'techlympics-import-result.xlsx')
}

function eventToForm(event: EventDoc): EventForm {
  return {
    name: event.name,
    startsAt: toDateTimeLocal(event.startsAt),
    endsAt: toDateTimeLocal(event.endsAt),
    attemptsPerChallenge: event.attemptsPerChallenge,
  }
}

function totalAttempts(row: LeaderboardRow) {
  return row.attemptsUsed.c1 + row.attemptsUsed.c2 + row.attemptsUsed.c3
}

function completedChallenges(row: LeaderboardRow, challenges: ChallengeDef[]) {
  return challenges.filter((challenge) => row.bests[challenge.slot] !== undefined).length
}

function statusLabel(status: LeaderboardRow['status']) {
  if (status === 'approved') return 'Registered'
  if (status === 'pending') return 'Pending'
  if (status === 'withdrawn') return 'Withdrawn'
  return 'Rejected'
}

function challengeShortLabel(slot: ChallengeSlot) {
  return slot.toUpperCase()
}

function attemptLimitText(limit: number | null) {
  return limit === null ? 'Unlimited' : String(limit)
}

export default function AdminDashboard() {
  const toast = useToast()
  const [tab, setTab] = useState<AdminTab>('events')
  const [events, setEvents] = useState<EventDoc[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [stats, setStats] = useState<EventStats | null>(null)
  const [schools, setSchools] = useState<AdminSchoolView[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0]

  const refresh = async (eventId = selectedEvent?.id) => {
    setRefreshing(true)
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

  return (
    <section className="ops-workspace">
      <div className="ops-topbar">
        <div>
          <p className="ops-eyebrow">Techlympics admin</p>
          <h1>Admin Console</h1>
          <p className="ops-subtle">Manage events, school imports, teacher codes, and class rankings.</p>
        </div>
        <button className="ops-button" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <div className="ops-alert">{error}</div>}

      <div className="ops-grid">
        <aside className="ops-panel">
          <div className="ops-topbar compact">
            <h2>Events</h2>
            <button className="ops-button primary" onClick={() => setCreateOpen(true)}>New</button>
          </div>
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
                <p className="ops-subtle">Students can submit only during the event period. Frozen events block submissions immediately.</p>
              </div>
              {selectedEvent && <span className={`ops-pill ${selectedEvent.frozen ? 'warn' : 'ok'}`}>{selectedEvent.frozen ? 'Frozen' : 'Open'}</span>}
            </div>
            <div className="ops-tabs">
              {(['events', 'import', 'schools'] as AdminTab[]).map((item) => (
                <button className={`ops-tab ${tab === item ? 'active' : ''}`} key={item} onClick={() => setTab(item)}>
                  {item === 'events' ? 'Event setup' : item === 'import' ? 'Import' : 'Schools'}
                </button>
              ))}
            </div>
          </div>

          {stats && <StatsPanel stats={stats} />}
          {tab === 'events' && selectedEvent && (
            <EventEditor
              event={selectedEvent}
              onSaved={async (message) => {
                toast(message, 'success')
                await refresh(selectedEvent.id)
              }}
            />
          )}
          {tab === 'import' && selectedEvent && (
            <ImportPanel
              event={selectedEvent}
              onImported={async (message) => {
                toast(message, 'success')
                await refresh(selectedEvent.id)
              }}
            />
          )}
          {tab === 'schools' && selectedEvent && (
            <SchoolsPanel
              event={selectedEvent}
              schools={schools}
              onChanged={async (message) => {
                toast(message, 'success')
                await refresh(selectedEvent.id)
              }}
            />
          )}
        </section>
      </div>

      {createOpen && (
        <EventCreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (created) => {
            setCreateOpen(false)
            toast(`Event created: ${created.name}`, 'success')
            await refresh(created.id)
          }}
        />
      )}
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

function AttemptsControl({ form, onChange }: { form: EventForm; onChange: (next: EventForm) => void }) {
  const unlimited = form.attemptsPerChallenge === null
  return (
    <div className="ops-label">
      <span>Attempts per challenge</span>
      <div className="ops-inline-control">
        <input
          className="ops-input"
          disabled={unlimited}
          min={1}
          type="number"
          value={form.attemptsPerChallenge ?? ''}
          onChange={(event) => onChange({ ...form, attemptsPerChallenge: Math.max(1, Number(event.target.value) || 1) })}
        />
        <label className="ops-check">
          <input
            checked={unlimited}
            type="checkbox"
            onChange={(event) => onChange({ ...form, attemptsPerChallenge: event.target.checked ? null : 3 })}
          />
          Unlimited
        </label>
      </div>
    </div>
  )
}

function EventEditor({ event, onSaved }: { event: EventDoc; onSaved: (message: string) => Promise<void> }) {
  const toast = useToast()
  const [form, setForm] = useState<EventForm>(() => eventToForm(event))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [freezing, setFreezing] = useState(false)

  useEffect(() => {
    setForm(eventToForm(event))
    setError('')
  }, [event.id])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await api.updateEvent(event.id, {
        name: form.name,
        startsAt: fromDateTimeLocal(form.startsAt),
        endsAt: fromDateTimeLocal(form.endsAt),
        attemptsPerChallenge: form.attemptsPerChallenge,
      })
      await onSaved('Event updated.')
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleFrozen = async () => {
    const next = !event.frozen
    const ok = window.confirm(next ? 'Freeze this event and block new submissions?' : 'Unfreeze this event and allow submissions again?')
    if (!ok) return
    setFreezing(true)
    setError('')
    try {
      await api.updateEvent(event.id, { frozen: next })
      await onSaved(next ? 'Event frozen.' : 'Event unfrozen.')
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setFreezing(false)
    }
  }

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>Event management</h2>
          <p className="ops-subtle">New events are created from the New button. This form edits the selected event.</p>
        </div>
        <button className={`ops-button ${event.frozen ? '' : 'danger'}`} disabled={freezing} onClick={() => void toggleFrozen()}>
          {freezing ? 'Saving...' : event.frozen ? 'Unfreeze' : 'Freeze'}
        </button>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-form two">
        <label className="ops-label">Name<input className="ops-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <AttemptsControl form={form} onChange={setForm} />
        <label className="ops-label">Starts at<input className="ops-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
        <label className="ops-label">Ends at<input className="ops-input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
      </div>
      <div className="ops-row-actions" style={{ marginTop: 12 }}>
        <button className="ops-button primary" onClick={() => void save()} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

function EventCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (event: EventDoc) => Promise<void> }) {
  const toast = useToast()
  const [form, setForm] = useState<EventForm>(blankEvent)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const create = async () => {
    setSaving(true)
    setError('')
    try {
      const created = await api.createEvent({
        name: form.name,
        startsAt: fromDateTimeLocal(form.startsAt),
        endsAt: fromDateTimeLocal(form.endsAt),
        attemptsPerChallenge: form.attemptsPerChallenge,
      })
      await onCreated(created)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ops-modal-backdrop" role="presentation">
      <section aria-modal="true" className="ops-modal" role="dialog">
        <div className="ops-topbar">
          <div>
            <p className="ops-eyebrow">New event</p>
            <h2>Create event</h2>
          </div>
          <button className="ops-button" disabled={saving} onClick={onClose}>Close</button>
        </div>
        {error && <div className="ops-alert">{error}</div>}
        <div className="ops-form two">
          <label className="ops-label">Name<input className="ops-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <AttemptsControl form={form} onChange={setForm} />
          <label className="ops-label">Starts at<input className="ops-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
          <label className="ops-label">Ends at<input className="ops-input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
        </div>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button className="ops-button primary" disabled={saving || !form.name.trim()} onClick={() => void create()}>
            {saving ? 'Creating...' : 'Create event'}
          </button>
        </div>
      </section>
    </div>
  )
}

function ImportPanel({ event, onImported }: { event: EventDoc; onImported: (message: string) => Promise<void> }) {
  const toast = useToast()
  const [single, setSingle] = useState<ImportRow>({ schoolName: '', state: '', className: '' })
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [mapping, setMapping] = useState<Record<ImportField, string>>({ schoolName: '', className: '', state: '', zone: '' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [resultRows, setResultRows] = useState<PreviewRow[]>([])
  const [error, setError] = useState('')
  const [singleBusy, setSingleBusy] = useState(false)
  const [workbookBusy, setWorkbookBusy] = useState(false)

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
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    }
  }

  const importSingle = async () => {
    setSingleBusy(true)
    setError('')
    try {
      const response = await api.importSchools(event.id, [{
        schoolName: single.schoolName.trim(),
        className: single.className.trim(),
        state: single.state?.trim() || undefined,
      }])
      setSingle({ schoolName: '', state: '', className: '' })
      await onImported(`Import finished: ${response.classes.length} class created, ${response.skipped.length} skipped.`)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setSingleBusy(false)
    }
  }

  const importSelected = async () => {
    setWorkbookBusy(true)
    setError('')
    try {
      const response = await api.importSchools(event.id, importable.map((row) => row.mapped))
      setResult(response)
      setResultRows(importable)
      await onImported(`Import finished: ${response.classes.length} classes created, ${response.skipped.length} skipped.`)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setWorkbookBusy(false)
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
          <h2>Import</h2>
          <p className="ops-subtle">Add one class or upload a workbook. Result exports include teacher codes only.</p>
        </div>
        <button className="ops-button" onClick={downloadSampleWorkbook}>Download sample xlsx</button>
      </div>
      {error && <div className="ops-alert">{error}</div>}

      <section className="ops-subsection">
        <h3>Add one class</h3>
        <div className="ops-form three">
          <label className="ops-label">School name<input className="ops-input" value={single.schoolName} onChange={(e) => setSingle({ ...single, schoolName: e.target.value })} /></label>
          <label className="ops-label">State<input className="ops-input" value={single.state ?? ''} onChange={(e) => setSingle({ ...single, state: e.target.value })} /></label>
          <label className="ops-label">Class name<input className="ops-input" value={single.className} onChange={(e) => setSingle({ ...single, className: e.target.value })} /></label>
        </div>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button className="ops-button primary" disabled={singleBusy || !single.schoolName.trim() || !single.className.trim()} onClick={() => void importSingle()}>
            {singleBusy ? 'Importing...' : 'Import class'}
          </button>
        </div>
      </section>

      <section className="ops-subsection">
        <h3>Workbook import</h3>
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
            <div className="ops-mapping-box" style={{ marginTop: 12 }}>
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
              <button className="ops-button primary" disabled={workbookBusy || importable.length === 0} onClick={() => void importSelected()}>
                {workbookBusy ? 'Importing...' : 'Import selected rows'}
              </button>
              <span className="ops-subtle">{importable.length} rows selected</span>
            </div>
          </>
        )}
      </section>

      {result && (
        <div className="ops-alert ops-success" style={{ marginTop: 12 }}>
          Created {result.classes.length} classes. Skipped {result.skipped.length}.
          <div className="ops-row-actions" style={{ marginTop: 8 }}>
            <button className="ops-button" onClick={() => void downloadResult()}>Download result xlsx with teacher codes</button>
          </div>
        </div>
      )}
    </section>
  )
}

function SchoolsPanel({
  event,
  schools,
  onChanged,
}: {
  event: EventDoc
  schools: AdminSchoolView[]
  onChanged: (message: string) => Promise<void>
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rankingKey, setRankingKey] = useState('')
  const [rankingRows, setRankingRows] = useState<LeaderboardRow[]>([])
  const [busySchoolId, setBusySchoolId] = useState('')
  const [busyRankingKey, setBusyRankingKey] = useState('')
  const [error, setError] = useState('')

  const filteredSchools = useMemo(() => {
    const q = normalizedSearch(query)
    if (!q) return schools
    return schools.filter((school) => {
      const name = normalizedSearch(school.school.name)
      const state = normalizedSearch(school.school.state)
      return name.includes(q) || state.includes(q)
    })
  }, [query, schools])

  const toggleExpanded = (schoolId: string) => {
    const next = new Set(expanded)
    if (next.has(schoolId)) next.delete(schoolId)
    else next.add(schoolId)
    setExpanded(next)
  }

  const copyTeacherCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    toast('Teacher code copied.', 'success')
  }

  const resetCode = async (schoolId: string) => {
    const ok = window.confirm('Reset this school teacher code? The previous code will stop working for new teacher binding.')
    if (!ok) return
    setBusySchoolId(schoolId)
    setError('')
    try {
      await api.resetTeacherCode({ eventId: event.id, schoolId })
      await onChanged('Teacher code reset.')
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusySchoolId('')
    }
  }

  const viewRanking = async (schoolId: string, classId: string) => {
    const key = `${schoolId}:${classId}`
    if (rankingKey === key) {
      setRankingKey('')
      setRankingRows([])
      return
    }
    setBusyRankingKey(key)
    setError('')
    try {
      const rows = await api.getLeaderboardByPath({ eventId: event.id, schoolId, classId }, { includePending: true })
      setRankingKey(key)
      setRankingRows(rows)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusyRankingKey('')
    }
  }

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>Schools</h2>
          <p className="ops-subtle">Search by school name or state. Expand a school to inspect classes and rankings.</p>
        </div>
        <label className="ops-search">Search<input className="ops-input" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>School</th>
              <th>State</th>
              <th>Teacher code</th>
              <th>Classes</th>
              <th>Participants</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchools.map((school) => {
              const schoolId = school.school.id
              const isExpanded = expanded.has(schoolId)
              const participantCount = school.classes.reduce((sum, item) => sum + item.participantCount, 0)
              return (
                <Fragment key={schoolId}>
                  <tr>
                    <td>
                      <button className="ops-link-button" onClick={() => toggleExpanded(schoolId)}>
                        {isExpanded ? 'Hide' : 'Show'}
                      </button>
                      <strong>{school.school.name}</strong>
                    </td>
                    <td>{school.school.state ?? ''}</td>
                    <td><code>{school.school.teacherCode}</code></td>
                    <td>{school.classes.length}</td>
                    <td>{participantCount}</td>
                    <td>
                      <div className="ops-row-actions">
                        <button className="ops-button" onClick={() => void copyTeacherCode(school.school.teacherCode)}>Copy</button>
                        <button className="ops-button" disabled={busySchoolId === schoolId} onClick={() => void resetCode(schoolId)}>
                          {busySchoolId === schoolId ? 'Resetting...' : 'Reset teacher code'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6}>
                        <ClassList
                          event={event}
                          rankingKey={rankingKey}
                          rankingRows={rankingRows}
                          school={school}
                          busyRankingKey={busyRankingKey}
                          onViewRanking={viewRanking}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {filteredSchools.length === 0 && <p className="ops-subtle">No schools match the search.</p>}
    </section>
  )
}

function ClassList({
  event,
  school,
  rankingKey,
  rankingRows,
  busyRankingKey,
  onViewRanking,
}: {
  event: EventDoc
  school: AdminSchoolView
  rankingKey: string
  rankingRows: LeaderboardRow[]
  busyRankingKey: string
  onViewRanking: (schoolId: string, classId: string) => Promise<void>
}) {
  return (
    <div className="ops-class-list">
      <table className="ops-table compact">
        <thead>
          <tr>
            <th>Class</th>
            <th>Participants</th>
            <th>Approved</th>
            <th>Submitted</th>
            <th>Ranking</th>
          </tr>
        </thead>
        <tbody>
          {school.classes.map((classStats) => {
            const key = `${school.school.id}:${classStats.classInfo.id}`
            return (
              <Fragment key={classStats.classInfo.id}>
                <tr>
                  <td>{classStats.classInfo.name}</td>
                  <td>{classStats.participantCount}</td>
                  <td>{classStats.approvedCount}</td>
                  <td>{classStats.submittedCount}</td>
                  <td>
                    <button className="ops-button" disabled={busyRankingKey === key} onClick={() => void onViewRanking(school.school.id, classStats.classInfo.id)}>
                      {busyRankingKey === key ? 'Loading...' : rankingKey === key ? 'Hide ranking' : 'View ranking'}
                    </button>
                  </td>
                </tr>
                {rankingKey === key && (
                  <tr>
                    <td colSpan={5}>
                      <LeaderboardTable event={event} rows={rankingRows} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LeaderboardTable({ event, rows }: { event: EventDoc; rows: LeaderboardRow[] }) {
  const challenges = event.challenges.length ? event.challenges : fallbackChallenges
  const visibleRows = rows.filter((row) => row.rank !== null || totalAttempts(row) > 0)
  const maxAttempts = event.attemptsPerChallenge === null ? null : event.attemptsPerChallenge * challenges.length

  if (visibleRows.length === 0) return <p className="ops-subtle">No ranking records yet.</p>

  return (
    <div className="ops-table-wrap">
      <table className="ops-table compact">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            {challenges.map((challenge) => <th key={challenge.slot}>{challenge.name}</th>)}
            <th>Average</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <Fragment key={row.publicId}>
              {row.rank === null && visibleRows[index - 1]?.rank !== null && (
                <tr className="ops-group-row">
                  <td colSpan={challenges.length + 4}>Unranked - complete all 3 challenges to enter the ranking</td>
                </tr>
              )}
              <tr>
                <td>{row.rank ?? '-'}</td>
                <td>
                  <strong>{row.name}</strong>
                  <br />
                  <span className="ops-subtle">{row.publicId} - {statusLabel(row.status)}</span>
                  {row.rank === null && <span className="ops-pill warn">Challenge {completedChallenges(row, challenges)}/{challenges.length}</span>}
                </td>
                {challenges.map((challenge) => (
                  <td key={challenge.slot}>{formatSec(row.bests[challenge.slot])}</td>
                ))}
                <td>{formatSec(row.averageSec)}</td>
                <td>
                  {maxAttempts === null ? `${totalAttempts(row)} / unlimited` : `${totalAttempts(row)} / ${maxAttempts}`}
                  <br />
                  <span className="ops-subtle">
                    {challenges.map((challenge) => (
                      <span key={challenge.slot} className="ops-attempt-chip">
                        {challengeShortLabel(challenge.slot)} {row.attemptsUsed[challenge.slot]}/{attemptLimitText(event.attemptsPerChallenge)}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
