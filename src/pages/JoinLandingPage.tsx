// Claude 소유 — QR 폴백 랜딩 (앱 미설치 시 도달). 랭킹 없음 — 랭킹은 콘솔 전용 (v3)
import { useParams } from 'react-router-dom'
import { normalizeCode } from '../api/codes'

export default function JoinLandingPage() {
  const params = useParams()
  const joinCode = normalizeCode(params.joinCode ?? '')
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 16 }}>
        <p style={{ letterSpacing: 2, fontSize: 12, color: '#5a5e7a', margin: 0 }}>CLASS CODE {joinCode}</p>
        <h1 style={{ margin: 0 }}>Join in the VibeBlocks app.</h1>
        <p style={{ color: '#5a5e7a', margin: 0 }}>
          Install the VibeBlocks app, then scan the class QR again — your class code will be filled in automatically.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          <a href="#" style={{ padding: '12px 16px', borderRadius: 10, background: '#1a1a2e', color: '#fff', textDecoration: 'none' }}>
            App Store
          </a>
          <a href="#" style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #ccd0e0', color: '#1a1a2e', textDecoration: 'none' }}>
            Google Play
          </a>
        </div>
      </section>
    </main>
  )
}
