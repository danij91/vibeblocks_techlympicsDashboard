// Claude 소유 공용 토스트 — UI 상태 전환 피드백 (vb-116 v3 웹14)
// 사용: 루트에 <ToastProvider>…</ToastProvider>, 컴포넌트에서 const toast = useToast(); toast('Saved')
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setItems((prev) => [...prev, { id, kind, text }])
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200)
  }, [])

  const colors: Record<ToastKind, string> = { info: '#1a1a2e', success: '#176b3a', error: '#a4263a' }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'grid', gap: 8, zIndex: 1000 }}>
        {items.map((t) => (
          <div key={t.id} style={{ background: colors[t.kind], color: '#fff', padding: '10px 18px', borderRadius: 10, boxShadow: '0 6px 24px rgba(20,22,40,.25)', fontSize: 14 }}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
