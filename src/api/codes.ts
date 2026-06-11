// 코드 체계 — CONTRACT.md §2. 변경은 Claude 승인 경유.
// 0/O/1/I/L 제외 알파벳 (현장 구두 전달·칠판 판서 오독 방지)
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function randomCode(len: number): string {
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('')
}

export const newJoinCode = () => randomCode(6) // 학급코드: K7XM3Q
export const newTeacherCode = () => `T-${randomCode(8)}` // 교사코드 (가입 게이트)
export const newRecoveryCode = () => `R-${randomCode(12)}` // 복구코드 (비밀)
export const newPublicId = () => `P-${randomCode(4)}` // 참가자 공개 ID
export const newInviteCode = () => `V-${randomCode(10)}` // organizer 초대코드

// 입력칸 하나에서 코드 종류 자동 구분 (prefix 기반)
export type CodeKind = 'join' | 'teacher' | 'recovery' | 'invite' | 'unknown'
export function classifyCode(input: string): CodeKind {
  const s = input.trim().toUpperCase()
  if (/^T-[A-Z2-9]{8}$/.test(s)) return 'teacher'
  if (/^R-[A-Z2-9]{12}$/.test(s)) return 'recovery'
  if (/^V-[A-Z2-9]{10}$/.test(s)) return 'invite'
  if (/^[A-Z2-9]{6}$/.test(s)) return 'join'
  return 'unknown'
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase()
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
