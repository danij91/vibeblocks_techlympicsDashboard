import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { api } from '../../api'
import { formatSec } from '../../api/scoring'
import type {
  ChallengeDef,
  ChallengeSlot,
  ClassStats,
  EventDoc,
  EventStats,
  ImportResult,
  ImportRow,
  LeaderboardRow,
  ParticipantDoc,
  TeacherBinding,
} from '../../api/types'
import { ShimmerText } from '../../lib/Shimmer'
import type { TFunction } from '../../lib/i18n'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { sampleImportRows } from './fixtures/sampleImportRows'
import './admin.css'

type AdminTab = 'events' | 'import' | 'schools' | 'participants'
type ImportField = 'schoolName' | 'state' | 'zone'
type AdminSchoolView = Awaited<ReturnType<typeof api.listEventSchools>>[number]
type SearchParamSetter = ReturnType<typeof useSearchParams>[1]

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

interface ParticipantRow {
  participant: ParticipantDoc
  school: AdminSchoolView['school']
  classInfo: ClassStats['classInfo']
  grade: string
}

interface EventForm {
  name: string
  startsAt: string
  endsAt: string
  attemptsPerChallenge: number | null
}

const requiredFields: ImportField[] = ['schoolName']
const importFields: ImportField[] = ['schoolName', 'state', 'zone']
const adminTabs: AdminTab[] = ['events', 'import', 'schools', 'participants']

function parseAdminTab(value: string | null): AdminTab {
  return adminTabs.includes(value as AdminTab) ? (value as AdminTab) : 'events'
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
  updateQueryParams(searchParams, setSearchParams, { modal: null, teacher: null, uid: null }, true)
}

