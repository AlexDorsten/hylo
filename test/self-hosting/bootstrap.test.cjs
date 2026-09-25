const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync, mkdtempSync, copyFileSync, readdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { applicationSchema, verifySchemaSnapshot } = require('../../deploy/docker/bootstrap.cjs')

test('the repository schema can be loaded by an application role with preinstalled extensions', () => {
  const source = readFileSync(path.resolve(__dirname, '../../apps/backend/migrations/schema.sql'), 'utf8')
  const sql = applicationSchema(source)
  assert.doesNotMatch(sql, /^CREATE EXTENSION|^COMMENT ON EXTENSION|^\\/m)
  assert.match(sql, /CREATE TABLE public.users/)
  assert.match(sql, /CREATE FUNCTION public\./)
  assert.throws(() => applicationSchema(source + '\nCREATE EXTENSION example;\n'), /declarations changed/)
  assert.throws(() => applicationSchema(source.replace('WITH SCHEMA public;', 'WITH SCHEMA other;')), /declarations changed/)
})

test('fresh bootstrap refuses snapshot drift instead of marking unapplied migrations complete', () => {
  const sourceDirectory = path.resolve(__dirname, '../../apps/backend/migrations')
  const dump = readFileSync(path.join(sourceDirectory, 'schema.sql'), 'utf8')
  const snapshot = require('../../deploy/docker/schema-snapshot.json')
  const directory = mkdtempSync(path.join(tmpdir(), 'hylo-schema-'))
  try {
    for (const name of readdirSync(sourceDirectory).filter(name => name.endsWith('.js'))) {
      copyFileSync(path.join(sourceDirectory, name), path.join(directory, name))
    }
    assert.doesNotThrow(() => verifySchemaSnapshot(dump, directory, snapshot))
    assert.throws(() => verifySchemaSnapshot(dump + '\n-- changed\n', directory, snapshot), /alignment/)
    const added = path.join(directory, '20990101000000_new_migration.js')
    writeFileSync(added, 'exports.up = () => {}\n')
    assert.throws(() => verifySchemaSnapshot(dump, directory, snapshot), /alignment/)
    rmSync(added)
    const existing = readdirSync(directory)[0]
    writeFileSync(path.join(directory, existing), 'exports.up = () => {}\n')
    assert.throws(() => verifySchemaSnapshot(dump, directory, snapshot), /alignment/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
