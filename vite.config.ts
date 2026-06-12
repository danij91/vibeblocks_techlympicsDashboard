import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 포트 = 2xxx 회사 표준 (AGENTS.md) — 2180
export default defineConfig({
  // vibeblocks.co/techlympics 경로 아래에서 서빙 (vercel rewrite 프록시)
  base: '/techlympics/',
  plugins: [react()],
  server: { port: 2180 },
})
