// Destructive release rehearsal, exclusively for the named disposable CI databases.
// The shell harness clones a fresh bootstrap before invoking this script.
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'))
const migrationName = '20260925120000_discussion_revisions.js'
const migration = backendRequire('./migrations/' + migrationName)
const decisionMigrationName = '20260926090000_decision_rounds.js'
const decisionMigration = backendRequire('./migrations/' + decisionMigrationName)
const decisions = require('./decision-release-fixture.cjs')
const { structure: decisionStructure } = require('./decision-schema.integration.cjs')
const userId = '8000000000001'
const postId = '8000000000002'
const commentId = '8000000000003'
const mediaId = '8000000000004'
const legacy = '<p>Original discussion with <a href="https://example.org/evidence">evidence</a>.</p>'
const revision = {
  post_id: postId,
  version: 1,
  author_id: userId,
  created_at: new Date('2026-09-25T12:00:00Z'),
  context: 'Preserved context',
  summary: 'Reviewed summary',
  open_questions: ['What evidence is still missing?'],
  summary_changed: true
}

async function structure (db) {
  const columns = await db('information_schema.columns')
    .select('column_name', 'data_type', 'is_nullable', 'column_default')
    .where({ table_schema: 'public', table_name: 'discussion_revisions' }).orderBy('ordinal_position')
  const constraints = await db.raw(`SELECT contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = 'public.discussion_revisions'::regclass
    ORDER BY contype, definition`)
  return { columns, constraints: constraints.rows }
}

async function verifyLegacy (db) {
  assert.deepEqual(await db('users').select('id', 'name', 'email', 'active').where('id', userId).first(), {
    id: userId, name: 'Release rehearsal author', email: 'release-rehearsal@example.org', active: true
  })
  assert.deepEqual(await db('posts').select('id', 'user_id', 'type', 'description', 'is_public').where('id', postId).first(), {
    id: postId, user_id: userId, type: 'discussion', description: legacy, is_public: false
  })
  assert.deepEqual(await db('comments').select('id', 'post_id', 'user_id', 'text').where('id', commentId).first(), {
    id: commentId, post_id: postId, user_id: userId, text: 'An existing linked comment'
  })
  assert.deepEqual(await db('media').select('id', 'post_id', 'url', 'type').where('id', mediaId).first(), {
    id: mediaId, post_id: postId, url: 'https://example.org/diagram.png', type: 'image'
  })
  assert.deepEqual(await db('external_oidc_identities').select('issuer', 'subject', 'user_id').where('user_id', userId).first(), {
    issuer: 'https://identity.example.org', subject: 'release-rehearsal-subject', user_id: userId
  })
}

async function main () {
  assert.equal(process.env.HYLO_SELF_HOSTING_INTEGRATION, '1')
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['/hylo_ci_upgrade', '/hylo_ci_restore'].includes(url.pathname), 'Only disposable release-rehearsal databases are allowed')
  const db = backendRequire('knex')({ client: 'pg', connection: url.href, pool: { min: 0, max: 2 } })
  const command = process.argv[2]
  try {
    const privileges = await db.raw('SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user')
    assert.deepEqual(privileges.rows, [{ name: 'hylo', rolsuper: false }])
    const owner = await db.raw("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'posts'")
    assert.equal(owner.rows[0].tableowner, 'hylo')
    if (command === 'baseline') {
      assert.equal(url.pathname, '/hylo_ci_upgrade')
      assert.equal((await db('discussion_revisions').count('* as count').first()).count, '0')
      assert.ok(await db('knex_migrations').where('name', migrationName).first())
      // Reconstruct the previous Docker release, which has external identities
      // but no revision table. Never execute this on an operator database.
      await db.transaction(async trx => {
        assert.equal((await trx('decision_rounds').count('* as count').first()).count, '0')
        await decisionMigration.down(trx)
        await trx('knex_migrations').where('name', decisionMigrationName).del()
        await migration.down(trx)
        await trx('knex_migrations').where('name', migrationName).del()
        await trx('users').insert({ id: userId, name: 'Release rehearsal author', email: 'release-rehearsal@example.org', active: true })
        await trx('posts').insert({ id: postId, user_id: userId, name: 'Existing discussion', type: 'discussion', description: legacy, active: true, is_public: false })
        await trx('comments').insert({ id: commentId, post_id: postId, user_id: userId, text: 'An existing linked comment', active: true })
        await trx('media').insert({ id: mediaId, post_id: postId, url: 'https://example.org/diagram.png', type: 'image' })
        await trx('external_oidc_identities').insert({ issuer: 'https://identity.example.org', subject: 'release-rehearsal-subject', user_id: userId })
      })
    } else if (command === 'write-revision') {
      await verifyLegacy(db)
      await db('discussion_revisions').insert({ ...revision, open_questions: JSON.stringify(revision.open_questions) })
      await decisions.write(db)
    } else if (command === 'verify-revision') {
      await verifyLegacy(db)
      await decisions.verify(db)
      assert.equal((await db('knex_migrations').where('name', decisionMigrationName)).length, 1)
      assert.deepEqual(await db('discussion_revisions').where({ post_id: postId, version: 1 }).first(), revision)
      assert.equal((await db('knex_migrations').where('name', migrationName)).length, 1)
      const freshUrl = new URL(url.href)
      freshUrl.pathname = '/hylo'
      const fresh = backendRequire('knex')({ client: 'pg', connection: freshUrl.href, pool: { min: 0, max: 1 } })
      try {
        assert.deepEqual(await decisionStructure(db), await decisionStructure(fresh), 'Decision schema must survive upgrade and restore')
        assert.deepEqual(await structure(db), await structure(fresh), 'Upgraded/restored structure must match fresh bootstrap')
      } finally { await fresh.destroy() }
    } else if (command === 'verify-baseline') {
      await verifyLegacy(db)
      assert.equal(await db.schema.hasTable('decision_rounds'), false)
      assert.equal((await db('knex_migrations').where('name', decisionMigrationName)).length, 0)
      assert.equal(await db.schema.hasTable('discussion_revisions'), false)
      assert.equal((await db('knex_migrations').where('name', migrationName)).length, 0)
    } else throw new Error('Unknown rehearsal command')
    console.log('Discussion release rehearsal passed: ' + command)
  } finally { await db.destroy() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
