import { useEffect, useState } from 'react'

let request
const disabled = { payments: false }

// One request per page load. A restart/configuration change requires a reload.
export default function useInstanceCapabilities () {
  const [capabilities, setCapabilities] = useState({ ...disabled, loaded: false })
  useEffect(() => {
    let mounted = true
    request ||= fetch('/noo/capabilities', { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error('Capabilities unavailable')
        return response.json()
      })
      .then(result => ({ payments: result.payments === true }))
      .catch(() => disabled)
    request.then(result => { if (mounted) setCapabilities({ ...result, loaded: true }) })
    return () => { mounted = false }
  }, [])
  return capabilities
}
