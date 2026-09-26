const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadBackend = require('./helpers/load-backend.cjs')

test('production without a Segment key loads quietly and emits no tracking pixel', () => {
  const analytics = loadBackend('api/services/Analytics.js', {
    env: { NODE_ENV: 'production' },
    globals: { Buffer },
    mocks: { sails: { log: { verbose: () => assert.fail('Disabled analytics must not log event data') } } }
  })
  analytics.track({ userId: '123', event: 'Login' })
  analytics.trackSignup('123', { headers: {} })
  assert.equal(analytics.pixelUrl('Invitation', { userId: '123' }), undefined)
})

test('explicit opt-out wins over a key; configured production analytics still delegates', () => {
  for (const env of [{ NODE_ENV: 'production', DISABLE_SEGMENT: '1' }, { NODE_ENV: 'test' }]) {
    const analytics = loadBackend('api/services/Analytics.js', {
      env: { ...env, SEGMENT_KEY: 'synthetic-key' },
      globals: { Buffer },
      mocks: { 'analytics-node': () => assert.fail('Disabled analytics must not initialize a client') }
    })
    assert.equal(analytics.pixelUrl('Invitation', { userId: '123' }), undefined)
  }
  const events = []
  const analytics = loadBackend('api/services/Analytics.js', {
    env: { NODE_ENV: 'production', SEGMENT_KEY: 'synthetic-key' },
    globals: { Buffer },
    mocks: { 'analytics-node': key => { assert.equal(key, 'synthetic-key'); return { track: event => events.push(event) } } }
  })
  analytics.trackSignup('123', { headers: {} })
  assert.equal(events[0].event, 'Signup success')
  assert.equal(events[0].userId, '123')
  const pixel = new URL(analytics.pixelUrl('Invitation', { userId: '123' }))
  const data = JSON.parse(Buffer.from(pixel.searchParams.get('data'), 'base64').toString())
  assert.equal(data.writeKey, 'synthetic-key')
  assert.equal(data.userId, '123')
})
