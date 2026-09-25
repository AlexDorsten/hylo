import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAuthProviders from 'hooks/useAuthProviders'
import Button from 'components/ui/button'

export default function ExternalAccountConnections () {
  const { t } = useTranslation()
  const { oidc } = useAuthProviders()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const params = new URLSearchParams(window.location.search)

  const connect = async id => {
    setBusy(true)
    setError(false)
    try {
      const response = await fetch(`/noo/login/oidc/${encodeURIComponent(id)}/link`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (!response.ok) throw new Error('Unable to connect')
      const { authorizationUrl } = await response.json()
      window.location.assign(authorizationUrl)
    } catch {
      setError(true)
      setBusy(false)
    } finally {
      setPassword('')
    }
  }

  if (!oidc.length) return null
  return (
    <section className='space-y-3 border-t border-foreground/10 pt-4' aria-label={t('External sign-in providers')}>
      <h3>{t('External sign-in providers')}</h3>
      <p>{t('Confirm your current Hylo password to connect a provider. Your local login remains available.')}</p>
      <label className='block'>
        {t('Current Hylo password')}
        <input type='password' autoComplete='current-password' value={password} onChange={event => setPassword(event.target.value)} className='block border rounded p-2 bg-input text-foreground' />
      </label>
      {(error || params.has('oidcError')) && <p role='alert'>{t('Unable to connect the provider. Check your password and verified email, then try again.')}</p>}
      {params.has('oidcLinked') && <p role='status'>{t('Sign-in provider connected.')}</p>}
      <div className='flex flex-wrap gap-2'>
        {oidc.map(provider => <Button key={provider.id} disabled={busy || !password} onClick={() => connect(provider.id)}>{t('Connect {{provider}}', { provider: provider.name })}</Button>)}
      </div>
    </section>
  )
}
