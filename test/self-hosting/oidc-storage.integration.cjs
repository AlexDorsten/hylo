// Run only against disposable services: creates isolated schemas and Redis keys.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const { resolveIdentity } = require('../../apps/backend/lib/oidcIdentity.cjs')
const { consumeScript, linkLimitScript } = require('../../apps/backend/lib/externalOidc.cjs')
const migration = require('../../apps/backend/migrations/20260925110000_external_oidc_identities.js')
const enabled = process.env.HYLO_SELF_HOSTING_INTEGRATION === '1'

test('PostgreSQL migration and fresh schema agree; identity ownership cannot be transferred', { skip: !enabled }, async t => {
  assert.ok(process.env.DATABASE_URL)
  const schema = 'oidc_test_' + randomUUID().replaceAll('-', '')
  const fresh = schema + '_fresh'
  const knex = backendRequire('knex')({ client: 'pg', connection: process.env.DATABASE_URL, searchPath: [schema], pool: { min: 0, max: 6 } })
  t.after(async () => {
    await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema])
    await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [fresh])
    await knex.destroy()
  })
  await knex.raw('CREATE SCHEMA ??', [schema])
  await knex.raw('CREATE SCHEMA ??', [fresh])
  for (const target of [schema, fresh]) await knex.raw('CREATE TABLE ??.users (id bigint PRIMARY KEY, active boolean NOT NULL, email_validated boolean NOT NULL)', [target])
  await knex.schema.createTable('linked_account', table => { table.bigInteger('user_id'); table.string('provider_key') })
  await migration.up(knex)
  const sql = fs.readFileSync(path.resolve(__dirname, '../../apps/backend/migrations/schema.sql'), 'utf8')
  const addition = sql.match(/CREATE TABLE public\.external_oidc_identities[\s\S]+?CREATE INDEX external_oidc_identities_user_id_index[^;]+;/)[0]
  await knex.raw(addition.replaceAll('public.', fresh + '.'))
  async function columns (namespace) {
    return knex('information_schema.columns').select('column_name', 'data_type', 'character_maximum_length', 'is_nullable').where({ table_schema: namespace, table_name: 'external_oidc_identities' }).orderBy('ordinal_position')
  }
  async function constraints (namespace) {
    const result = await knex.raw(`SELECT contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname=? AND r.relname='external_oidc_identities' ORDER BY contype`, [namespace])
    return result.rows.map(row => ({ ...row, definition: row.definition.replaceAll(fresh + '.', '').replaceAll(schema + '.', '') }))
  }
  assert.deepEqual(await columns(schema), await columns(fresh))
  assert.deepEqual(await constraints(schema), await constraints(fresh))
  await migration.down(knex)
  assert.equal(await knex.schema.hasTable('external_oidc_identities'), false)
  await migration.up(knex)
  await knex('users').insert([
    { id: 1, active: true, email_validated: true }, { id: 2, active: true, email_validated: true },
    { id: 3, active: false, email_validated: true }, { id: 4, active: true, email_validated: false }, { id: 5, active: true, email_validated: true }
  ])
  await knex('linked_account').insert([1, 2, 3, 4].map(userId => ({ user_id: userId, provider_key: 'password' })))
  const identity = { issuer: 'https://alpha.example.org', subject: 'same-subject' }
  await assert.rejects(resolveIdentity(knex, identity, null), /Identity unavailable/)
  for (const id of ['3', '4', '5']) await assert.rejects(resolveIdentity(knex, identity, id))
  const race = await Promise.allSettled(['1', '2'].map(id => resolveIdentity(knex, identity, id)))
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
  const owner = race.find(r => r.status === 'fulfilled').value
  const other = owner === '1' ? '2' : '1'
  assert.equal(await resolveIdentity(knex, identity, null), owner)
  assert.equal(await resolveIdentity(knex, identity, owner), owner)
  await assert.rejects(resolveIdentity(knex, identity, other), /Identity unavailable/)
  assert.equal(await resolveIdentity(knex, { ...identity, issuer: 'https://beta.example.org' }, other), other)
  await knex('users').where({ id: owner }).update({ active: false })
  await assert.rejects(resolveIdentity(knex, identity, null), /Account unavailable/)
  await knex('users').where({ id: owner }).del()
  assert.equal(await knex('external_oidc_identities').where({ user_id: owner }).first(), undefined)
})

test('real Redis atomically consumes callbacks and expires password-guess limits', { skip: !enabled }, async t => {
  assert.ok(process.env.REDIS_URL)
  const Redis = backendRequire('ioredis')
  const redis = new Redis(process.env.REDIS_URL)
  const key = 'oidc:integration:' + randomUUID()
  const limit = key + ':limit'
  t.after(async () => { await redis.del(key, limit); await redis.quit() })
  await redis.set(key, JSON.stringify({ state: 'expected', providerId: 'alpha' }), 'EX', 600)
  assert.equal(await redis.eval(consumeScript, 1, key, 'wrong', 'alpha'), null)
  assert.equal(await redis.eval(consumeScript, 1, key, 'expected', 'beta'), null)
  const results = await Promise.all(Array.from({ length: 8 }, () => redis.eval(consumeScript, 1, key, 'expected', 'alpha')))
  assert.equal(results.filter(Boolean).length, 1)
  const attempts = await Promise.all(Array.from({ length: 6 }, () => redis.eval(linkLimitScript, 1, limit)))
  assert.deepEqual(attempts, [1, 2, 3, 4, 5, 6])
  assert.ok(await redis.ttl(limit) > 0)
  assert.ok(await redis.ttl(limit) <= 600)
})
