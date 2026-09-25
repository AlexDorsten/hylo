const assert = require('node:assert/strict')
const { test } = require('node:test')
const { paymentsEnabled, paymentResolvers, stripeClient } = require('../../apps/backend/lib/payments.cjs')
const loadBackend = require('./helpers/load-backend.cjs')

test('payments need no dummy key, preserve configured legacy instances and reject incomplete opt-in', () => {
  assert.equal(paymentsEnabled({}), false)
  assert.equal(paymentsEnabled({ STRIPE_SECRET_KEY: 'key' }), true)
  assert.equal(paymentsEnabled({ HYLO_PAYMENTS_ENABLED: 'false', STRIPE_SECRET_KEY: 'key' }), false)
  assert.equal(paymentsEnabled({ HYLO_PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'key' }), true)
  assert.throws(() => paymentsEnabled({ HYLO_PAYMENTS_ENABLED: 'true' }))
  assert.throws(() => paymentsEnabled({ HYLO_PAYMENTS_ENABLED: 'typo' }))
})

test('disabled GraphQL and REST payment entry points reject before side effects; community resolvers still run', () => {
  const previous = process.env.HYLO_PAYMENTS_ENABLED
  process.env.HYLO_PAYMENTS_ENABLED = 'false'
  try {
    let writes = 0
    const fields = ['createStripeCheckoutSession', 'processStripeToken', 'recordStripePurchase', 'membershipChangeCommit', 'registerStripeAccount', 'publicStripeOfferings', 'refundContentAccess']
    const resolvers = paymentResolvers(Object.fromEntries([...fields, 'createPost', 'createMessage', 'joinGroup', 'checkContentAccess'].map(name => [name, () => ++writes])))
    for (const field of fields) assert.throws(() => resolvers[field](), error => error.extensions.code === 'PAYMENTS_DISABLED')
    assert.equal(writes, 0)
    for (const field of ['createPost', 'createMessage', 'joinGroup', 'checkContentAccess']) resolvers[field]()
    assert.equal(writes, 4)
    const policy = loadBackend('api/policies/paymentsEnabled.js')
    let status; let response
    policy({}, { status: value => { status = value; return { json: value => { response = value } } } }, () => assert.fail('must not invoke controller'))
    assert.equal(status, 503)
    assert.equal(response.error, 'PAYMENTS_DISABLED')
    const stripe = stripeClient()
    assert.throws(() => stripe.charges, /Payments are disabled/)
  } finally { if (previous === undefined) delete process.env.HYLO_PAYMENTS_ENABLED; else process.env.HYLO_PAYMENTS_ENABLED = previous }
})

test('enabled mode delegates unchanged arguments and results', () => {
  const previous = { enabled: process.env.HYLO_PAYMENTS_ENABLED, key: process.env.STRIPE_SECRET_KEY }
  process.env.HYLO_PAYMENTS_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'test-only-key'
  try {
    const wrapped = paymentResolvers({ createStripeCheckoutSession: (...args) => args })
    assert.deepEqual(wrapped.createStripeCheckoutSession('user', { amount: 20 }), ['user', { amount: 20 }])
  } finally {
    for (const [key, value] of [['HYLO_PAYMENTS_ENABLED', previous.enabled], ['STRIPE_SECRET_KEY', previous.key]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
