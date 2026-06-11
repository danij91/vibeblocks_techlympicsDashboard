import type { AttemptMetrics, BoardEntryDoc } from './types'

// ============================================================
// 점수 공식 v1 — PROVISIONAL (기존 school-v1 계승, Monday 확정 시 버전 추가)
// 원칙: 점수는 저장하지 않는다. raw metrics만 저장, 표시 시점 계산 (CONTRACT §6)
// ============================================================

export function computeScore(m: AttemptMetrics, version = 'v1'): number {
  if (version !== 'v1') throw new Error(`unknown scoring version: ${version}`)
  const successScore = m.successRate * 400
  const starScore = m.stars * 150
  const timeScore = m.averageTimeSec === null ? 0 : Math.max(0, 600 - m.averageTimeSec * 4)
  return Math.round(successScore + starScore + timeScore)
}

// 랭킹 정렬: 점수 ↓ → 평균시간 ↑(null 뒤로) → 제출시각 ↑
export function compareEntries(a: BoardEntryDoc, b: BoardEntryDoc, version = 'v1'): number {
  const sa = computeScore(a.metrics, version)
  const sb = computeScore(b.metrics, version)
  if (sa !== sb) return sb - sa
  const ta = a.metrics.averageTimeSec
  const tb = b.metrics.averageTimeSec
  if (ta !== tb) {
    if (ta === null) return 1
    if (tb === null) return -1
    return ta - tb
  }
  return a.updatedAt.localeCompare(b.updatedAt)
}

// 제출 시 board entry 갱신 판단: 새 attempt가 기존 best보다 나은가
export function isBetter(candidate: AttemptMetrics, current: AttemptMetrics | null, version = 'v1'): boolean {
  if (current === null) return true
  const cs = computeScore(candidate, version)
  const ps = computeScore(current, version)
  if (cs !== ps) return cs > ps
  const ct = candidate.averageTimeSec
  const pt = current.averageTimeSec
  if (ct !== pt) {
    if (ct === null) return false
    if (pt === null) return true
    return ct < pt
  }
  return false
}
