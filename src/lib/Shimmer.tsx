// Claude 소유 공용 shimmer — 값이 갱신되는 동안 텍스트 자리에 일렁임 표시 (vb-116 v5)
// 사용: <ShimmerText busy={loading}>{value}</ShimmerText>
import type { ReactNode } from 'react'

export function ShimmerText({ busy, children }: { busy: boolean; children: ReactNode }) {
  if (!busy) return <>{children}</>
  return (
    <span
      aria-busy="true"
      style={{
        display: 'inline-block',
        minWidth: '6ch',
        height: '1em',
        borderRadius: 6,
        background: 'linear-gradient(90deg, #e3e6f0 25%, #f3f5fb 50%, #e3e6f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'vb-shimmer 1.1s ease-in-out infinite',
        color: 'transparent',
      }}
    >
      {children}
    </span>
  )
}
