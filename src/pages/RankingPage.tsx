import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api } from '../api'
import { normalizeCode } from '../api/codes'
import { computeScore } from '../api/scoring'
import type { JoinInfo, LeaderboardRow } from '../api/types'
import styles from '../features/ranking/publicPages.module.css'

type LoadState = 'loading' | 'ready' | 'error'

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR'
}

function displayScore(row: LeaderboardRow, info: JoinInfo | null): number | null {
  if (!row.metrics) return row.score
  return computeScore(row.metrics, info?.event.scoringVersion)
}

function statusLabel(status: LeaderboardRow['status']): string {
  if (status === 'approved') return 'Registered'
  if (status === 'pending') return 'Pending'
  return 'Rejected'
}

// Owned by task vb-116-web-ranking (CONTRACT.md §7)
export default function RankingPage() {
  const params = useParams()
  const location = useLocation()
  const joinCode = useMemo(() => normalizeCode(params.joinCode ?? ''), [params.joinCode])
  const isJoinLanding = location.pathname.startsWith('/join/')
  const [includePending, setIncludePending] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const [info, setInfo] = useState<JoinInfo | null>(null)
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const id = requestId.current + 1
      requestId.current = id
      if (mode === 'initial') setState('loading')
      if (mode === 'refresh') setRefreshing(true)
      setError(null)

      try {
        const [classInfo, leaderboard] = await Promise.all([
          api.getClassByJoinCode(joinCode),
          api.getLeaderboard(joinCode, { includePending }),
        ])
        if (requestId.current !== id) return
        setInfo(classInfo)
        setRows(leaderboard)
        setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        setState('ready')
      } catch (caught) {
        if (requestId.current !== id) return
        setError(errorCode(caught))
        setState('error')
      } finally {
        if (requestId.current === id) setRefreshing(false)
      }
    },
    [includePending, joinCode],
  )

  useEffect(() => {
    void load('initial')
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load('refresh')
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const visibleRows = rows.filter((row) => row.status !== 'pending' || row.rank !== null || row.attemptsUsed > 0)
  const submittedRows = visibleRows.filter((row) => row.rank !== null).length
  const pendingRows = visibleRows.filter((row) => row.status === 'pending').length

  if (state === 'error' && error === 'CLASS_NOT_FOUND') {
    return (
      <main className={styles.shell}>
        <section className={styles.messagePanel}>
          <p className={styles.kicker}>Class code not found</p>
          <h1>Check the code and try again.</h1>
          <p>The class code may have been mistyped or replaced by your teacher.</p>
          <Link className={styles.primaryLink} to="/">
            Enter another code
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.shell}>
      {isJoinLanding ? (
        <section className={styles.joinPanel} aria-labelledby="join-title">
          <div>
            <p className={styles.kicker}>Class code {joinCode}</p>
            <h1 id="join-title">Join in the VibeBlocks app.</h1>
            <p>Open the app on this device, enter your class code, and submit your FC-1 run.</p>
          </div>
          <div className={styles.joinActions}>
            <a className={styles.primaryLink} href="#">
              App Store
            </a>
            <a className={styles.secondaryLink} href="#">
              Google Play
            </a>
            <Link className={styles.secondaryLink} to={`/r/${joinCode}`}>
              View ranking
            </Link>
          </div>
        </section>
      ) : null}

      <section className={styles.rankingHeader} aria-labelledby="ranking-title">
        <Link className={styles.backLink} to="/">
          Enter another code
        </Link>
        <div className={styles.classMeta}>
          <p className={styles.kicker}>{info?.event.name ?? 'Techlympics 2026'}</p>
          <h1 id="ranking-title">{info ? `${info.school.name} - ${info.classInfo.name}` : 'Loading leaderboard'}</h1>
          <p>Class code {joinCode}</p>
        </div>
        <button className={styles.refreshButton} type="button" onClick={() => void load('refresh')} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className={styles.toolbar} aria-label="Leaderboard filters">
        <div className={styles.segmented} role="group" aria-label="Registration filter">
          <button
            type="button"
            className={!includePending ? styles.activeSegment : undefined}
            onClick={() => setIncludePending(false)}
          >
            Registered
          </button>
          <button
            type="button"
            className={includePending ? styles.activeSegment : undefined}
            onClick={() => setIncludePending(true)}
          >
            Include pending
          </button>
        </div>
        <p>
          {submittedRows} submitted
          {includePending && pendingRows > 0 ? ` - ${pendingRows} pending` : ''}
          {lastUpdated ? ` - updated ${lastUpdated}` : ''}
        </p>
      </section>

      <section className={styles.boardPanel} aria-live="polite">
        {state === 'loading' ? (
          <div className={styles.emptyState}>Loading current results...</div>
        ) : state === 'error' ? (
          <div className={styles.emptyState}>
            <h2>Leaderboard is unavailable.</h2>
            <p>{error ?? 'Try again in a moment.'}</p>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className={styles.emptyState}>No participants are visible yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.boardTable}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Score</th>
                  <th>Tries</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.publicId} className={row.rank === null ? styles.unsubmittedRow : undefined}>
                    <td>{row.rank ?? '-'}</td>
                    <td>
                      <span className={styles.nameCell}>{row.name}</span>
                      <span className={styles.statusChip}>{statusLabel(row.status)}</span>
                    </td>
                    <td>{row.publicId}</td>
                    <td>{displayScore(row, info)?.toLocaleString() ?? '-'}</td>
                    <td>{row.attemptsUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
