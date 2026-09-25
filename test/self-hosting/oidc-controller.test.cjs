const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadBackend = require('./helpers/load-backend.cjs')

function harness (options = {}) {
  const calls = []
  const user = { id: '42', get: field => ({ email: 'local@example.org', active: true, email_validated: true, ...options.attributes })[field] }
  const req = {
    params: { providerId: 'alpha' },
    sessionID: 'session',
    originalUrl: '/noo/login/oidc/alpha/callback?state=state&code=code',
    get: () => options.origin || 'https://hylo.example.org',
    is: () => options.json !== false,
    body: { password: 'current-password' },
    session: {
      userId: options.loggedIn === false ? undefined : '42',
      save (done) { calls.push('save'); done() },
      regenerate (done) { calls.push('regenerate'); delete this.userId; done() }
    }
  }
  const res = {
    statusCode: 200,
    headers: {},
    set (key, value) { this.headers[key] = value },
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body },
    redirect (url) { this.location = url }
  }
  const controller = loadBackend('api/controllers/ExternalOidcController.js', {
    mocks: {
      '../services/RedisClient': { create: () => ({ eval: async () => options.limit || 1 }) },
      '../../lib/authentication.cjs': { configuration: () => ({ origin: 'https://hylo.example.org' }), capabilities: () => ({ password: true, oidc: [] }) },
      '../../lib/externalOidc.cjs': {
        createClient: () => ({
          async start (id, session, userId) { calls.push(['start', id, session, userId]); return 'https://id.example.org/authorize' },
          async finish () { if (options.tokenFailure) throw new Error('Invalid token'); return options.identity || { issuer: 'https://id.example.org', subject: 'sub', userId: options.loggedIn === false ? null : '42' } }
        })
      },
      '../../lib/oidcIdentity.cjs': { async resolveIdentity () { calls.push('resolve'); if (options.unlinked) throw new Error('Unlinked'); return '42' } }
    },
    globals: {
      bookshelf: { knex: {} },
      User: { find: async () => options.missing ? null : user, authenticate: async (email, password) => { calls.push(['authenticate', email, password]); if (options.badPassword) throw new Error('Wrong password'); return user } },
      UserSession: { async login (req, user) { calls.push('login'); req.session.userId = user.id } }
    }
  })
  return { controller, req, res, calls }
}

test('link requires same-origin JSON, a verified active local user, fresh password and rate limit', async () => {
  for (const options of [{ loggedIn: false }, { origin: 'https://evil.example.org' }, { json: false }, { attributes: { email_validated: false } }, { attributes: { active: false } }, { missing: true }, { badPassword: true }, { limit: 6 }]) {
    const h = harness(options)
    await h.controller.link(h.req, h.res)
    assert.equal(h.res.statusCode, options.limit ? 429 : 403)
    assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'start'), false)
  }
  const h = harness()
  await h.controller.link(h.req, h.res)
  assert.equal(h.res.statusCode, 200)
  assert.deepEqual(h.calls, [['authenticate', 'local@example.org', 'current-password'], ['start', 'alpha', 'session', '42']])
  assert.equal(h.res.body.authorizationUrl, 'https://id.example.org/authorize')
})

test('anonymous start persists session; callback rotates it before establishing login', async () => {
  const h = harness({ loggedIn: false })
  await h.controller.start(h.req, h.res)
  assert.deepEqual(h.calls, ['save', ['start', 'alpha', 'session', undefined]])
  h.calls.length = 0
  await h.controller.callback(h.req, h.res)
  assert.deepEqual(h.calls, ['resolve', 'regenerate', 'login', 'save'])
  assert.equal(h.req.session.userId, '42')
  assert.equal(h.res.location, '/')
  assert.equal(h.res.headers['Cache-Control'], 'no-store')
  assert.equal(h.res.headers['Referrer-Policy'], 'no-referrer')
})

test('failed tokens, unknown identity and changed linking session cannot create a login', async () => {
  for (const options of [{ tokenFailure: true }, { unlinked: true }, { identity: { userId: 'other-user' } }, { identity: { userId: null } }]) {
    const h = harness(options)
    await h.controller.callback(h.req, h.res)
    assert.equal(h.calls.includes('login'), false)
    assert.match(h.res.location, /oidcError=1$/)
    assert.doesNotMatch(h.res.location, /code=|state=/)
  }
})

test('successful linking returns to account settings and rotates session', async () => {
  const h = harness()
  await h.controller.callback(h.req, h.res)
  assert.equal(h.res.location, '/my/account?oidcLinked=1')
  assert.deepEqual(h.calls, ['resolve', 'regenerate', 'login', 'save'])
})

test('admin service never trusts provider profiles or email domains', async () => {
  const admin = loadBackend('api/services/Admin.js', {
    env: { HYLO_ADMINS: '42', HYLO_TESTER_IDS: '43' }, globals: { User: { find: async id => id !== 'deleted' } }
  })
  assert.equal(admin.isSignedIn({ session: { userId: '7', userEmail: 'person@hylo.com', admin: true } }), false)
  assert.equal(await admin.isSuperAdmin('7'), false)
  assert.equal(admin.isSignedIn({ session: { userId: '42' } }), true)
  assert.equal(await admin.isSuperAdmin('42'), true)
  assert.equal(await admin.isSuperAdmin('43'), false)
  assert.equal(await admin.isTestAdmin('43'), true)
})

test('disabled legacy browser providers return 404 without invoking Passport', () => {
  for (const enabled of [false, true]) {
    const policy = loadBackend('api/policies/enabledLoginProvider.js', {
      mocks: { '../../lib/authentication.cjs': { configuration: () => ({ google: enabled, linkedin: enabled }) } }
    })
    for (const provider of ['google', 'google-token', 'linkedin', 'linkedin-token', 'facebook']) {
      let allowed = false
      let denied = false
      policy({ path: `/noo/login/${provider}/oauth` }, { notFound: () => { denied = true } }, () => { allowed = true })
      assert.equal(allowed, enabled && provider !== 'facebook')
      assert.equal(denied, !allowed)
    }
  }
})
