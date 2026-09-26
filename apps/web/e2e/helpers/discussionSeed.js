import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const requireBackend = createRequire(new URL('../../../backend/package.json', import.meta.url))
const { Client } = requireBackend('pg')

export async function withDatabase (run) {
  const url = process.env.E2E_DATABASE_URL
  if (process.env.E2E_ISOLATED !== '1' || !url || !new URL(url).pathname.includes('e2e')) {
    throw new Error('Discussion fixtures require a dedicated isolated E2E database')
  }
  const client = new Client({ connectionString: url, ssl: false })
  await client.connect()
  try { return await run(client) } finally { await client.end() }
}

export function seedDiscussion () {
  return withDatabase(async client => {
    const suffix = randomUUID().slice(0, 8)
    const slug = `e2e-discussion-${suffix}`
    const email = `discussion-${suffix}@hylo.test`
    const author = (await client.query("SELECT id FROM users WHERE email = 'e2e.user@hylo.test'")).rows[0]
    const member = (await client.query(`
      INSERT INTO users (email, name, first_name, last_name, active, email_validated, created_at, updated_at, settings)
      VALUES ($1, 'Late Participant', 'Late', 'Participant', true, true, now(), now(), '{"locale":"en"}') RETURNING id
    `, [email])).rows[0]
    await client.query(`INSERT INTO linked_account (user_id, provider_user_id, provider_key)
      SELECT $1, provider_user_id, provider_key FROM linked_account WHERE user_id = $2 AND provider_key = 'password'`, [member.id, author.id])
    const group = (await client.query(`
      INSERT INTO groups (name, slug, description, active, visibility, accessibility, created_by_id, settings, num_members, created_at, updated_at)
      VALUES ('Discussion Workshop', $1, 'Synthetic private discussion fixture', true, 0, 0, $2, '{}', 2, now(), now()) RETURNING id
    `, [slug, author.id])).rows[0]
    const settings = JSON.stringify({ lastReadAt: new Date().toISOString(), showJoinForm: false, joinQuestionsAnsweredAt: new Date().toISOString(), agreementsAcceptedAt: new Date().toISOString() })
    for (const userId of [author.id, member.id]) {
      await client.query('INSERT INTO group_memberships (group_id, user_id, active, settings, created_at, updated_at) VALUES ($1, $2, true, $3, now(), now())', [group.id, userId, settings])
    }
    const post = (await client.query(`
      INSERT INTO posts (name, description, type, user_id, active, visibility, is_public, created_at, updated_at, num_comments)
      VALUES ('A community workshop', '<p>Original workshop context. <a href="https://example.org/evidence">Original evidence</a></p>', 'discussion', $1, true, 0, false, now(), now(), 0) RETURNING id
    `, [author.id])).rows[0]
    await client.query('INSERT INTO groups_posts (group_id, post_id) VALUES ($1, $2)', [group.id, post.id])
    return { postId: String(post.id), groupId: String(group.id), memberId: String(member.id), email, slug }
  })
}

export function revokeDiscussionMember ({ groupId, memberId }) {
  return withDatabase(client => client.query('UPDATE group_memberships SET active = false WHERE group_id = $1 AND user_id = $2', [groupId, memberId]))
}
