// Read-only: resolve a deliberately registered account; never promote seed data.
const { createRequire } = require('node:module')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))

async function findOperator (knex, email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 255) throw new Error('Invalid email address')
  const users = await knex('users').select('id', 'active', 'email_validated')
    .whereRaw('lower(email) = ?', [email.trim().toLowerCase()]).limit(2)
  if (users.length !== 1) throw new Error('Expected exactly one registered account')
  const user = users[0]
  if (String(user.id) === '13986' || !user.active || !user.email_validated) throw new Error('Account must be active, verified and not the seed helper')
  const password = await knex('linked_account').select('id')
    .where({ user_id: user.id, provider_key: 'password' }).whereNotNull('provider_user_id').whereNot('provider_user_id', '').first()
  if (!password) throw new Error('Complete local password registration first')
  return String(user.id)
}

async function main () {
  const readline = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stderr })
  let email
  try { email = await readline.question('Verified local account email: ') } finally { readline.close() }
  const connection = backendRequire('./knexfile.js').production.connection
  const knex = backendRequire('knex')({ client: 'pg', connection, pool: { min: 0, max: 1 } })
  try {
    const id = await findOperator(knex, email)
    console.log(`HYLO_ADMINS=${id}`)
    console.error('No permissions changed. Add this ID to private backend.env and recreate the API and worker. Preserve any existing administrator IDs.')
  } finally { await knex.destroy() }
}

module.exports = { findOperator }
if (require.main === module) {
  main().catch(() => {
  // Do not print driver errors, connection strings or user input.
    console.error('Operator lookup failed. Check the private database configuration and ensure a unique, active, email-verified local password account exists (excluding seed data).')
    process.exitCode = 1
  })
}
