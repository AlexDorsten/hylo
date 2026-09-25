const assert = require('node:assert/strict')
const { test } = require('node:test')
const { configuration, capabilities, explicitId } = require('../../apps/backend/lib/authentication.cjs')
const provider = { id: 'community', name: 'Community', issuer: 'https://id.example.org/realm', clientId: 'hylo', clientSecret: 'private' }
const environment = p => ({ PROTOCOL: 'https', DOMAIN: 'hylo.example.org', HYLO_OIDC_PROVIDERS: JSON.stringify(p) })

test('local login needs no Google, LinkedIn or external OIDC credentials', () => {
  assert.deepEqual(capabilities(configuration({})), { password: true, registration: true, google: false, oidc: [] })
  assert.throws(() => configuration({ GOOGLE_CLIENT_ID: 'partial' }))
  assert.throws(() => configuration({ LINKEDIN_API_SECRET: 'partial' }))
  assert.equal(configuration({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' }).google, true)
})

test('public capabilities expose only labels and local login URLs', () => {
  assert.deepEqual(capabilities(configuration(environment([provider]))), {
    password: true, registration: true, google: false, oidc: [{ id: 'community', name: 'Community', loginUrl: '/noo/login/oidc/community' }]
  })
})

test('invalid, insecure and ambiguous provider configuration fails at startup', () => {
  for (const patch of [{ id: '../escape' }, { id: 1 }, { name: '' }, { clientSecret: '' }, { issuer: 'http://id.example.org' }, { issuer: 'https://user:pass@id.example.org' }, { issuer: 'https://id.example.org?query=1' }, { issuer: 'https://id.example.org/#fragment' }, { issuer: 'https://ID.example.org' }, { tokenEndpointAuthMethod: 'none' }]) {
    assert.throws(() => configuration(environment([{ ...provider, ...patch }])))
  }
  assert.throws(() => configuration(environment([provider, provider])))
  assert.throws(() => configuration(environment({})))
  assert.throws(() => configuration({ ...environment([provider]), DOMAIN: 'hylo.example.org/path' }))
  assert.throws(() => configuration({ ...environment([provider]), PROTOCOL: 'http' }))
  assert.throws(() => configuration({ HYLO_OIDC_PROVIDERS: 'broken json' }))
  assert.equal(configuration(environment([{ ...provider, issuer: 'https://id.example.org' }])).oidc.length, 1)
})

test('administration requires an exact explicit user ID, not an email or domain', () => {
  assert.equal(explicitId('9007199254740993', '42, 9007199254740993'), true)
  for (const value of ['9007199254740992', '42junk', '04', '4e1', '', undefined, 'admin@hylo.com']) assert.equal(explicitId(value, '42, 9007199254740993'), false)
  assert.equal(explicitId(42, ''), false)
  assert.equal(explicitId(42, '42'), true)
})

test('Passport loads with no social credentials and registers only configured strategies', () => {
  const loadBackend = require('./helpers/load-backend.cjs')
  const { publicKey } = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  for (const enabled of [false, true]) {
    const registered = []
    loadBackend('config/passport.js', {
      env: { OIDC_KEYS: 'fixture', PROTOCOL: 'https', DOMAIN: 'hylo.example.org', ...(enabled ? { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', LINKEDIN_API_KEY: 'client', LINKEDIN_API_SECRET: 'secret' } : {}) },
      mocks: {
        passport: { use: strategy => registered.push(strategy.name), serializeUser () {}, deserializeUser () {} },
        '../lib/util': { getPublicKeyFromPem: () => publicKey },
        '../lib/authentication.cjs': { configuration: () => ({ google: enabled, linkedin: enabled }) }
      },
      globals: { format: require('node:util').format }
    })
    assert.deepEqual(registered.sort(), enabled ? ['google', 'google-token', 'jwt', 'linkedin', 'linkedin-token'] : ['jwt'])
  }
})

test('legacy social routes reject unavailable providers before authentication', () => {
  const loadBackend = require('./helpers/load-backend.cjs')
  for (const enabled of [false, true]) {
    const policy = loadBackend('api/policies/enabledLoginProvider.js', {
      mocks: { '../../lib/authentication.cjs': { configuration: () => ({ google: enabled, linkedin: enabled }) } }
    })
    for (const provider of ['google', 'google-token', 'linkedin', 'linkedin-token', 'facebook', 'apple']) {
      let allowed = false
      let denied = false
      policy({ path: '/noo/login/' + provider + '/oauth' }, { notFound: () => { denied = true } }, () => { allowed = true })
      const expected = enabled && ['google', 'google-token', 'linkedin', 'linkedin-token'].includes(provider)
      assert.equal(allowed, expected)
      assert.equal(denied, !expected)
    }
  }
})
