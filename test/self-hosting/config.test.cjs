const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const backend = path.resolve(__dirname, '../../apps/backend')

function evaluate (source, overrides = {}) {
  const env = { ...process.env, DATABASE_URL: 'postgresql://app:p%40ss@db:5432/hylo' }
  delete env.CORS_ALLOWED_ORIGINS
  delete env.HYLO_DATABASE_SSL
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: backend,
    env: { ...env, ...overrides },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('production database TLS stays enabled by default; private DB opt-out preserves URL parsing', () => {
  const source = "console.log(JSON.stringify(require('./knexfile')))"
  const defaults = evaluate(source)
  assert.deepEqual(defaults.production.connection.ssl, { rejectUnauthorized: false })
  assert.equal(defaults.development.connection.ssl, undefined)
  const configured = evaluate(source, { HYLO_DATABASE_SSL: 'false' })
  assert.deepEqual(configured.production.connection, {
    ssl: false, host: 'db', port: '5432', user: 'app', password: 'p@ss', database: 'hylo'
  })
  assert.equal(configured.development.connection.ssl, undefined)
  assert.deepEqual(evaluate(source, { HYLO_DATABASE_SSL: 'true' }).production.connection.ssl, defaults.production.connection.ssl)
})

test('HTTP, GraphQL and production sockets accept the same custom browser origins', () => {
  const result = evaluate(`
    const cors = require('./config/corsAllowedOrigins')
    const allowed = origin => { let value; cors.graphqlCorsOrigin(origin, (err, ok) => { if (err) throw err; value = ok }); return value }
    console.log(JSON.stringify({
      http: cors.hyloCorsAllowOriginsCommaSeparated().split(','),
      sockets: require('./config/env/production').sockets.onlyAllowOrigins,
      custom: allowed('https://hylo.example.org'),
      unknown: allowed('https://untrusted.example.org'),
      missing: allowed(undefined),
      upstream: allowed('https://www.hylo.com')
    }))
  `, { CORS_ALLOWED_ORIGINS: ' https://hylo.example.org, ,https://hylo.example.org ' })
  assert.deepEqual(result.http, result.sockets)
  assert.equal(result.http.filter(x => x === 'https://hylo.example.org').length, 1)
  assert.equal(result.custom, true)
  assert.equal(result.unknown, false)
  assert.equal(result.missing, true)
  assert.equal(result.upstream, true)
})

test('an unconfigured custom origin is rejected by GraphQL and sockets', () => {
  const result = evaluate(`
    const cors = require('./config/corsAllowedOrigins')
    cors.graphqlCorsOrigin('https://hylo.example.org', (err, allowed) => {
      if (err) throw err
      console.log(JSON.stringify({ allowed, sockets: require('./config/env/production').sockets.onlyAllowOrigins }))
    })
  `)
  assert.equal(result.allowed, false)
  assert.equal(result.sockets.includes('https://hylo.example.org'), false)
})
