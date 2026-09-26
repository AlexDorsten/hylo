const client = require('openid-client')
const { createHash } = require('node:crypto')

const ATTEMPT_SECONDS = 600
const attemptKey = sessionId => 'oidc:attempt:' + createHash('sha256').update(sessionId).digest('hex')

// Atomic consumption across API workers. Wrong state/provider cannot consume a
// legitimate attempt; concurrent correct callbacks can consume it only once.
const consumeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local attempt = cjson.decode(raw)
if attempt.state ~= ARGV[1] or attempt.providerId ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return raw
`

function createClient ({ config, redis, discoveryOptions = {} }) {
  const clients = new Map()
  const provider = id => {
    const p = config.oidc.find(p => p.id === id)
    if (!p) throw new Error('Unknown OIDC provider')
    return p
  }
  const callback = id => `${config.origin}/noo/login/oidc/${id}/callback`
  async function discovered (p) {
    if (!clients.has(p.id)) {
      const auth = p.tokenEndpointAuthMethod === 'client_secret_post' ? client.ClientSecretPost(p.clientSecret) : client.ClientSecretBasic(p.clientSecret)
      const promise = client.discovery(new URL(p.issuer), p.clientId, undefined, auth, {
        ...discoveryOptions, timeout: 10, execute: [client.enableNonRepudiationChecks]
      }).catch(error => { clients.delete(p.id); throw error })
      clients.set(p.id, promise)
    }
    return clients.get(p.id)
  }
  return {
    async start (id, sessionId, userId = null) {
      const p = provider(id)
      const discoveredClient = await discovered(p)
      const attempt = {
        providerId: id,
        issuer: p.issuer,
        state: client.randomState(),
        nonce: client.randomNonce(),
        verifier: client.randomPKCECodeVerifier(),
        userId,
        createdAt: Date.now()
      }
      const url = client.buildAuthorizationUrl(discoveredClient, {
        redirect_uri: callback(id),
        scope: 'openid',
        response_mode: 'query',
        code_challenge: await client.calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: 'S256',
        state: attempt.state,
        nonce: attempt.nonce,
        // Make the selected identity visible when attaching a login method.
        ...(userId ? { prompt: 'login' } : {})
      })
      await redis.set(attemptKey(sessionId), JSON.stringify(attempt), 'EX', ATTEMPT_SECONDS)
      return url.href
    },
    async finish (id, sessionId, query) {
      const p = provider(id)
      const params = new URLSearchParams(query)
      if (params.getAll('state').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(params.get('state'))) throw new Error('Invalid OIDC state')
      const raw = await redis.eval(consumeScript, 1, attemptKey(sessionId), params.get('state'), id)
      if (!raw) throw new Error('Missing OIDC attempt')
      const attempt = JSON.parse(raw)
      if (attempt.issuer !== p.issuer || Date.now() - attempt.createdAt > ATTEMPT_SECONDS * 1000) throw new Error('Expired OIDC attempt')
      const tokens = await client.authorizationCodeGrant(await discovered(p), new URL(`${callback(id)}?${params}`), {
        pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true
      })
      const claims = tokens.claims()
      if (!claims || claims.iss !== p.issuer || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)) throw new Error('Invalid OIDC identity')
      // Neither email nor group/role claims take part in identity or privileges.
      // Access, refresh and ID tokens are deliberately not stored or returned.
      return { issuer: claims.iss, subject: claims.sub, userId: attempt.userId }
    }
  }
}

const linkLimitScript = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], 600) end
return attempts
`

module.exports = { createClient, consumeScript, attemptKey, linkLimitScript }
