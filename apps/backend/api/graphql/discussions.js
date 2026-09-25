import { GraphQLError } from 'graphql'
import { JSDOM } from 'jsdom'

const fail = code => { throw new GraphQLError(code, { extensions: { code } }) }
const denied = () => fail('DISCUSSION_ACCESS_DENIED')

// Do not use Post.isVisibleToUser: following a private post can survive leaving
// its group. Every read (including history) checks current membership instead.
async function access (db, userId, postId, editing = false) {
  if (!userId || !/^\d+$/.test(String(postId))) denied()
  const postQuery = db('posts').where({ id: postId, active: true, type: 'discussion' })
  const post = await (editing ? postQuery.forUpdate() : postQuery).first()
  if (!post || !await db('users').where({ id: userId, active: true }).first()) denied()
  const groups = await db('groups').where({ active: true })
    .whereIn('id', db('groups_posts').select('group_id').where('post_id', postId))
  const scopes = groups.map(group => String(group.parent_id || group.id))
  const memberships = await db('group_memberships')
    .join('groups as membership_group', 'membership_group.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.active': true, 'membership_group.active': true })
    .whereIn('group_memberships.group_id', [...groups.map(group => String(group.id)), ...scopes])
    .select('group_memberships.group_id')
  const memberIds = memberships.map(member => String(member.group_id))
  const roles = await db('group_memberships_group_roles as assignment')
    .join('groups_roles as role', 'role.id', 'assignment.group_role_id')
    .join('group_roles_responsibilities as link', 'link.group_role_id', 'assignment.group_role_id')
    .join('responsibilities as responsibility', 'responsibility.id', 'link.responsibility_id')
    .where({ 'assignment.user_id': userId, 'assignment.active': true, 'role.active': true, 'responsibility.type': 'system' })
    .whereIn('assignment.group_id', scopes.filter(id => memberIds.includes(id)))
    .whereIn('responsibility.title', ['Administration', 'Manage Content'])
    .select('assignment.group_id')
  const moderator = roles.length > 0
  if (!moderator && !groups.some(group => memberIds.includes(String(group.id)))) denied()
  const canEdit = moderator || String(post.user_id) === String(userId)
  if (editing && !canEdit) denied()
  return { post, canEdit }
}

// Import a readable starting point, retaining link destinations. The original
// rich text, attachments and comments remain on the post without modification.
export function legacyDiscussionContext (html) {
  const dom = new JSDOM(html || '')
  try {
    const doc = dom.window.document
    doc.querySelectorAll('script, style, iframe').forEach(node => node.remove())
    doc.querySelectorAll('a[href]').forEach(node => {
      node.append(` (${node.getAttribute('href')})`)
    })
    doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    doc.querySelectorAll('p, div, li, h1, h2, h3, blockquote').forEach(node => node.append('\n'))
    return doc.body.textContent.trim()
  } finally {
    dom.window.close()
  }
}

function revisions (db, postId) {
  return db('discussion_revisions as revision')
    .leftJoin('users as author', 'author.id', 'revision.author_id')
    .where('revision.post_id', postId)
    .select('revision.*', 'author.name as author_name')
    .orderBy('revision.version', 'desc')
}

function present (row) {
  return {
    version: row.version,
    context: row.context,
    summary: row.summary,
    openQuestions: row.open_questions,
    createdAt: row.created_at?.toISOString(),
    author: row.author_id ? { id: String(row.author_id), name: row.author_name } : null
  }
}

async function overview (db, post, canEdit) {
  const current = await revisions(db, post.id).first()
  // A concurrent save must not give an older overview a newer summary marker.
  const summary = current
    ? await revisions(db, post.id).where('summary_changed', true).where('revision.version', '<=', current.version).first()
    : null
  return {
    canEdit,
    current: current
      ? present(current)
      : {
          version: 0, context: legacyDiscussionContext(post.description), summary: '', openQuestions: []
        },
    lastSummary: summary ? present(summary) : null
  }
}

export async function discussionOverview (userId, { postId }) {
  const db = bookshelf.knex
  const { post, canEdit } = await access(db, userId, postId)
  return overview(db, post, canEdit)
}

export async function discussionHistory (userId, { postId, beforeVersion }) {
  const db = bookshelf.knex
  await access(db, userId, postId)
  const query = revisions(db, postId).limit(20)
  if (beforeVersion != null) query.where('revision.version', '<', beforeVersion)
  return (await query).map(present)
}

export async function updateDiscussion (userId, { postId, expectedVersion, context, summary, openQuestions }) {
  return bookshelf.knex.transaction(async db => {
    const { post, canEdit } = await access(db, userId, postId, true)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0 ||
      typeof context !== 'string' || context.length > 50000 ||
      typeof summary !== 'string' || summary.length > 20000 ||
      !Array.isArray(openQuestions) || openQuestions.length > 30 ||
      openQuestions.some(question => typeof question !== 'string' || !question.trim() || question.length > 1000)) {
      fail('DISCUSSION_INVALID_INPUT')
    }
    const previous = await db('discussion_revisions').where('post_id', postId).orderBy('version', 'desc').first()
    if ((previous?.version || 0) !== expectedVersion) fail('DISCUSSION_CONFLICT')
    const questions = openQuestions.map(question => question.trim())
    // An unchanged save does not create misleading history or summary markers.
    if (previous && previous.context === context && previous.summary === summary &&
      JSON.stringify(previous.open_questions) === JSON.stringify(questions)) return overview(db, post, canEdit)
    await db('discussion_revisions').insert({
      post_id: postId,
      version: expectedVersion + 1,
      author_id: userId,
      context,
      summary,
      open_questions: JSON.stringify(questions),
      summary_changed: summary !== (previous?.summary || '')
    })
    return overview(db, post, canEdit)
  })
}
