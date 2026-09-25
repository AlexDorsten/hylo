const { createRequire } = require('node:module')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const backendRequire = createRequire(path.join(root, 'apps/backend/package.json'))

// Extensions are installed by the database administrator. The schema itself is
// owned by the application role. Reject unexpected dump changes for review.
function applicationSchema (dump) {
  const creates = dump.match(/^CREATE EXTENSION .*;$/gm) || []
  const comments = dump.match(/^COMMENT ON EXTENSION .*;$/gm) || []
  const names = ['pg_stat_statements', 'postgis', '"uuid-ossp"']
  if (creates.length !== 3 || comments.length !== 3 || !names.every(name =>
    creates.some(line => line.startsWith(`CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA public;`)) &&
    comments.some(line => line.startsWith(`COMMENT ON EXTENSION ${name} IS `))
  )) throw new Error('Schema extension declarations changed; review bootstrap before importing')
  return dump
    .replace(/^CREATE EXTENSION .*;\r?\n/gm, '')
    .replace(/^COMMENT ON EXTENSION .*;\r?\n/gm, '')
    // These psql client commands are not SQL; pg executes the trusted repo dump.
    .replace(/^\\(?:un)?restrict [^\r\n]+\r?\n/gm, '')
}

async function bootstrap () {
  if (process.env.NODE_ENV !== 'production') throw new Error('Bootstrap requires NODE_ENV=production')
  const { Client } = backendRequire('pg')
  const connection = backendRequire('./knexfile.js').production.connection
  const schema = applicationSchema(readFileSync(path.join(root, 'apps/backend/migrations/schema.sql'), 'utf8'))
  const client = new Client(connection)
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(78124391)')
    const existing = await client.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid AND d.deptype = 'e'
        )
    `)
    if (existing.rowCount) throw new Error('Refusing bootstrap: application relations already exist; use migrations for an existing installation')
    await client.query(schema)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }

  // Upstream seeds initialize reference data AND record the matching migrations.
  // They are destructive and must never be run again on an existing instance.
  const seeded = spawnSync('yarn', ['workspace', 'backend', 'knex', 'seed:run'], { cwd: root, stdio: 'inherit' })
  if (seeded.error) throw seeded.error
  if (seeded.status !== 0) throw new Error('Seeding failed; bootstrap will refuse a retry on this partial database. Inspect it before recovery.')
  console.log('Database initialized. Do not run bootstrap or default seeds on this database again.')
}

module.exports = { applicationSchema }
if (require.main === module) {
  bootstrap().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
