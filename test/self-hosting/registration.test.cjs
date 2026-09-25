const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadBackend = require('./helpers/load-backend.cjs')
const { configuration, capabilities } = require('../../apps/backend/lib/authentication.cjs')
const disabled = { HYLO_REGISTRATION_ENABLED: 'false' }
const userMocks = { '@hylo/shared': {}, '../../../lib/sentry': {}, '../../../lib/HyloJWT': {} }

test('registration defaults to enabled, advertises its runtime flag and rejects typos', () => {
  assert.equal(capabilities(configuration({})).registration, true)
  assert.equal(capabilities(configuration({ HYLO_REGISTRATION_ENABLED: 'true' })).registration, true)
  const caps = capabilities(configuration(disabled))
  assert.equal(caps.registration, false)
  assert.equal(caps.password, true)
  for (const value of ['', '0', '1', 'FALSE', 'off']) {
    assert.throws(() => configuration({ HYLO_REGISTRATION_ENABLED: value }), /must be true or false/)
  }
})

test('closed registration rejects verification, old links and completion before any side effects', async () => {
  // Missing service globals deliberately make any accidental account, session,
  // credential, code or mail access fail instead of hiding it behind a stub.
  const mutations = loadBackend('api/graphql/mutations/user.js', { env: disabled, mocks: userMocks })
  const context = { currentUserId: '42', req: { session: {} } }
  const fetchOne = () => assert.fail('No account must be exposed')
  assert.equal((await mutations.sendEmailVerification(null, { email: 'new@example.org' })).error, 'REGISTRATION_DISABLED')
  for (const args of [{ email: 'pending@example.org', code: '123456' }, { token: 'old-verification-link' }]) {
    assert.equal((await mutations.verifyEmail(fetchOne)(null, args, context)).error, 'REGISTRATION_DISABLED')
  }
  assert.equal((await mutations.register(fetchOne)(null, { name: 'Pending Member', password: 'valid-password' }, context)).error, 'REGISTRATION_DISABLED')
  assert.deepEqual(context.req.session, {})
})

test('closed registration retains password login and password recovery', async () => {
  const calls = []
  const mutations = loadBackend('api/graphql/mutations/user.js', {
    env: disabled,
    mocks: userMocks,
    globals: {
      User: { authenticate: async (email, password) => { calls.push(['authenticate', email, password]); return { id: '42' } } },
      UserSession: { login: async (req, user, provider) => { calls.push(['login', provider]); req.session.userId = user.id } },
      PasswordRecovery: { request: async ({ email }) => calls.push(['recover', email]) }
    }
  })
  const context = { req: { session: {} } }
  const result = await mutations.login((model, id) => ({ id }))(null, { email: 'member@example.org', password: 'fixture' }, context)
  assert.equal(result.me.id, '42')
  assert.equal(context.req.session.userId, '42')
  assert.equal((await mutations.sendPasswordReset(null, { email: 'member@example.org' }, context)).success, true)
  assert.deepEqual(calls, [['authenticate', 'member@example.org', 'fixture'], ['login', 'password'], ['recover', 'member@example.org']])
})

test('client-credential account creation is also closed', async () => {
  const controller = loadBackend('api/controllers/UserController.js', {
    env: disabled,
    mocks: {
      '../../lib/i18n/locales': {},
      '../services/InvitationService': {},
      '../services/oidc/KnexAdapter': {},
      '../../lib/HyloJWT': {},
      '../services/Websockets': {}
    }
  })
  const response = { status (code) { this.code = code; return this }, json (body) { this.body = body } }
  await controller.create({}, response)
  assert.equal(response.code, 403)
  assert.equal(response.body.error, 'REGISTRATION_DISABLED')
})

for (const native of [false, true]) {
  for (const account of ['unknown', 'unfinished', 'existing']) {
    test(`closed social registration: ${account}, ${native ? 'native' : 'web'}`, async () => {
      const calls = []
      const user = account === 'unknown'
        ? undefined
        : {
            id: '42',
            get: () => 'Existing Member',
            save: async () => calls.push('save'),
            relations: { linkedAccounts: { length: account === 'unfinished' ? 0 : 1, where: () => account === 'unfinished' ? [] : [{}] } }
          }
      const controller = loadBackend('api/controllers/SessionController.js', {
        env: disabled,
        mocks: {
          passport: { authenticate: (_, callback) => () => callback(null, { id: 'external', email: 'member@example.org', name: 'Profile Name' }) },
          'apple-signin-auth': {},
          '@hylo/shared': { Validators: { validateUser: { name: () => false } } },
          '../services/oidc/KnexAdapter': {},
          '../services/OIDCTokens': { mintTokensForUser: async () => { calls.push('tokens'); return {} } },
          '../../lib/sentry': { error () {} }
        },
        globals: {
          User: { query: () => ({ fetchAll: async () => ({ length: user ? 1 : 0, first: () => user }) }), create: () => assert.fail('No new user') },
          UserSession: { isLoggedIn: () => false, login: async () => calls.push('login') },
          LinkedAccount: { create: () => assert.fail('No new credential') },
          UserExternalData: { store: async () => calls.push('profile') }
        }
      })
      const req = { headers: { accept: 'application/json' }, session: {}, get: () => native ? '1' : undefined }
      const res = { ok () { this.success = true }, serverError (error) { this.error = error.message } }
      await controller.finishGoogleOAuth(req, res)
      if (account === 'existing') {
        assert.equal(res.success, true)
        assert.deepEqual(calls, native ? ['save', 'profile', 'tokens'] : ['login', 'profile'])
      } else {
        assert.equal(res.error, 'REGISTRATION_DISABLED')
        assert.deepEqual(calls, [])
      }
    })
  }
}
