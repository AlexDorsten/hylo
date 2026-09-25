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
  console.log('API, capabilities, non-payment GraphQL and payment rejection passed without Stripe credentials')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
