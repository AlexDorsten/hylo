const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadBackend = require('./helpers/load-backend.cjs')
const { randomBytes, generateKeyPairSync } = require('node:crypto')

test('requesting password recovery never issues a general login JWT', async () => {
  const calls = []
  const user = { get: () => 'member@example.org', getLocale: () => 'en', generateJWT () { calls.push('login-jwt'); return 'general-login-token' } }
  const { sendPasswordReset } = loadBackend('api/graphql/mutations/user.js', {
    mocks: { '@hylo/shared': {}, '../../../lib/sentry': {}, '../../../lib/HyloJWT': {} },
    globals: {
      User: { query: () => ({ fetch: async () => user }) },
      Frontend: { Route: { evo: { passwordSetting: () => '/settings' }, jwtLogin: () => '/noo/login/jwt?token=general-login-token' } },
      Queue: { classMethod: async (...args) => calls.push(args) },
      PasswordRecovery: { request: async args => calls.push(['recovery', args.email, args.ip]) }
    }
  })
  const result = await sendPasswordReset(null, { email: 'member@example.org' }, { req: { ip: '192.0.2.1' } })
  assert.equal(result.success, true)
  assert.equal(calls.includes('login-jwt'), false, 'a password-reset request must not mint a general login token')
  assert.deepEqual(calls, [['recovery', 'member@example.org', '192.0.2.1']])
})

test('the actual Passport login strategy rejects opaque recovery tokens in headers and URLs', async () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  let strategy
  loadBackend('config/passport.js', {
    env: { OIDC_KEYS: 'fixture', PROTOCOL: 'https', DOMAIN: 'hylo.example.org' },
    mocks: {
      passport: { use: value => { strategy = value }, serializeUser () {}, deserializeUser () {} },
      '../lib/util': { getPublicKeyFromPem: () => publicKey },
      '../lib/authentication.cjs': { configuration: () => ({ google: false, linkedin: false }) }
    },
    globals: { User: { find () { assert.fail('Recovery tokens must never resolve a login user') } } }
  })
  const token = randomBytes(32).toString('base64url')
  for (const req of [{ headers: { authorization: `Bearer ${token}` }, url: '/noo/login/jwt' }, { headers: {}, url: `/noo/login/jwt?token=${token}` }]) {
    await new Promise((resolve, reject) => {
      strategy.fail = () => resolve()
      strategy.error = reject
      strategy.success = () => reject(new Error('Recovery token authenticated'))
      strategy.authenticate(req)
    })
  }
})

test('recovery HTTP boundary requires same-origin JSON and never creates a session', async () => {
  const calls = []
  const controller = loadBackend('api/controllers/PasswordRecoveryController.js', {
    mocks: { '../../lib/authentication.cjs': { configuration: () => ({ origin: 'https://hylo.example.org' }) } },
    globals: { PasswordRecovery: { complete: async data => calls.push(data) } }
  })
  const response = () => ({
    headers: {}, code: 200,
    set (key, value) { this.headers[key] = value },
    type (value) { this.contentType = value },
    status (code) { this.code = code; return this },
    json (body) { this.body = body },
    send (body) { this.body = body }
  })
  const req = { get: () => 'https://hylo.example.org', is: () => true, body: { token: 'opaque', password: 'new-password', confirmation: 'new-password' }, ip: '192.0.2.1' }
  for (const patch of [{ get: () => 'https://other.example.org' }, { get: () => undefined }, { is: () => false }]) {
    const res = response()
    await controller.complete({ ...req, ...patch }, res)
    assert.equal(res.code, 403)
  }
  assert.equal(calls.length, 0)
  const res = response()
  await controller.complete(req, res)
  assert.equal(res.body.success, true)
  assert.equal(calls.length, 1)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  for (const lang of ['de', 'en', false]) {
    const page = response()
    controller.show({ acceptsLanguages: () => lang }, page)
    assert.match(page.headers['Content-Security-Policy'], /frame-ancestors 'none'/)
    assert.match(page.headers['Content-Security-Policy'], /default-src 'none'/)
    assert.equal(page.contentType, 'html')
    assert.match(page.body, /autocomplete="new-password"/)
  }
  assert.equal(calls.length, 1, 'opening a mail link must not consume it')
})
