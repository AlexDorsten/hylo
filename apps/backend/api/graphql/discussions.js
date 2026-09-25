import { GraphQLError } from 'graphql'
import { JSDOM } from 'jsdom'
import { canAccessDiscussion } from '../../lib/discussionAccess'

const fail = code => { throw new GraphQLError(code, { extensions: { code } }) }
const denied = () => fail('DISCUSSION_ACCESS_DENIED')

// The overview/history remain member-only, even on a public discussion.
async function access (db, userId, postId, editing = false) {
  if (!userId || !/^\d+$/.test(String(postId))) denied()
  const postQuery = db('posts').where({ id: postId, active: true, type: 'discussion' })
  const post = await (editing ? postQuery.forUpdate() : postQuery).first()
  if (!post || !await canAccessDiscussion(userId, postId, { db, memberOnly: true, editing })) denied()
  const canEdit = editing || await canAccessDiscussion(userId, postId, { db, editing: true })
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
