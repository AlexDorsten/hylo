import React from 'react'
import { useTranslation } from 'react-i18next'
import useInstanceCapabilities from 'hooks/useInstanceCapabilities'

// The inner component never mounts (or fetches payment data) when disabled.
export default function withPaymentCapability (Component, { hide = false } = {}) {
  return function PaymentCapability (props) {
    const { payments, loaded } = useInstanceCapabilities()
    const { t } = useTranslation()
    if (!loaded) return hide ? null : <p className='p-6' role='status'>{t('Loading...')}</p>
    if (!payments) return hide ? null : <p className='p-6' role='status'>{t('Payments are disabled on this instance.')}</p>
    return <Component {...props} />
  }
}
