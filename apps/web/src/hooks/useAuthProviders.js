import { useEffect, useState } from 'react'

// A provider outage or a failed capabilities request must leave local login usable.
export default function useAuthProviders () {
  const [providers, setProviders] = useState({ password: true, registration: false, loading: true, google: false, oidc: [] })
  useEffect(() => {
    const controller = new AbortController()
    fetch('/noo/auth/providers', { credentials: 'same-origin', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Unable to load sign-in providers')
        return response.json()
      })
      .then(result => setProviders({ password: true, registration: result.registration === true, loading: false, google: result.google === true, oidc: Array.isArray(result.oidc) ? result.oidc : [] }))
      .catch(() => {
        if (!controller.signal.aborted) setProviders(current => ({ ...current, loading: false }))
      })
    return () => controller.abort()
  }, [])
  return providers
}
