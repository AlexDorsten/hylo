const assert = require('node:assert/strict')
const { test } = require('node:test')
const { fixture } = require('./helpers/oidc-fixture.cjs')
const { attemptKey } = require('../../apps/backend/lib/externalOidc.cjs')

test('two issuers with the same subject stay separate; PKCE, nonce and fixed callback are used', async () => {
  const f = await fixture()
  for (const provider of ['alpha', 'beta']) {
    const { url, query } = await f.begin(provider, provider)
    assert.equal(url.searchParams.get('redirect_uri'), `https://hylo.example.org/noo/login/oidc/${provider}/callback`)
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), 'openid')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.deepEqual(await f.client.finish(provider, provider, query), { issuer: `https://${provider}.example.org`, subject: 'subject-1', userId: null })
    await assert.rejects(f.client.finish(provider, provider, query))
  }
  assert.ok(f.requests.some(url => url.endsWith('/jwks')), 'ID token signature is checked against provider keys')
})

test('linking binds the local account and requests fresh provider authentication', async () => {
  const f = await fixture()
  const { url, query } = await f.begin('alpha', 'session', '42')
  assert.equal(url.searchParams.get('prompt'), 'login')
  assert.equal((await f.client.finish('alpha', 'session', query)).userId, '42')
})

test('wrong state, duplicate state, wrong provider and wrong session cannot consume a valid attempt', async () => {
  const f = await fixture()
  const { query } = await f.begin()
  await assert.rejects(f.client.finish('alpha', 'other-session', query))
  await assert.rejects(f.client.finish('beta', 'session', query))
  await assert.rejects(f.client.finish('alpha', 'session', query.replace(/state=.*/, 'state=' + 'x'.repeat(43))))
  await assert.rejects(f.client.finish('alpha', 'session', query + '&state=duplicate'))
  await assert.rejects(f.client.finish('unknown', 'session', query))
  assert.equal((await f.client.finish('alpha', 'session', query)).subject, 'subject-1')
})

test('a newer attempt invalidates the old one and parallel callbacks have one winner', async () => {
  const f = await fixture()
  const old = await f.begin()
  const current = await f.begin()
  await assert.rejects(f.client.finish('alpha', 'session', old.query))
  const results = await Promise.allSettled([f.client.finish('alpha', 'session', current.query), f.client.finish('alpha', 'session', current.query)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
})

test('invalid issuer, audience, nonce, expiry, subject and signatures fail closed', async t => {
  const f = await fixture()
  for (const [name, mutations] of Object.entries({
    issuer: { claims: { iss: 'https://evil.example.org' } },
    audience: { claims: { aud: 'other-client' } },
    nonce: { claims: { nonce: 'wrong' } },
    expiry: { claims: { exp: 1 } },
    subject: { claims: { sub: '' } },
    signature: { badSignature: true },
    outage: { failure: true }
  })) {
    await t.test(name, async () => {
      const { query } = await f.begin('alpha', name, null, mutations)
      await assert.rejects(f.client.finish('alpha', name, query))
      await assert.rejects(f.client.finish('alpha', name, query), /Missing OIDC attempt/)
    })
  }
})

test('expired attempts and corrupted PKCE are rejected', async () => {
  const f = await fixture()
  for (const mutation of [{ createdAt: 0 }, { verifier: 'wrong' }]) {
    const { query } = await f.begin()
    const key = attemptKey('session')
    f.entries.set(key, JSON.stringify({ ...JSON.parse(f.entries.get(key)), ...mutation }))
    await assert.rejects(f.client.finish('alpha', 'session', query))
  }
})
