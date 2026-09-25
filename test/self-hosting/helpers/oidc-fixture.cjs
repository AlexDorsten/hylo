const { createRequire } = require('node:module')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const backendRequire = createRequire(path.resolve(__dirname, '../../../apps/backend/package.json'))
const protocol = backendRequire('openid-client')
const { generateKeyPair, exportJWK, SignJWT } = createRequire(backendRequire.resolve('openid-client'))('jose')
const { createClient } = require('../../../apps/backend/lib/externalOidc.cjs')
const { configuration } = require('../../../apps/backend/lib/authentication.cjs')

// A transport fixture, not a replacement OIDC client: production openid-client
// performs discovery, code exchange, PKCE, claim and signature verification.
async function fixture () {
  const signing = await generateKeyPair('RS256')
  const wrongKey = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(signing.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' }
  const entries = new Map()
  const codes = new Map()
  const requests = []
  const providers = ['alpha', 'beta'].map(id => ({ id, name: id, issuer: `https://${id}.example.org`, clientId: 'hylo', clientSecret: 'test-only-secret', tokenEndpointAuthMethod: id === 'beta' ? 'client_secret_post' : 'client_secret_basic' }))
  const config = configuration({ PROTOCOL: 'https', DOMAIN: 'hylo.example.org', HYLO_OIDC_PROVIDERS: JSON.stringify(providers) })
  const redis = {
    async set (key, value, ex, ttl) { entries.set(key, value) },
    async eval (script, count, key, state, providerId) {
      const raw = entries.get(key)
      if (!raw) return null
      const attempt = JSON.parse(raw)
      if (attempt.state !== state || attempt.providerId !== providerId) return null
      entries.delete(key)
      return raw
    }
  }
  const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  const fetch = async (input, options = {}) => {
    const url = new URL(input)
    requests.push(url.href)
    const provider = providers.find(p => p.issuer === url.origin)
    if (!provider) throw new Error('Unexpected destination')
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: provider.issuer,
        authorization_endpoint: `${provider.issuer}/authorize`,
        token_endpoint: `${provider.issuer}/token`,
        jwks_uri: `${provider.issuer}/jwks`,
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256']
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    assertTokenPath(url)
    const body = new URLSearchParams(options.body)
    const code = codes.get(body.get('code'))
    codes.delete(body.get('code'))
    if (!code || code.url.origin !== url.origin || body.get('grant_type') !== 'authorization_code') throw new Error('Invalid code')
    const challenge = createHash('sha256').update(body.get('code_verifier') || '').digest('base64url')
    if (challenge !== code.url.searchParams.get('code_challenge')) throw new Error('Invalid PKCE')
    if (body.get('redirect_uri') !== code.url.searchParams.get('redirect_uri')) throw new Error('Invalid redirect URI')
    const headers = new Headers(options.headers)
    if (provider.tokenEndpointAuthMethod === 'client_secret_post') {
      if (headers.has('authorization') || body.get('client_id') !== provider.clientId || body.get('client_secret') !== provider.clientSecret) throw new Error('Invalid client authentication')
    } else if (decodeURIComponent(Buffer.from((headers.get('authorization') || '').slice(6), 'base64').toString()) !== 'hylo:test-only-secret') throw new Error('Invalid client authentication')
    if (code.failure) throw new Error('Provider unavailable')
    const payload = {
      iss: provider.issuer,
      sub: 'subject-1',
      aud: 'hylo',
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      nonce: code.url.searchParams.get('nonce'),
      email: 'same@example.org',
      email_verified: true,
      groups: ['admins'],
      roles: ['admin'],
      ...code.claims
    }
    const token = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(code.badSignature ? wrongKey.privateKey : signing.privateKey)
    return json({ access_token: 'not-retained', token_type: 'Bearer', id_token: token })
  }
  const client = createClient({ config, redis, discoveryOptions: { [protocol.customFetch]: fetch } })
  async function begin (provider = 'alpha', session = 'session', userId = null, mutations = {}) {
    const url = new URL(await client.start(provider, session, userId))
    const code = randomUUID()
    codes.set(code, { url, ...mutations })
    return { url, query: new URLSearchParams({ code, state: url.searchParams.get('state') }).toString() }
  }
  return { client, begin, entries, redis, requests, config }
}
function assertTokenPath (url) { if (url.pathname !== '/token') throw new Error('Unexpected endpoint') }
module.exports = { fixture, backendRequire }
