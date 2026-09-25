const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const { findOperator } = require('../../deploy/docker/operator.cjs')

test('operator lookup only accepts a unique verified active local password account and never changes grants', { skip: process.env.HYLO_SELF_HOSTING_INTEGRATION !== '1' }, async t => {
  const administratorsBefore = process.env.HYLO_ADMINS
  const schema = 'operator_test_' + randomUUID().replaceAll('-', '')
  const knex = backendRequire('knex')({ client: 'pg', connection: process.env.DATABASE_URL, searchPath: [schema], pool: { min: 0, max: 1 } })
  t.after(async () => { await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]); await knex.destroy() })
  await knex.raw('CREATE SCHEMA ??', [schema])
  await knex.schema.createTable('users', table => { table.bigInteger('id').primary(); table.string('email'); table.boolean('active'); table.boolean('email_validated') })
  await knex.schema.createTable('linked_account', table => { table.increments('id'); table.bigInteger('user_id'); table.string('provider_key'); table.string('provider_user_id') })
  const rows = [
    { id: '9007199254740993', email: 'operator@example.org', active: true, email_validated: true },
    { id: '2', email: 'inactive@example.org', active: false, email_validated: true },
    { id: '3', email: 'unverified@example.org', active: true, email_validated: false },
    { id: '4', email: 'social@example.org', active: true, email_validated: true },
    { id: '13986', email: 'helper@example.org', active: true, email_validated: true }
  ]
  await knex('users').insert(rows)
  await knex('linked_account').insert(rows.filter(row => row.id !== '4').map(row => ({ user_id: row.id, provider_key: 'password', provider_user_id: 'synthetic-test-hash' })))
  assert.equal(await findOperator(knex, ' OPERATOR@example.org '), '9007199254740993')
  for (const email of ['inactive@example.org', 'unverified@example.org', 'social@example.org', 'helper@example.org', 'missing@example.org', "x' OR 1=1 --"]) await assert.rejects(findOperator(knex, email))
  await knex('users').insert({ ...rows[0], id: '5', email: 'OPERATOR@example.org' })
  await assert.rejects(findOperator(knex, 'operator@example.org'), /exactly one/)
  assert.equal(await knex('users').count('* AS count').first().then(row => Number(row.count)), 6)
  assert.equal(process.env.HYLO_ADMINS, administratorsBefore)
})
