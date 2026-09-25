// Runs inside the disposable CI API container, after guarded bootstrap.
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const origin = 'http://127.0.0.1:3001'

async function main () {
  assert.equal(process.env.HYLO_PAYMENTS_ENABLED, 'false')
  assert.ok(!process.env.STRIPE_SECRET_KEY, 'This check must run without a Stripe key')
  let capabilities
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(origin + '/noo/capabilities', { signal: AbortSignal.timeout(2000) })
      if (response.ok) { capabilities = await response.json(); break }
    } catch {}
    await delay(2000)
  }
  assert.deepEqual(capabilities, { payments: false }, 'API must become ready with disabled payments')
  const providers = await (await fetch(origin + '/noo/auth/providers')).json()
  assert.equal(providers.registration, false)
  assert.equal(providers.password, true)
  for (const mutation of [
    'sendEmailVerification(email: "closed-registration@example.org") { success error }',
    'verifyEmail(email: "closed-registration@example.org", code: "123456") { error }',
    'verifyEmail(email: "closed-registration@example.org", token: "old-registration-link") { error }',
    'register(name: "Closed Registration", password: "fixture-password") { error }'
  ]) {
    const response = await fetch(origin + '/noo/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `mutation { ${mutation} }` })
    })
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.errors, undefined, JSON.stringify(result.errors))
    assert.equal(Object.values(result.data)[0].error, 'REGISTRATION_DISABLED')
  }
  const recovery = await fetch(origin + '/noo/password-reset', { headers: { 'Accept-Language': 'de' } })
  assert.equal(recovery.status, 200)
  assert.equal(recovery.headers.get('cache-control'), 'no-store')
  assert.equal(recovery.headers.get('referrer-policy'), 'no-referrer')
  assert.match(recovery.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(await recovery.text(), /Neues Passwort wählen/)
  const crossOrigin = await fetch(origin + '/noo/password-reset', { method: 'POST', headers: { Origin: 'https://other.example.org', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(crossOrigin.status, 403)
  const payment = await fetch(origin + '/noo/stripe/health')
  assert.equal(payment.status, 503)
  assert.deepEqual(await payment.json(), { error: 'PAYMENTS_DISABLED' })
  const response = await fetch(origin + '/noo/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ platformAgreements { id } publicStripeOffering(offeringId: "1") { id } }' })
  })
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(result.data.platformAgreements), 'Unrelated public queries must still work')
  assert.equal(result.data.publicStripeOffering, null)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].message, 'Payments are disabled on this instance')
  assert.equal(result.errors[0].extensions.code, 'PAYMENTS_DISABLED')
  console.log('API, closed registration, recovery routes, capabilities, non-payment GraphQL and payment rejection passed without Stripe credentials')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
