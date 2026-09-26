const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const migration = backendRequire('./migrations/20260925120000_discussion_revisions.js')

test('discussion migration and bootstrap snapshot have identical columns and constraints', {
  skip: process.env.HYLO_SELF_HOSTING_INTEGRATION !== '1'
}, async t => {
  const schema = 'discussion_test_' + randomUUID().replaceAll('-', '')
  const fresh = schema + '_fresh'
  const db = backendRequire('knex')({ client: 'pg', connection: process.env.DATABASE_URL, searchPath: [schema], pool: { min: 0, max: 2 } })
  t.after(async () => {
    await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema])
    await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [fresh])
    await db.destroy()
  })
  for (const namespace of [schema, fresh]) {
    await db.raw('CREATE SCHEMA ??', [namespace])
    await db.raw('CREATE TABLE ??.users (id bigint PRIMARY KEY)', [namespace])
    await db.raw('CREATE TABLE ??.posts (id bigint PRIMARY KEY)', [namespace])
  }
  await migration.up(db)
  const dump = readFileSync(path.resolve(__dirname, '../../apps/backend/migrations/schema.sql'), 'utf8')
  const addition = dump.match(/CREATE TABLE public\.discussion_revisions \([\s\S]+?\n\);/)[0]
  await db.raw(addition.replaceAll('public.', fresh + '.'))
  async function structure (namespace) {
    const columns = await db('information_schema.columns')
      .select('column_name', 'data_type', 'is_nullable', 'column_default')
      .where({ table_schema: namespace, table_name: 'discussion_revisions' }).orderBy('ordinal_position')
    const constraints = await db.raw(`SELECT contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname=? AND r.relname='discussion_revisions' ORDER BY contype, definition`, [namespace])
    return { columns, constraints: constraints.rows.map(row => ({ ...row, definition: row.definition.replaceAll(fresh + '.', '').replaceAll(schema + '.', '') })) }
  }
  assert.deepEqual(await structure(schema), await structure(fresh))
})