function fieldLabel(field: ImportField, t: TFunction): string {
  if (field === 'schoolName') return t('common.schoolName')
  if (field === 'state') return t('common.state')
  return t('common.zone')
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

function formatDateTime(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function pickInitialMapping(headers: string[]): Record<ImportField, string> {
  const findHeader = (candidates: string[]) =>
    headers.find((header) => candidates.some((candidate) => header.toLowerCase().replace(/\s+/g, '').includes(candidate))) ?? ''
  return {
    schoolName: findHeader(['school', 'schoolname', 'nama sekolah', 'sekolah']),
    state: findHeader(['state', 'negeri']),
    zone: findHeader(['zone', 'zon']),
  }
}

function buildPreview(rows: string[][], mapping: Record<ImportField, string>, selected: Set<number>, t: TFunction): PreviewRow[] {
  const headers = rows[0] ?? []
  const body = rows.slice(1).filter((row) => row.some((cell) => normalizedCell(cell)))
  const seen = new Map<string, number>()
  return body.map((row, bodyIndex) => {
    const source = Object.fromEntries(headers.map((header, i) => [header, normalizedCell(row[i])]))
    const mapped: ImportRow = {
      schoolName: normalizedCell(source[mapping.schoolName]),
      state: normalizedCell(source[mapping.state]) || undefined,
      zone: normalizedCell(source[mapping.zone]) || undefined,
    }
    const warnings: string[] = []
    requiredFields.forEach((field) => {
      if (!mapped[field]?.trim()) warnings.push(t('admin.fieldEmpty', { field: fieldLabel(field, t) }))
    })
    const dupKey = mapped.schoolName.toLowerCase()
    if (mapped.schoolName) {
      const first = seen.get(dupKey)
      if (first !== undefined) warnings.push(t('admin.duplicateRow', { row: first + 2 }))
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
    return {
      ...row.source,
      schoolName: row.mapped.schoolName,
      state: row.mapped.state ?? '',
      zone: row.mapped.zone ?? '',
      teacherCode: school?.school.teacherCode ?? '',
      importStatus: school ? 'created-or-existing' : 'skipped',
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

function statusLabel(status: LeaderboardRow['status'], t: TFunction) {
  if (status === 'approved') return t('common.registered')
  if (status === 'pending') return t('common.pending')
  if (status === 'withdrawn') return t('common.withdrawn')
  return t('common.rejected')
}

function challengeShortLabel(slot: ChallengeSlot) {
  return slot.toUpperCase()
}

function attemptLimitText(limit: number | null, t: TFunction) {
  return limit === null ? t('common.unlimited') : String(limit)
}

function gradeFromClassName(className: string) {
  return className.trim().match(/^(\d+)/)?.[1] ?? '-'
}

export default function AdminDashboard({ embedded = false }: { embedded?: boolean }) {
  const toast = useToast()
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseAdminTab(searchParams.get('tab'))
  const modal = searchParams.get('modal')
  const [events, setEvents] = useState<EventDoc[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [stats, setStats] = useState<EventStats | null>(null)
  const [schools, setSchools] = useState<AdminSchoolView[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0]
  const createOpen = modal === 'create-event'
  const updateQuery = useCallback((patch: Record<string, string | null | undefined>, replace = false) => {
    updateQueryParams(searchParams, setSearchParams, patch, replace)
  }, [searchParams, setSearchParams])

  const selectTab = (item: AdminTab) => {
    updateQuery({ tab: item, school: null, class: null, modal: null, teacher: null, uid: null }, false)
  }

  const openCreateModal = () => {
    updateQuery({ modal: 'create-event' }, false)
  }

  const closeModal = () => closeQueryModal(searchParams, setSearchParams)

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
    <section className={embedded ? 'ops-workspace embedded' : 'ops-workspace'}>
      <div className="ops-topbar">
        <div>
          <p className="ops-eyebrow">{t('admin.techlympicsAdmin')}</p>
          <h1>{t('admin.console')}</h1>
          <p className="ops-subtle">{t('admin.description')}</p>
        </div>
        <button className="ops-button" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t('common.refreshing') : t('common.refresh')}
        </button>
      </div>

      {error && <div className="ops-alert">{error}</div>}

      <div className="ops-grid">
        <aside className="ops-panel">
          <div className="ops-topbar compact">
            <h2>{t('admin.events')}</h2>
            <button className="ops-button primary" onClick={openCreateModal}>{t('admin.new')}</button>
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
                <span className={`ops-pill ${event.frozen ? 'warn' : 'ok'}`}>{event.frozen ? t('common.frozen') : t('common.open')}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="ops-stack">
          <div className="ops-panel">
            <div className="ops-topbar">
              <div>
                <h2>{selectedEvent?.name ?? t('admin.noEventSelected')}</h2>
                <p className="ops-subtle">{t('admin.eventPeriodNote')}</p>
              </div>
              {selectedEvent && <span className={`ops-pill ${selectedEvent.frozen ? 'warn' : 'ok'}`}>{selectedEvent.frozen ? t('common.frozen') : t('common.open')}</span>}
            </div>
            <div className="ops-tabs">
              {adminTabs.map((item) => (
                <button className={`ops-tab ${tab === item ? 'active' : ''}`} key={item} onClick={() => selectTab(item)}>
                  {item === 'events' ? t('admin.eventSetup') : item === 'import' ? t('admin.import') : item === 'schools' ? t('common.schools') : t('common.participants')}
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
          {tab === 'participants' && selectedEvent && (
            <ParticipantsPanel event={selectedEvent} schools={schools} />
          )}
        </section>
      </div>

      {createOpen && (
        <EventCreateModal
          onClose={closeModal}
          onCreated={async (created) => {
            toast(t('admin.eventCreated', { name: created.name }), 'success')
            await refresh(created.id)
            closeModal()
          }}
        />
      )}
    </section>
  )
}

function StatsPanel({ stats }: { stats: EventStats }) {
  const t = useT()
  return (
    <section className="ops-panel">
      <div className="ops-stat-grid">
        <div className="ops-stat"><span className="ops-subtle">{t('common.schools')}</span><strong>{stats.schoolCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">{t('common.classes')}</span><strong>{stats.classCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">{t('common.participants')}</span><strong>{stats.participantCount}</strong></div>
        <div className="ops-stat"><span className="ops-subtle">{t('common.submissions')}</span><strong>{stats.attemptCount}</strong></div>
      </div>
    </section>
  )
}

function AttemptsControl({ form, onChange }: { form: EventForm; onChange: (next: EventForm) => void }) {
  const t = useT()
  const unlimited = form.attemptsPerChallenge === null
  return (
    <div className="ops-label">
      <span>{t('common.attempts')}</span>
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
          {t('common.unlimited')}
        </label>
      </div>
    </div>
  )
}

function EventEditor({ event, onSaved }: { event: EventDoc; onSaved: (message: string) => Promise<void> }) {
  const toast = useToast()
  const t = useT()
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
      await onSaved(t('admin.eventUpdated'))
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
    const ok = window.confirm(next ? t('admin.freezeConfirm') : t('admin.unfreezeConfirm'))
    if (!ok) return
    setFreezing(true)
    setError('')
    try {
      await api.updateEvent(event.id, { frozen: next })
      await onSaved(next ? t('admin.eventFrozen') : t('admin.eventUnfrozen'))
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
          <h2>{t('admin.eventManagement')}</h2>
          <p className="ops-subtle">{t('admin.eventManagementNote')}</p>
        </div>
        <button className={`ops-button ${event.frozen ? '' : 'danger'}`} disabled={freezing} onClick={() => void toggleFrozen()}>
          {freezing ? t('common.saving') : event.frozen ? t('admin.unfreeze') : t('admin.freeze')}
        </button>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-form two">
        <label className="ops-label">{t('common.name')}<input className="ops-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <AttemptsControl form={form} onChange={setForm} />
        <label className="ops-label">{t('common.startsAt')}<input className="ops-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
        <label className="ops-label">{t('common.endsAt')}<input className="ops-input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
      </div>
      <div className="ops-row-actions" style={{ marginTop: 12 }}>
        <button className="ops-button primary" onClick={() => void save()} disabled={saving || !form.name.trim()}>
          {saving ? t('common.saving') : t('admin.saveChanges')}
        </button>
      </div>
    </section>
  )
}

function EventCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (event: EventDoc) => Promise<void> }) {
  const toast = useToast()
  const t = useT()
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
    <div className="ops-modal-backdrop" role="presentation" onClick={onClose}>
      <section aria-modal="true" className="ops-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ops-topbar">
          <div>
            <p className="ops-eyebrow">{t('admin.newEvent')}</p>
            <h2>{t('admin.createEvent')}</h2>
          </div>
          <button className="ops-button" disabled={saving} onClick={onClose}>{t('common.close')}</button>
        </div>
        {error && <div className="ops-alert">{error}</div>}
        <div className="ops-form two">
          <label className="ops-label">{t('common.name')}<input className="ops-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <AttemptsControl form={form} onChange={setForm} />
          <label className="ops-label">{t('common.startsAt')}<input className="ops-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
          <label className="ops-label">{t('common.endsAt')}<input className="ops-input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
        </div>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button className="ops-button primary" disabled={saving || !form.name.trim()} onClick={() => void create()}>
            {saving ? t('admin.creating') : t('admin.createEvent')}
          </button>
        </div>
      </section>
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <div className="ops-modal-backdrop" role="presentation" onClick={onClose}>
      <section aria-modal="true" className="ops-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ops-topbar">
          <h2>{title}</h2>
          <button className="ops-button" disabled={busy} onClick={onClose}>{t('common.close')}</button>
        </div>
        <p>{message}</p>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button className="ops-button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button className="ops-button danger" disabled={busy} onClick={onConfirm}>
            {busy ? t('admin.revoking') : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function ImportPanel({
  event,
  onImported,
}: {
  event: EventDoc
  onImported: (message: string) => Promise<void>
}) {
  const toast = useToast()
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const [schoolForm, setSchoolForm] = useState({ schoolName: '', state: '', zone: '' })
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [mapping, setMapping] = useState<Record<ImportField, string>>({ schoolName: '', state: '', zone: '' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [resultRows, setResultRows] = useState<PreviewRow[]>([])
  const [error, setError] = useState('')
  const [schoolBusy, setSchoolBusy] = useState(false)
  const [workbookBusy, setWorkbookBusy] = useState(false)

  const rows = workbook ? workbook.sheets[workbook.sheetName] ?? [] : []
  const headers = rows[0] ?? []
  const preview = useMemo(() => buildPreview(rows, mapping, selected, t), [rows, mapping, selected, t])
  const importable = preview.filter((row) => row.selected)
  const previewOpen = searchParams.get('modal') === 'import-preview'
  const openPreview = () => updateQueryParams(searchParams, setSearchParams, { tab: 'import', modal: 'import-preview' }, false)
  const closePreview = () => closeQueryModal(searchParams, setSearchParams)

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
      updateQueryParams(searchParams, setSearchParams, { tab: 'import', modal: 'import-preview' }, false)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    }
  }

  const addSchool = async () => {
    setSchoolBusy(true)
    setError('')
    try {
      const response = await api.importSchools(event.id, [{
        schoolName: schoolForm.schoolName.trim(),
        state: schoolForm.state.trim() || undefined,
        zone: schoolForm.zone.trim() || undefined,
      }])
      setSchoolForm({ schoolName: '', state: '', zone: '' })
      await onImported(t('admin.schoolImportFinished', { schools: response.schools.length, skipped: response.skipped.length }))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setSchoolBusy(false)
    }
  }

  const importSelected = async () => {
    setWorkbookBusy(true)
    setError('')
    try {
      const response = await api.importSchools(event.id, importable.map((row) => row.mapped))
      setResult(response)
      setResultRows(importable)
      await onImported(t('admin.importFinished', { schools: response.schools.length, skipped: response.skipped.length }))
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
          <h2>{t('admin.import')}</h2>
          <p className="ops-subtle">{t('admin.importDescription')}</p>
        </div>
        <button className="ops-button" onClick={downloadSampleWorkbook}>{t('admin.downloadSample')}</button>
      </div>
      {error && <div className="ops-alert">{error}</div>}

      <section className="ops-subsection">
        <h3>{t('admin.addSchool')}</h3>
        <div className="ops-form three">
          <label className="ops-label">{t('common.schoolName')}<input className="ops-input" value={schoolForm.schoolName} onChange={(e) => setSchoolForm({ ...schoolForm, schoolName: e.target.value })} /></label>
          <label className="ops-label">{t('common.state')}<input className="ops-input" value={schoolForm.state} onChange={(e) => setSchoolForm({ ...schoolForm, state: e.target.value })} /></label>
          <label className="ops-label">{t('common.zone')}<input className="ops-input" value={schoolForm.zone} onChange={(e) => setSchoolForm({ ...schoolForm, zone: e.target.value })} /></label>
        </div>
        <div className="ops-row-actions" style={{ marginTop: 12 }}>
          <button
            className="ops-button primary"
            disabled={schoolBusy || !schoolForm.schoolName.trim()}
            onClick={() => void addSchool()}
          >
            {schoolBusy ? t('teacher.adding') : t('admin.addSchool')}
          </button>
        </div>
      </section>

      <section className="ops-subsection">
        <h3>{t('admin.workbookImport')}</h3>
        <div className="ops-form two">
          <label className="ops-label">{t('admin.uploadWorkbook')}<input className="ops-file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void loadFile(e.target.files?.[0])} /></label>
          {workbook && (
            <label className="ops-label">{t('admin.sheet')}
              <select className="ops-select" value={workbook.sheetName} onChange={(e) => setWorkbook({ ...workbook, sheetName: e.target.value })}>
                {Object.keys(workbook.sheets).map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
              </select>
            </label>
          )}
        </div>

        {workbook && !previewOpen && (
          <div className="ops-row-actions" style={{ marginTop: 12 }}>
            <button className="ops-button" onClick={openPreview}>{t('admin.workbookImport')}</button>
            <span className="ops-subtle">{workbook.fileName}</span>
          </div>
        )}

        {workbook && previewOpen && (
          <div className="ops-modal-backdrop" role="presentation" onClick={closePreview}>
            <section aria-modal="true" className="ops-modal ops-modal-wide" role="dialog" onClick={(event) => event.stopPropagation()}>
              <div className="ops-topbar">
                <div>
                  <p className="ops-eyebrow">{workbook.fileName}</p>
                  <h2>{t('admin.workbookImport')}</h2>
                </div>
                <button className="ops-button" onClick={closePreview}>{t('common.close')}</button>
              </div>
            <div className="ops-mapping-box" style={{ marginTop: 12 }}>
              <h3>{t('admin.columnMapping')}</h3>
              <div className="ops-form two" style={{ marginTop: 10 }}>
                {importFields.map((field) => (
                  <label className="ops-label" key={field}>{fieldLabel(field, t)}
                    <select className="ops-select" value={mapping[field]} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                      <option value="">{t('common.notMapped')}</option>
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
                    <th>{t('common.select')}</th>
                    <th>{t('common.school')}</th>
                    <th>{t('common.state')}</th>
                    <th>{t('common.zone')}</th>
                    <th>{t('common.validation')}</th>
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
                      <td>{row.mapped.state}</td>
                      <td>{row.mapped.zone}</td>
                      <td>{row.warnings.length ? row.warnings.map((warning) => <span className="ops-pill warn" key={warning}>{warning}</span>) : <span className="ops-pill ok">{t('common.ready')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ops-row-actions" style={{ marginTop: 12 }}>
              <button className="ops-button primary" disabled={workbookBusy || importable.length === 0} onClick={() => void importSelected()}>
                {workbookBusy ? t('admin.importing') : t('admin.importSelected')}
              </button>
              <span className="ops-subtle">{t('admin.rowsSelected', { count: importable.length })}</span>
            </div>
            </section>
          </div>
        )}
      </section>

      {result && (
        <div className="ops-alert ops-success" style={{ marginTop: 12 }}>
          {t('admin.resultTouched', { schools: result.schools.length, skipped: result.skipped.length })}
          <div className="ops-row-actions" style={{ marginTop: 8 }}>
            <button className="ops-button" onClick={() => void downloadResult()}>{t('admin.downloadResult')}</button>
          </div>
        </div>
      )}
    </section>
  )
}

function ParticipantsPanel({ event, schools }: { event: EventDoc; schools: AdminSchoolView[] }) {
  const toast = useToast()
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const [rows, setRows] = useState<ParticipantRow[]>([])
  const [schoolFilter, setSchoolFilter] = useState(() => searchParams.get('participantSchool') ?? 'all')
  const [gradeFilter, setGradeFilter] = useState(() => searchParams.get('grade') ?? 'all')
  const [query, setQuery] = useState(() => searchParams.get('participantQuery') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadParticipants = async () => {
    setLoading(true)
    setError('')
    try {
      const classViews = schools.flatMap((school) => (
        school.classes.map((classStats) => ({
          school: school.school,
          classInfo: classStats.classInfo,
        }))
      ))
      const batches = await Promise.all(classViews.map(async ({ school, classInfo }) => {
        const participants = await api.listParticipants({ eventId: event.id, schoolId: school.id, classId: classInfo.id })
        return participants.map((participant): ParticipantRow => ({
          participant,
          school,
          classInfo,
          grade: gradeFromClassName(classInfo.name),
        }))
      }))
      setRows(batches.flat().sort((a, b) => Date.parse(b.participant.registeredAt) - Date.parse(a.participant.registeredAt)))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadParticipants()
  }, [event.id, schools])

  useEffect(() => {
    setSchoolFilter(searchParams.get('participantSchool') ?? 'all')
    setGradeFilter(searchParams.get('grade') ?? 'all')
    setQuery(searchParams.get('participantQuery') ?? '')
  }, [paramsKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateQueryParams(searchParams, setSearchParams, { participantQuery: query.trim() || null }, true)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, paramsKey, setSearchParams])

  const grades = useMemo(() => {
    const unique = [...new Set(rows.map((row) => row.grade).filter((grade) => grade !== '-'))]
    return unique.sort((a, b) => Number(a) - Number(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = normalizedSearch(query)
    return rows.filter((row) => {
      const schoolMatches = schoolFilter === 'all' || row.school.id === schoolFilter
      const gradeMatches = gradeFilter === 'all' || row.grade === gradeFilter
      const queryMatches = !q || normalizedSearch(`${row.participant.name} ${row.participant.publicId}`).includes(q)
      return schoolMatches && gradeMatches && queryMatches
    })
  }, [gradeFilter, query, rows, schoolFilter])

  const changeSchoolFilter = (value: string) => {
    setSchoolFilter(value)
    updateQueryParams(searchParams, setSearchParams, { participantSchool: value === 'all' ? null : value }, true)
  }

  const changeGradeFilter = (value: string) => {
    setGradeFilter(value)
    updateQueryParams(searchParams, setSearchParams, { grade: value === 'all' ? null : value }, true)
  }

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>{t('common.participants')}</h2>
          <p className="ops-subtle">{t('admin.participantsDescription')}</p>
        </div>
        <button className="ops-button" disabled={loading} onClick={() => void loadParticipants()}>
          {loading ? t('common.loading') : t('common.refresh')}
        </button>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-filter-bar participants">
        <label className="ops-label">{t('common.school')}
          <select className="ops-select" value={schoolFilter} onChange={(event) => changeSchoolFilter(event.target.value)}>
            <option value="all">{t('admin.allSchools')}</option>
            {schools.map((school) => <option key={school.school.id} value={school.school.id}>{school.school.name}</option>)}
          </select>
        </label>
        <label className="ops-label">{t('common.grade')}
          <select className="ops-select" value={gradeFilter} onChange={(event) => changeGradeFilter(event.target.value)}>
            <option value="all">{t('admin.allGrades')}</option>
            {grades.map((grade) => <option key={grade} value={grade}>{t('teacher.gradeLabel', { grade })}</option>)}
          </select>
        </label>
        <label className="ops-label">{t('common.search')}
          <input className="ops-input" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <div className="ops-table-wrap" style={{ marginTop: 12 }}>
        <table className="ops-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.publicId')}</th>
              <th>{t('common.school')}</th>
              <th>{t('common.class')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.registered')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.participant.id}>
                <td><strong>{row.participant.name}</strong></td>
                <td><code>{row.participant.publicId}</code></td>
                <td>{row.school.name}</td>
                <td>{row.classInfo.name}</td>
                <td><span className={`ops-pill ${row.participant.status === 'approved' ? 'ok' : row.participant.status === 'pending' ? '' : 'warn'}`}>{statusLabel(row.participant.status, t)}</span></td>
                <td>{formatDateTime(row.participant.registeredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="ops-subtle"><ShimmerText busy={loading}>{t('admin.loadingParticipants')}</ShimmerText></p>}
      {!loading && filteredRows.length === 0 && <p className="ops-subtle">{t('admin.noParticipantsMatch')}</p>}
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
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const selectedSchoolId = searchParams.get('school') ?? ''
  const selectedClassId = searchParams.get('class') ?? ''
  const modal = searchParams.get('modal')
  const [query, setQuery] = useState(() => searchParams.get('schoolQuery') ?? '')
  const expanded = useMemo(() => new Set(selectedSchoolId ? [selectedSchoolId] : []), [selectedSchoolId])
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [teachersBySchool, setTeachersBySchool] = useState<Record<string, TeacherBinding[]>>({})
  const [participantsByClass, setParticipantsByClass] = useState<Record<string, ParticipantDoc[]>>({})
  const [rankingRows, setRankingRows] = useState<LeaderboardRow[]>([])
  const [classDrafts, setClassDrafts] = useState<Record<string, string>>({})
  const [addingClassSchoolId, setAddingClassSchoolId] = useState('')
  const [busySchoolId, setBusySchoolId] = useState('')
  const [loadingTeachersSchoolId, setLoadingTeachersSchoolId] = useState('')
  const [revokingTeacherKey, setRevokingTeacherKey] = useState('')
  const [loadingParticipantsKey, setLoadingParticipantsKey] = useState('')
  const [busyRankingKey, setBusyRankingKey] = useState('')
  const [error, setError] = useState('')
  const rankingKey = selectedSchoolId && selectedClassId ? `${selectedSchoolId}:${selectedClassId}` : ''

  const filteredSchools = useMemo(() => {
    const q = normalizedSearch(query)
    if (!q) return schools
    return schools.filter((school) => {
      const name = normalizedSearch(school.school.name)
      const state = normalizedSearch(school.school.state)
      return name.includes(q) || state.includes(q)
    })
  }, [query, schools])

  useEffect(() => {
    setQuery(searchParams.get('schoolQuery') ?? '')
  }, [paramsKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateQueryParams(searchParams, setSearchParams, { schoolQuery: query.trim() || null }, true)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, paramsKey, setSearchParams])

  const loadTeachers = async (schoolId: string) => {
    setLoadingTeachersSchoolId(schoolId)
    setError('')
    try {
      const teachers = await api.listSchoolTeachers({ eventId: event.id, schoolId })
      setTeachersBySchool((current) => ({ ...current, [schoolId]: teachers }))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setLoadingTeachersSchoolId('')
    }
  }

  const toggleExpanded = async (schoolId: string) => {
    const opening = selectedSchoolId !== schoolId
    updateQueryParams(searchParams, setSearchParams, {
      tab: 'schools',
      school: opening ? schoolId : null,
      class: null,
      modal: null,
      teacher: null,
    }, false)
    if (opening && teachersBySchool[schoolId] === undefined) await loadTeachers(schoolId)
  }

  useEffect(() => {
    if (!selectedSchoolId) return
    if (!schools.some((school) => school.school.id === selectedSchoolId)) return
    if (teachersBySchool[selectedSchoolId] !== undefined) return
    void loadTeachers(selectedSchoolId)
  }, [selectedSchoolId, schools, teachersBySchool])

  const copyTeacherCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    toast(t('admin.teacherCodeCopied'), 'success')
  }

  const resetCode = async (schoolId: string) => {
    const ok = window.confirm(t('admin.resetTeacherCodeConfirm'))
    if (!ok) return
    setBusySchoolId(schoolId)
    setError('')
    try {
      await api.resetTeacherCode({ eventId: event.id, schoolId })
      await onChanged(t('admin.teacherCodeReset'))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusySchoolId('')
    }
  }

  const addClass = async (schoolId: string) => {
    const name = classDrafts[schoolId]?.trim() ?? ''
    if (!name) return
    setAddingClassSchoolId(schoolId)
    setError('')
    try {
      const created = await api.addClass({ eventId: event.id, schoolId }, name)
      setClassDrafts((current) => ({ ...current, [schoolId]: '' }))
      await onChanged(t('teacher.classAdded', { className: created.name }))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setAddingClassSchoolId('')
    }
  }

  const openRevokeTeacher = (schoolId: string, teacher: TeacherBinding) => {
    updateQueryParams(searchParams, setSearchParams, {
      tab: 'schools',
      school: schoolId,
      modal: 'revoke-teacher',
      teacher: teacher.uid,
    }, false)
  }

  const revokeTeacher = async (schoolId: string, teacher: TeacherBinding) => {
    const key = `${schoolId}:${teacher.uid}`
    setRevokingTeacherKey(key)
    setError('')
    try {
      await api.revokeTeacherBinding({ eventId: event.id, schoolId }, teacher.uid)
      toast(t('admin.teacherBindingRevoked'), 'success')
      await loadTeachers(schoolId)
      closeQueryModal(searchParams, setSearchParams)
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setRevokingTeacherKey('')
    }
  }

  const loadParticipants = async (schoolId: string, classId: string) => {
    const key = `${schoolId}:${classId}`
    setLoadingParticipantsKey(key)
    setError('')
    try {
      const participants = await api.listParticipants({ eventId: event.id, schoolId, classId })
      setParticipantsByClass((current) => ({ ...current, [key]: participants }))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setLoadingParticipantsKey('')
    }
  }

  const toggleClass = async (schoolId: string, classId: string) => {
    const key = `${schoolId}:${classId}`
    const next = new Set(expandedClasses)
    const opening = !next.has(key)
    if (opening) next.add(key)
    else next.delete(key)
    setExpandedClasses(next)
    if (opening && participantsByClass[key] === undefined) await loadParticipants(schoolId, classId)
  }

  const viewRanking = async (schoolId: string, classId: string) => {
    const key = `${schoolId}:${classId}`
    if (rankingKey === key) {
      updateQueryParams(searchParams, setSearchParams, { class: null }, false)
      return
    }
    updateQueryParams(searchParams, setSearchParams, { tab: 'schools', school: schoolId, class: classId }, false)
  }

  useEffect(() => {
    if (!rankingKey) {
      setRankingRows([])
      return
    }
    const [schoolId, classId] = rankingKey.split(':')
    if (!schoolId || !classId) return
    let cancelled = false
    setBusyRankingKey(rankingKey)
    setError('')
    void api.getLeaderboardByPath({ eventId: event.id, schoolId, classId }, { includePending: true })
      .then((rows) => {
        if (!cancelled) setRankingRows(rows)
      })
      .catch((err) => {
        if (cancelled) return
        const message = getErrorMessage(err)
        setError(message)
        toast(message, 'error')
      })
      .finally(() => {
        if (!cancelled) setBusyRankingKey('')
      })
    return () => {
      cancelled = true
    }
  }, [event.id, rankingKey, toast])

  const pendingRevokeTeacher = useMemo(() => {
    if (modal !== 'revoke-teacher' || !selectedSchoolId) return null
    const uid = searchParams.get('teacher')
    if (!uid) return null
    const teacher = teachersBySchool[selectedSchoolId]?.find((item) => item.uid === uid)
    return teacher ? { schoolId: selectedSchoolId, teacher } : null
  }, [modal, searchParams, selectedSchoolId, teachersBySchool])

  return (
    <section className="ops-panel">
      <div className="ops-topbar">
        <div>
          <h2>{t('common.schools')}</h2>
          <p className="ops-subtle">{t('admin.schoolsDescription')}</p>
        </div>
        <label className="ops-search">{t('common.search')}<input className="ops-input" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {error && <div className="ops-alert">{error}</div>}
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th aria-label={t('admin.expand')}></th>
              <th>{t('common.school')}</th>
              <th>{t('common.state')}</th>
              <th>{t('common.teacherCode')}</th>
              <th>{t('common.classes')}</th>
              <th>{t('common.participants')}</th>
              <th>{t('common.actions')}</th>
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
                      <button
                        aria-label={t('admin.expandSchool', { action: isExpanded ? t('admin.collapse') : t('admin.expand'), schoolName: school.school.name })}
                        className="ops-icon-button"
                        onClick={() => void toggleExpanded(schoolId)}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      <strong>{school.school.name}</strong>
                    </td>
                    <td>{school.school.state ?? ''}</td>
                    <td>
                      <ShimmerText busy={busySchoolId === schoolId}><code>{school.school.teacherCode}</code></ShimmerText>
                    </td>
                    <td>{school.classes.length}</td>
                    <td>{participantCount}</td>
                    <td>
                      <div className="ops-row-actions">
                        <button className="ops-button" onClick={() => void copyTeacherCode(school.school.teacherCode)}>{t('common.copy')}</button>
                        <button className="ops-button" disabled={busySchoolId === schoolId} onClick={() => void resetCode(schoolId)}>
                          {busySchoolId === schoolId ? t('admin.resetting') : t('admin.resetTeacherCode')}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td className="ops-expanded-cell" colSpan={7}>
                        <AddClassPanel
                          busy={addingClassSchoolId === schoolId}
                          schoolName={school.school.name}
                          value={classDrafts[schoolId] ?? ''}
                          onAdd={() => addClass(schoolId)}
                          onChange={(value) => setClassDrafts((current) => ({ ...current, [schoolId]: value }))}
                        />
                        <TeacherBindingsPanel
                          teachers={teachersBySchool[schoolId] ?? []}
                          loading={loadingTeachersSchoolId === schoolId}
                          revokingKey={revokingTeacherKey}
                          schoolId={schoolId}
                          onRevoke={(teacher) => openRevokeTeacher(schoolId, teacher)}
                        />
                        <ClassList
                          event={event}
                          expandedClasses={expandedClasses}
                          loadingParticipantsKey={loadingParticipantsKey}
                          participantsByClass={participantsByClass}
                          rankingKey={rankingKey}
                          rankingRows={rankingRows}
                          school={school}
                          busyRankingKey={busyRankingKey}
                          onToggleClass={toggleClass}
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
      {filteredSchools.length === 0 && <p className="ops-subtle">{t('admin.noSchoolsMatch')}</p>}
      {pendingRevokeTeacher && (
        <ConfirmModal
          busy={revokingTeacherKey === `${pendingRevokeTeacher.schoolId}:${pendingRevokeTeacher.teacher.uid}`}
          confirmLabel={t('admin.revoke')}
          message={t('admin.revokeTeacherConfirm', { label: pendingRevokeTeacher.teacher.email || pendingRevokeTeacher.teacher.uid })}
          title={t('admin.revoke')}
          onClose={() => closeQueryModal(searchParams, setSearchParams)}
          onConfirm={() => void revokeTeacher(pendingRevokeTeacher.schoolId, pendingRevokeTeacher.teacher)}
        />
      )}
    </section>
  )
}

function AddClassPanel({
  busy,
  schoolName,
  value,
  onChange,
  onAdd,
}: {
  busy: boolean
  schoolName: string
  value: string
  onChange: (value: string) => void
  onAdd: () => Promise<void>
}) {
  const t = useT()
  return (
    <section className="ops-nested-section">
      <div className="ops-topbar compact">
        <div>
          <h3>{t('teacher.addClass')}</h3>
          <p className="ops-subtle">{t('admin.addClassDescription', { schoolName })}</p>
        </div>
      </div>
      <div className="ops-inline-form">
        <label className="ops-label">{t('common.className')}
          <input className="ops-input" value={value} onChange={(event) => onChange(event.target.value)} />
        </label>
        <button className="ops-button primary" disabled={busy || !value.trim()} onClick={() => void onAdd()}>
          {busy ? t('teacher.adding') : t('teacher.addClass')}
        </button>
      </div>
    </section>
  )
}

function TeacherBindingsPanel({
  teachers,
  loading,
  revokingKey,
  schoolId,
  onRevoke,
}: {
  teachers: TeacherBinding[]
  loading: boolean
  revokingKey: string
  schoolId: string
  onRevoke: (teacher: TeacherBinding) => void
}) {
  const t = useT()
  return (
    <section className="ops-nested-section">
      <div className="ops-topbar compact">
        <h3>{t('admin.teachers')}</h3>
        {loading && <ShimmerText busy={loading}>{t('admin.loadingTeachers')}</ShimmerText>}
      </div>
      {!loading && teachers.length === 0 ? (
        <p className="ops-subtle">{t('admin.noTeachers')}</p>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table compact">
            <thead>
              <tr>
                <th>{t('common.email')}</th>
                <th>{t('common.uid')}</th>
                <th>{t('admin.boundAt')}</th>
                <th>{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((teacher) => {
                const key = `${schoolId}:${teacher.uid}`
                return (
                  <tr key={teacher.uid}>
                    <td>{teacher.email ?? '-'}</td>
                    <td><code>{teacher.uid}</code></td>
                    <td>{formatDateTime(teacher.boundAt)}</td>
                    <td>
                      <button className="ops-button danger" disabled={revokingKey === key} onClick={() => onRevoke(teacher)}>
                        {revokingKey === key ? t('admin.revoking') : t('admin.revoke')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ClassList({
  event,
  school,
  expandedClasses,
  participantsByClass,
  loadingParticipantsKey,
  rankingKey,
  rankingRows,
  busyRankingKey,
  onToggleClass,
  onViewRanking,
}: {
  event: EventDoc
  school: AdminSchoolView
  expandedClasses: Set<string>
  participantsByClass: Record<string, ParticipantDoc[]>
  loadingParticipantsKey: string
  rankingKey: string
  rankingRows: LeaderboardRow[]
  busyRankingKey: string
  onToggleClass: (schoolId: string, classId: string) => Promise<void>
  onViewRanking: (schoolId: string, classId: string) => Promise<void>
}) {
  const t = useT()
  return (
    <div className="ops-class-list">
      <table className="ops-table compact">
        <thead>
          <tr>
            <th aria-label={t('admin.expandClass')}></th>
            <th>{t('common.class')}</th>
            <th>{t('common.participants')}</th>
            <th>{t('common.approved')}</th>
            <th>{t('admin.submitted')}</th>
            <th>{t('common.ranking')}</th>
          </tr>
        </thead>
        <tbody>
          {school.classes.map((classStats) => {
            const key = `${school.school.id}:${classStats.classInfo.id}`
            const classExpanded = expandedClasses.has(key)
            return (
              <Fragment key={classStats.classInfo.id}>
                <tr>
                  <td>
                    <button
                      aria-label={t('admin.expandSchool', { action: classExpanded ? t('admin.collapse') : t('admin.expand'), schoolName: classStats.classInfo.name })}
                      className="ops-icon-button"
                      onClick={() => void onToggleClass(school.school.id, classStats.classInfo.id)}
                    >
                      {classExpanded ? '▾' : '▸'}
                    </button>
                  </td>
                  <td>{classStats.classInfo.name}</td>
                  <td>{classStats.participantCount}</td>
                  <td>{classStats.approvedCount}</td>
                  <td>{classStats.submittedCount}</td>
                  <td>
                    <button className="ops-button" disabled={busyRankingKey === key} onClick={() => void onViewRanking(school.school.id, classStats.classInfo.id)}>
                      {busyRankingKey === key ? t('common.loading') : rankingKey === key ? t('admin.hideRanking') : t('admin.viewRanking')}
                    </button>
                  </td>
                </tr>
                {classExpanded && (
                  <tr>
                    <td className="ops-expanded-cell" colSpan={6}>
                      <ParticipantTable
                        classStats={classStats}
                        loading={loadingParticipantsKey === key}
                        participants={participantsByClass[key] ?? []}
                      />
                    </td>
                  </tr>
                )}
                {rankingKey === key && (
                  <tr>
                    <td className="ops-expanded-cell" colSpan={6}>
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

function ParticipantTable({
  classStats,
  participants,
  loading,
}: {
  classStats: ClassStats
  participants: ParticipantDoc[]
  loading: boolean
}) {
  const t = useT()
  return (
    <section className="ops-nested-section">
      <div className="ops-topbar compact">
        <h3>{t('common.participants')} · {classStats.classInfo.name}</h3>
        {loading && <ShimmerText busy={loading}>{t('admin.loadingParticipants')}</ShimmerText>}
      </div>
      {!loading && participants.length === 0 ? (
        <p className="ops-subtle">{t('ranking.noParticipants')}</p>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table compact">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.publicId')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.registered')}</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => (
                <tr key={participant.id}>
                  <td>{participant.name}</td>
                  <td><code>{participant.publicId}</code></td>
                  <td><span className={`ops-pill ${participant.status === 'approved' ? 'ok' : participant.status === 'pending' ? '' : 'warn'}`}>{statusLabel(participant.status, t)}</span></td>
                  <td>{formatDateTime(participant.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function LeaderboardTable({ event, rows }: { event: EventDoc; rows: LeaderboardRow[] }) {
  const t = useT()
  const challenges = event.challenges.length ? event.challenges : fallbackChallenges
  const maxAttempts = event.attemptsPerChallenge === null ? null : event.attemptsPerChallenge * challenges.length

  if (rows.length === 0) return <p className="ops-subtle">{t('ranking.noRecords')}</p>

  return (
    <div className="ops-table-wrap">
      <table className="ops-table compact">
        <thead>
          <tr>
            <th>{t('common.rank')}</th>
            <th>{t('common.name')}</th>
            {challenges.map((challenge) => <th key={challenge.slot}>{challenge.name}</th>)}
            <th>{t('common.completed')}</th>
            <th>{t('common.average')}</th>
            <th>{t('common.attempts')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={row.publicId}>
              {row.completedCount === 0 && rows[index - 1]?.completedCount !== 0 && (
                <tr className="ops-group-row">
                  <td colSpan={challenges.length + 5}>{t('ranking.noCompletedGroup')}</td>
                </tr>
              )}
              <tr>
                <td>{row.rank ?? '-'}</td>
                <td>
                  <strong>{row.name}</strong>
                  <br />
                  <span className="ops-subtle">{row.publicId} - {statusLabel(row.status, t)}</span>
                  {row.completedCount === 0 && <span className="ops-pill warn">{t('ranking.noRecord')}</span>}
                </td>
                {challenges.map((challenge) => (
                  <td key={challenge.slot}>{formatSec(row.bests[challenge.slot])}</td>
                ))}
                <td>{row.completedCount}/{challenges.length}</td>
                <td>{formatSec(row.averageSec)}</td>
                <td>
                  {maxAttempts === null ? `${totalAttempts(row)} / ${t('common.unlimited')}` : `${totalAttempts(row)} / ${maxAttempts}`}
                  <br />
                  <span className="ops-subtle">
                    {challenges.map((challenge) => (
                      <span key={challenge.slot} className="ops-attempt-chip">
                        {challengeShortLabel(challenge.slot)} {row.attemptsUsed[challenge.slot]}/{attemptLimitText(event.attemptsPerChallenge, t)}
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
