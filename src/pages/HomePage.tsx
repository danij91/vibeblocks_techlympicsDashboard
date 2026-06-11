import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { classifyCode, normalizeCode } from '../api/codes'
import styles from '../features/ranking/publicPages.module.css'

// Owned by task vb-116-web-ranking (CONTRACT.md §7)
export default function HomePage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeCode(code)
    const kind = classifyCode(normalized)

    if (kind === 'join') {
      navigate(`/r/${normalized}`)
      return
    }

    if (kind === 'teacher') {
      navigate('/teacher')
      return
    }

    setError(
      kind === 'recovery'
        ? 'Recovery codes are used inside the VibeBlocks app.'
        : kind === 'invite'
          ? 'Organizer invite codes are handled in the organizer area.'
          : 'Enter a 6-character class code, such as KEDAH7.',
    )
  }

  return (
    <main className={styles.shell}>
      <section className={styles.homeHero} aria-labelledby="home-title">
        <div className={styles.brandBar}>
          <span className={styles.brandMark}>VB</span>
          <span>VibeBlocks Techlympics</span>
        </div>
        <div className={styles.homeCopy}>
          <p className={styles.kicker}>FC-1 Competition Platform</p>
          <h1 id="home-title">Find your class leaderboard.</h1>
          <p>
            Enter the class code from your teacher to view current results or continue to the VibeBlocks app.
          </p>
        </div>
        <form className={styles.codeForm} onSubmit={submitCode}>
          <label htmlFor="class-code">Class or teacher code</label>
          <div className={styles.codeEntry}>
            <input
              id="class-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                if (error) setError(null)
              }}
              placeholder="KEDAH7"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">Continue</button>
          </div>
          {error ? <p className={styles.formError}>{error}</p> : null}
        </form>
      </section>
    </main>
  )
}
