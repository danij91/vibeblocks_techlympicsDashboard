import { CHALLENGE_SLOTS } from './types'
import type { AttemptMetrics, BoardBest, BoardEntryDoc, ChallengeSlot } from './types'

// ============================================================
// 점수 v2 — 시간 기반 (2026-06-11 확정)
// 도전당 최대 N회 시도, 기록 = 가장 빠른 유효 시간.
// 랭킹 = 3개 도전 최고기록의 평균, 오름차순. 3개 미완 = 무순위.
// 원칙: raw metrics만 저장, 파생값(평균·순위)은 표시 시점 계산.
// ============================================================

/** 유효 기록 = 완주(성공률 1) + 시간 존재. 실패 런은 시도만 소모 */
export function isValidRecord(m: AttemptMetrics): boolean {
  return m.successRate === 1 && m.averageTimeSec !== null
}

export function recordTimeSec(m: AttemptMetrics): number | null {
  return isValidRecord(m) ? m.averageTimeSec : null
}

/** 후보가 기존 best보다 빠른가 */
export function isBetter(candidate: AttemptMetrics, current: BoardBest | null | undefined): boolean {
  const t = recordTimeSec(candidate)
  if (t === null) return false
  if (!current) return true
  return t < current.timeSec
}

/** 3개 도전 모두 기록 시 평균(초), 아니면 null */
export function averageSec(bests: Partial<Record<ChallengeSlot, BoardBest>>): number | null {
  const times = CHALLENGE_SLOTS.map((s) => bests[s]?.timeSec)
  if (times.some((t) => t === undefined)) return null
  return (times as number[]).reduce((a, b) => a + b, 0) / CHALLENGE_SLOTS.length
}

/** 랭킹 정렬: 평균 빠른 순 → (동률) 갱신시각 빠른 순. 평균 없음(미완) = 뒤로 */
export function compareEntries(a: BoardEntryDoc, b: BoardEntryDoc): number {
  const aa = averageSec(a.bests)
  const bb = averageSec(b.bests)
  if (aa !== null && bb !== null) {
    if (aa !== bb) return aa - bb
    return a.updatedAt.localeCompare(b.updatedAt)
  }
  if (aa !== null) return -1
  if (bb !== null) return 1
  // 둘 다 미완 — 기록 수 많은 순, 다음 갱신시각
  const ac = CHALLENGE_SLOTS.filter((s) => a.bests[s]).length
  const bc = CHALLENGE_SLOTS.filter((s) => b.bests[s]).length
  if (ac !== bc) return bc - ac
  return a.updatedAt.localeCompare(b.updatedAt)
}

/** 표시용 시간 포맷 (소수 1자리 초) */
export function formatSec(t: number | null | undefined): string {
  if (t === null || t === undefined) return '-'
  return `${t.toFixed(1)}s`
}
