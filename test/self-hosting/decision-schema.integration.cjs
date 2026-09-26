const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const migration = backendRequire('./migrations/20260926090000_decision_rounds.js')

async function structure (db, namespace = 'public') {
  const result = await db.raw(`SELECT c.relname, c.relkind,
    (SELECT json_agg(x ORDER BY x.ordinal_position) FROM
      (SELECT column_name,data_type,is_nullable,column_default,ordinal_position FROM information_schema.columns
       WHERE table_schema=n.nspname AND table_name=c.relname) x) AS columns,
    (SELECT array_agg(pg_get_constraintdef(k.oid) ORDER BY k.contype,pg_get_constraintdef(k.oid)) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT array_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
    (SELECT array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=? AND c.relkind='r' AND c.relname LIKE 'decision_%' ORDER BY c.relname`, [namespace])
  return JSON.parse(JSON.stringify(result.rows).replaceAll(namespace + '.', ''))
}
exports.structure = structure

if (require.main === module) test('decision upgrade and fresh bootstrap agree on all five tables, constraints, indexes and immutability trigger', {
  skip: process.env.HYLO_SELF_HOSTING_INTEGRATION !== '1'
}, async t => {
  const schema = 'decision_test_' + randomUUID().replaceAll('-', '')
  const fresh = schema + '_fresh'
  const db = backendRequire('knex')({ client: 'pg', connection: process.env.DATABASE_URL, pool: { min: 0, max: 2 } })
  t.after(async () => {
    await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema])
    await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [fresh])
    await db.destroy()
  })
  for (const namespace of [schema, fresh]) {
    await db.raw('CREATE SCHEMA ??', [namespace])
    for (const table of ['posts', 'groups']) await db.raw('CREATE TABLE ??.?? (id bigint PRIMARY KEY)', [namespace, table])
  }
  await migration.up({ raw: sql => db.raw(sql.replaceAll('public.', schema + '.')) })
  const dump = readFileSync(path.resolve(__dirname, '../../apps/backend/migrations/schema.sql'), 'utf8')
  const addition = dump.match(/CREATE TABLE public\.decision_rounds \([\s\S]+?FOR EACH ROW EXECUTE FUNCTION public\.guard_decision_round\(\);/)[0]
  await db.raw(addition.replaceAll('public.', fresh + '.'))
  const upgraded = await structure(db, schema)
  assert.equal(upgraded.length, 5)
  assert.deepEqual(upgraded, await structure(db, fresh))
  const functionBody = async namespace => (await db.raw('SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=? AND proname=?', [namespace, 'guard_decision_round'])).rows
  assert.deepEqual(await functionBody(schema), await functionBody(fresh))
  await migration.down({ raw: sql => db.raw(sql.replaceAll('public.', schema + '.')) })
  assert.deepEqual(await structure(db, schema), [])
})
