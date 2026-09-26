// Opt-in, disposable PostgreSQL/Redis only. All rows and keys are isolated.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const loadBackend = require('./helpers/load-backend.cjs')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const { createRecovery, tokenKey, ttl } = require('../../apps/backend/lib/passwordRecovery.cjs')
const enabled = process.env.HYLO_SELF_HOSTING_INTEGRATION === '1'

test('real storage: recovery is purpose-bound, expires, has one winner and revokes sessions', { skip: !enabled }, async t => {
  const schema = 'recovery_' + randomUUID().replaceAll('-', '')
  const knex = backendRequire('knex')({ client: 'pg', connection: process.env.DATABASE_URL, searchPath: [schema], pool: { min: 0, max: 6 } })
  const rawRedis = new (backendRequire('ioredis'))(process.env.REDIS_URL)
  const ns = schema + ':'
  const redis = {
    set: (key, ...args) => rawRedis.set(ns + key, ...args),
    del: key => rawRedis.del(ns + key),
    getdel: key => rawRedis.getdel(ns + key),
    eval: (script, count, key, ...args) => rawRedis.eval(script, count, ns + key, ...args),
    async scan (cursor, match, pattern, count, size) {
      const [next, keys] = await rawRedis.scan(cursor, match, ns + pattern, count, size)
      return [next, keys.map(key => key.slice(ns.length))]
    }
  }
  t.after(async () => {
    const keys = await rawRedis.keys(ns + '*')
    if (keys.length) await rawRedis.del(...keys)
    await rawRedis.quit()
    await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema])
    await knex.destroy()
  })
  await knex.raw('CREATE SCHEMA ??', [schema])
  await knex.schema.createTable('users', table => { table.bigInteger('id').primary(); table.string('email'); table.boolean('active'); table.boolean('email_validated'); table.jsonb('settings') })
  await knex.schema.createTable('linked_account', table => { table.increments('id'); table.bigInteger('user_id'); table.string('provider_key'); table.string('provider_user_id') })
  await knex.schema.createTable('oidc_payloads', table => { table.string('id').primary(); table.string('grant_id'); table.jsonb('payload') })
  const bcrypt = backendRequire('bcrypt')
  const oldPassword = 'previous-password'
  await knex('users').insert([
    { id: 1, email: 'member@example.org', active: true, email_validated: true, settings: { locale: 'de' } },
    { id: 2, email: 'inactive@example.org', active: false, email_validated: true },
    { id: 3, email: 'unverified@example.org', active: true, email_validated: false },
    { id: 4, email: 'social@example.org', active: true, email_validated: true }
  ])
  await knex('linked_account').insert({ user_id: 1, provider_key: 'password', provider_user_id: await bcrypt.hash(oldPassword, 10) })
  const sent = []; const queued = []
  let failMail = false
  const recovery = createRecovery({
    knex, redis, origin: 'https://hylo.example.org',
    validatePassword: loadBackend('../../packages/shared/src/Validators.js').validateUser.password,
    hashPassword: password => bcrypt.hash(password, 10),
    deliver: async mail => { sent.push(mail); if (failMail) throw new Error('secret delivery details') },
    enqueue: async args => queued.push(args)
  })
  const issue = async (email = 'member@example.org') => { await recovery.send({ email }); return new URL(sent.at(-1).templateData.login_url).hash.slice(1) }
  const complete = (token, extra = {}) => recovery.complete({ token, password: 'replacement-password', confirmation: 'replacement-password', ip: '192.0.2.2', ...extra })
  const hash = async (id = 1) => (await knex('linked_account').where({ user_id: id, provider_key: 'password' }).first()).provider_user_id

  await t.test('unknown, inactive and unverified accounts have the same queued request behavior', async () => {
    for (const email of [' MEMBER@example.org ', 'missing@example.org', 'inactive@example.org', 'unverified@example.org']) await recovery.request({ email, ip: '192.0.2.1' })
    assert.equal(queued.length, 4)
    assert.equal(queued[0].email, 'member@example.org')
    for (const job of queued) await recovery.send(job)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].locale, 'de')
    for (let n = 0; n < 5; n++) await recovery.request({ email: 'member@example.org', ip: '192.0.2.1' })
    assert.equal(queued.filter(job => job.email === 'member@example.org').length, 3)
  })
  await t.test('only token digests are stored; fragments never provide general login JWTs', async () => {
    const token = await issue()
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.doesNotMatch(token, /\./)
    const key = ns + tokenKey(token)
    assert.ok((await rawRedis.ttl(key)) <= ttl)
    assert.ok((await rawRedis.ttl(key)) > 0)
    assert.doesNotMatch(await rawRedis.get(key), new RegExp(token))
    assert.equal(new URL(sent.at(-1).templateData.login_url).search, '')
    await assert.rejects(complete(token, { confirmation: 'does-not-match' }), /RECOVERY_PASSWORD_INVALID/)
    assert.ok(await rawRedis.get(key), 'invalid password must not consume the link')
    await rawRedis.pexpire(key, 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    await assert.rejects(complete(token), /RECOVERY_UNAVAILABLE/)
    assert.equal(await bcrypt.compare(oldPassword, await hash()), true)
  })
  await t.test('parallel redemption has exactly one winner, invalidates sibling links and stored sessions', async () => {
    const first = await issue(); const sibling = await issue()
    await redis.set('sess:anon:old', JSON.stringify({ userId: '1' }))
    await redis.set('sess:1:known', JSON.stringify({ userId: 1 }))
    await redis.set('sess:2:other', JSON.stringify({ userId: '2' }))
    await knex('oidc_payloads').insert([
      { id: 'token', grant_id: 'grant-1', payload: { accountId: '1' } },
      { id: 'grant-child', grant_id: 'grant-1', payload: {} },
      { id: 'other-token', grant_id: 'grant-2', payload: { accountId: '2' } }
    ])
    const results = await Promise.allSettled([complete(first), complete(first), complete(sibling)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(await bcrypt.compare(oldPassword, await hash()), false)
    assert.equal(await bcrypt.compare('replacement-password', await hash()), true)
    assert.equal(await rawRedis.get(ns + 'sess:anon:old'), null)
    assert.equal(await rawRedis.get(ns + 'sess:1:known'), null)
    assert.ok(await rawRedis.get(ns + 'sess:2:other'))
    assert.deepEqual((await knex('oidc_payloads')).map(row => row.id), ['other-token'])
    await assert.rejects(complete(first), /RECOVERY_UNAVAILABLE/)
  })
  await t.test('purpose and embedded expiry are checked even if Redis retains a record', async () => {
    for (const patch of [{ purpose: 'email-verification' }, { expiresAt: 0 }]) {
      const token = await issue()
      const key = ns + tokenKey(token)
      const state = JSON.parse(await rawRedis.get(key))
      await rawRedis.set(key, JSON.stringify({ ...state, ...patch }), 'EX', ttl)
      await assert.rejects(complete(token), /RECOVERY_UNAVAILABLE/)
    }
  })
  await t.test('email, password and eligibility changes invalidate outstanding recovery links', async () => {
    for (const patch of [{ email: 'changed@example.org' }, { active: false }, { email_validated: false }]) {
      const token = await issue()
      await knex('users').where({ id: 1 }).update(patch)
      await assert.rejects(complete(token), /RECOVERY_UNAVAILABLE/)
      await knex('users').where({ id: 1 }).update({ email: 'member@example.org', active: true, email_validated: true })
    }
    const token = await issue()
    await knex('linked_account').where({ user_id: 1 }).update({ provider_user_id: await bcrypt.hash('changed-elsewhere', 10) })
    await assert.rejects(complete(token), /RECOVERY_UNAVAILABLE/)
  })
  await t.test('verified social accounts can create one recovery password; failed mail links are revoked', async () => {
    const token = await issue('social@example.org')
    await complete(token)
    assert.equal(await bcrypt.compare('replacement-password', await hash(4)), true)
    failMail = true
    await assert.rejects(issue(), error => error.message === 'RECOVERY_DELIVERY_FAILED' && !error.cause)
    const failed = new URL(sent.at(-1).templateData.login_url).hash.slice(1)
    assert.equal(await rawRedis.get(ns + tokenKey(failed)), null)
    failMail = false
  })
  await t.test('session storage failure rolls back the password and consumes the link safely', async () => {
    const token = await issue()
    const before = await hash()
    const scan = redis.scan
    redis.scan = async () => { throw new Error('synthetic outage') }
    await assert.rejects(complete(token), /synthetic outage/)
    redis.scan = scan
    assert.equal(await hash(), before)
    await assert.rejects(complete(token), /RECOVERY_UNAVAILABLE/)
  })
})
