import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { api } from '../../api'
import { classifyCode, normalizeCode } from '../../api/codes'
import type { EventDoc, SchoolDoc } from '../../api/types'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import AuthPanel from './AuthPanel'
import { isRealUser } from './session'

type GateStep = 'code' | 'confirm' | 'auth'
type ValidatedTeacherCode = {
  code: string
  event: EventDoc
  school: Pick<SchoolDoc, 'id' | 'name'>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function TeacherCodeGate({
  user,
  initialCode = '',
  entryAside,
  onBound,
  onCancel,
}: {
  user: User | null
  initialCode?: string
  entryAside?: ReactNode
  onBound: (role: 'teacher' | 'admin') => void | Promise<void>
  onCancel?: () => void
}) {
  const [step, setStep] = useState<GateStep>('code')
  const [code, setCode] = useState(initialCode)
  const [validated, setValidated] = useState<ValidatedTeacherCode | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const t = useT()

  // 어드민 초대코드(V-) — 같은 입력칸에서 분기. 로그인 상태면 즉시 redeem, 아니면 가입 후 redeem
  const redeemInvite = async (normalized: string, { bubbleError = false }: { bubbleError?: boolean } = {}) => {
    setBusy(true)
    setError('')
    try {
      await api.redeemAdminInvite(normalized)
      await onBound('admin')
      toast(t('auth.inviteRedeemed'), 'success')
      setCode('')
      setInviteCode('')
      setStep('code')
    } catch (err) {
      const message = errorText(err)
      setError(message)
      if (!bubbleError) toast(message, 'error')
      if (bubbleError) throw err
    } finally {
      setBusy(false)
    }
  }

  const validateCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const normalized = normalizeCode(code)
      const kind = classifyCode(normalized)
      if (kind === 'invite') {
        await api.validateAdminInvite(normalized)
        if (isRealUser(user)) {
          await redeemInvite(normalized)
        } else {
          setInviteCode(normalized)
          setStep('auth')
        }
        return
      }
      if (kind !== 'teacher') {
        const message =
          kind === 'join'
            ? t('teacher.classCodeError')
            : kind === 'recovery'
              ? t('teacher.recoveryCodeError')
              : t('teacher.enterTeacherCodeError')
        setError(message)
        toast(message, 'error')
        return
      }
      const result = await api.validateTeacherCode(normalized)
      setValidated({ code: normalized, ...result })
      setStep('confirm')
      toast(t('teacher.teacherCodeConfirmed'), 'success')
    } catch (err) {
      const message = errorText(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const bindValidatedSchool = async ({
    bubbleError = false,
    notifyError = true,
  }: {
    bubbleError?: boolean
    notifyError?: boolean
  } = {}) => {
    if (!validated) return
    setBusy(true)
    setError('')
    try {
      await api.bindTeacherSchool(validated.code)
      await onBound('teacher')
      toast(t('teacher.accessAdded'), 'success')
      setCode('')
      setValidated(null)
      setStep('code')
    } catch (err) {
      const message = errorText(err)
      setError(message)
      if (notifyError) toast(message, 'error')
      if (bubbleError) throw err
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-panel" aria-label={t('teacher.teacherCodeGate')}>
      {entryAside && step === 'code' ? null : (
        <div className="auth-steps" aria-label={t('teacher.onboardingProgress')}>
          <span className={step === 'code' ? 'active' : ''}>{t('teacher.codeStep')}</span>
          <span className={step === 'confirm' ? 'active' : ''}>{t('teacher.confirmStep')}</span>
          <span className={step === 'auth' ? 'active' : ''}>{t('common.account')}</span>
        </div>
      )}

      {step === 'code' ? (
        <form className="auth-form" onSubmit={validateCode}>
          {entryAside ? (
            <div className="home-entry-row">
              <label className="home-entry-field">
                {t('common.teacherCode')}
                <input
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder={t('teacher.teacherCodePlaceholder')}
                  autoComplete="one-time-code"
                />
              </label>
              <button className="auth-button primary" type="submit" disabled={busy || code.trim().length === 0}>
                {busy ? t('teacher.checking') : t('teacher.check')}
              </button>
              {entryAside}
            </div>
          ) : (
            <>
              <label>
                {t('common.teacherCode')}
                <input
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder={t('teacher.teacherCodePlaceholder')}
                  autoComplete="one-time-code"
                />
              </label>
              <div className="auth-actions">
                {onCancel ? (
                  <button className="auth-button" type="button" onClick={onCancel}>
                    {t('common.cancel')}
                  </button>
                ) : null}
                <button className="auth-button primary" type="submit" disabled={busy || code.trim().length === 0}>
                  {busy ? t('teacher.checking') : t('teacher.continue')}
                </button>
              </div>
            </>
          )}
        </form>
      ) : null}

      {step === 'confirm' && validated ? (
        <div className="auth-confirm">
          <p className="auth-eyebrow">{validated.event.name}</p>
          <h2>{validated.school.name}</h2>
          <p>{t('teacher.confirmTeacherCode')}</p>
          <div className="auth-actions">
            <button className="auth-button" type="button" onClick={() => setStep('code')} disabled={busy}>
              {t('teacher.changeCode')}
            </button>
            {isRealUser(user) ? (
              <button className="auth-button primary" type="button" onClick={() => void bindValidatedSchool()} disabled={busy}>
                {busy ? t('teacher.adding') : t('auth.addSchool')}
              </button>
            ) : (
              <button className="auth-button primary" type="button" onClick={() => setStep('auth')} disabled={busy}>
                {t('auth.createTeacherAccount')}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {step === 'auth' ? (
        <AuthPanel
          title={inviteCode ? t('auth.createAccount') : t('auth.createTeacherAccount')}
          mode="sign-up"
          onSignedIn={() =>
            inviteCode
              ? redeemInvite(inviteCode, { bubbleError: true })
              : bindValidatedSchool({ bubbleError: true, notifyError: false })
          }
        />
      ) : null}
      {error ? <div className="auth-alert">{error}</div> : null}
    </section>
  )
}
