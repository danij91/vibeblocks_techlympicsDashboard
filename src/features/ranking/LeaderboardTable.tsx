import { formatSec } from '../../api/scoring'
import type { ChallengeDef, ChallengeSlot, LeaderboardRow } from '../../api/types'
import styles from './publicPages.module.css'

const FALLBACK_CHALLENGES: ChallengeDef[] = [
  { slot: 'c1', missionId: 201, name: 'Challenge 1' },
  { slot: 'c2', missionId: 202, name: 'Challenge 2' },
  { slot: 'c3', missionId: 203, name: 'Challenge 3' },
]

function totalAttempts(row: LeaderboardRow): number {
  return row.attemptsUsed.c1 + row.attemptsUsed.c2 + row.attemptsUsed.c3
}

function statusLabel(status: LeaderboardRow['status']): string {
  if (status === 'approved') return 'Registered'
  if (status === 'pending') return 'Pending'
  if (status === 'withdrawn') return 'Withdrawn'
  return 'Rejected'
}

function challengeShortLabel(slot: ChallengeSlot): string {
  return slot.toUpperCase()
}

function maxAttemptsLabel(attemptsPerChallenge: number | null, challengeCount: number): string {
  return attemptsPerChallenge === null ? 'unlimited' : String(attemptsPerChallenge * challengeCount)
}

function slotLimitLabel(attemptsPerChallenge: number | null): string {
  return attemptsPerChallenge === null ? 'unlimited' : String(attemptsPerChallenge)
}

function sortedRows(rows: LeaderboardRow[]): LeaderboardRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (b.row.completedCount !== a.row.completedCount) return b.row.completedCount - a.row.completedCount
      const aAverage = a.row.averageSec ?? Number.POSITIVE_INFINITY
      const bAverage = b.row.averageSec ?? Number.POSITIVE_INFINITY
      if (aAverage !== bAverage) return aAverage - bAverage
      return a.index - b.index
    })
    .map(({ row }) => row)
}

export default function LeaderboardTable({
  rows,
  challenges = FALLBACK_CHALLENGES,
  attemptsPerChallenge = 3,
}: {
  rows: LeaderboardRow[]
  challenges?: ChallengeDef[]
  attemptsPerChallenge?: number | null
}) {
  const visibleRows = sortedRows(rows)
  const maxAttempts = maxAttemptsLabel(attemptsPerChallenge, challenges.length)

  if (visibleRows.length === 0) {
    return <div className={styles.emptyState}>No participants are visible yet.</div>
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.boardTable}>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            {challenges.map((challenge) => (
              <th key={challenge.slot}>{challenge.name}</th>
            ))}
            <th>Completed</th>
            <th>Average</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.publicId} className={row.completedCount === 0 ? styles.unrankedRow : undefined}>
              <td className={styles.rankCell}>
                <span className={styles.cellLabel}>Rank</span>
                <span className={styles.cellValue}>{row.completedCount > 0 ? row.rank ?? '-' : '-'}</span>
              </td>
              <td className={styles.participantCell}>
                <span className={styles.nameCell}>{row.name}</span>
                <span className={styles.publicId}>{row.publicId}</span>
                <span className={styles.statusChip}>{statusLabel(row.status)}</span>
                <span className={styles.progressChip}>
                  {row.completedCount}/{challenges.length} completed
                </span>
              </td>
              {challenges.map((challenge) => (
                <td key={challenge.slot} className={styles.challengeCell}>
                  <span className={styles.cellLabel}>{challenge.name}</span>
                  <span className={styles.cellValue}>{formatSec(row.bests[challenge.slot])}</span>
                </td>
              ))}
              <td className={styles.completedCell}>
                <span className={styles.cellLabel}>Completed</span>
                <span className={styles.cellValue}>
                  {row.completedCount}/{challenges.length}
                </span>
              </td>
              <td className={styles.averageCell}>
                <span className={styles.cellLabel}>Average</span>
                <span className={styles.cellValue}>{formatSec(row.averageSec)}</span>
              </td>
              <td className={styles.attemptCell}>
                <span className={styles.cellLabel}>Attempts</span>
                <span className={styles.cellValue}>
                  {totalAttempts(row)}/{maxAttempts}
                </span>
                <span className={styles.attemptBreakdown}>
                  {challenges.map((challenge) => (
                    <span key={challenge.slot}>
                      {challengeShortLabel(challenge.slot)} {row.attemptsUsed[challenge.slot]}/{slotLimitLabel(attemptsPerChallenge)}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
