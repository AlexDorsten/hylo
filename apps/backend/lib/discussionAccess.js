import { GraphQLError } from 'graphql'

// Discussion authorization is evaluated from current rows. Following a post,
// an old role assignment or a joined socket room is never a membership grant.
export function discussionMemberGroups (userId, db = bookshelf.knex) {
  return db('group_memberships as discussion_member')
    .join('groups as discussion_group', 'discussion_group.id', 'discussion_member.group_id')
    .join('users as discussion_user', 'discussion_user.id', 'discussion_member.user_id')
    .where({ 'discussion_member.user_id': userId, 'discussion_member.active': true, 'discussion_group.active': true, 'discussion_user.active': true })
    .select('discussion_group.id')
}

export function discussionModeratorGroups (userId, db = bookshelf.knex) {
  const scopes = db('group_memberships_group_roles as assignment')
    .join('groups_roles as role', function () {
      this.on('role.id', 'assignment.group_role_id').andOn('role.group_id', 'assignment.group_id')
    })
    .join('group_roles_responsibilities as link', 'link.group_role_id', 'role.id')
    .join('responsibilities as responsibility', 'responsibility.id', 'link.responsibility_id')
    .where({ 'assignment.user_id': userId, 'assignment.active': true, 'role.active': true, 'responsibility.type': 'system' })
    .whereIn('responsibility.title', ['Administration', 'Manage Content'])
    .whereIn('assignment.group_id', discussionMemberGroups(userId, db))
    .select('assignment.group_id')
  return db('groups as moderated_group').where('moderated_group.active', true)
    .whereIn(db.raw('coalesce(moderated_group.parent_id, moderated_group.id)'), scopes)
    .select('moderated_group.id')
}

export function discussionGroupIds (userId, db = bookshelf.knex) {
  return db('groups as accessible_group').select('accessible_group.id').where(q => {
    q.whereIn('accessible_group.id', discussionMemberGroups(userId, db))
      .orWhereIn('accessible_group.id', discussionModeratorGroups(userId, db))
  })
}

export function readableDiscussionIds (userId, db = bookshelf.knex, { memberOnly = false, editing = false } = {}) {
  const query = db('posts as discussion_post').select('discussion_post.id')
    .where({ 'discussion_post.active': true, 'discussion_post.type': 'discussion' })
  if (!userId) return query.where('discussion_post.is_public', true).whereRaw(memberOnly || editing ? 'false' : 'true')
  query.whereExists(db('users as discussion_reader').select('discussion_reader.id').where({ 'discussion_reader.id': userId, 'discussion_reader.active': true }))
  const linkedPosts = groups => db('groups_posts as discussion_link').select('discussion_link.post_id').whereIn('discussion_link.group_id', groups)
  query.where(q => {
    q.whereIn('discussion_post.id', linkedPosts(discussionGroupIds(userId, db)))
    if (!memberOnly && !editing) q.orWhere('discussion_post.is_public', true)
  })
  if (editing) {
    query.where(q => {
      q.where('discussion_post.user_id', userId)
        .orWhereIn('discussion_post.id', linkedPosts(discussionModeratorGroups(userId, db)))
    })
  }
  return query
}

// Add to queries already selecting posts, without changing other post types.
export function restrictDiscussionAccess (query, userId, postTable = 'posts', db = bookshelf.knex) {
  return query.where(q => q.whereNull(`${postTable}.type`).orWhere(`${postTable}.type`, '!=', 'discussion')
    .orWhereIn(`${postTable}.id`, readableDiscussionIds(userId, db)))
}

export async function canAccessDiscussion (userId, postId, options = {}) {
  const db = options.db || bookshelf.knex
  return !!await readableDiscussionIds(userId, db, options).where('discussion_post.id', postId).first()
}

export async function assertDiscussionPermission (userId, post, options = {}) {
  if (post?.get('type') === 'discussion' && !await canAccessDiscussion(userId, post.id, options)) {
    throw new GraphQLError("You don't have permission to access or modify this discussion")
  }
}

export async function canModerateDiscussion (userId, postId, groupId) {
  const query = bookshelf.knex('groups_posts').where('post_id', postId)
    .whereIn('group_id', discussionModeratorGroups(userId))
  if (groupId) query.where('group_id', groupId)
  return !!await query.first()
}

export function accessibleActivityIds (userId, db = bookshelf.knex) {
  const visiblePosts = db('posts').where('posts.active', true).select('posts.id')
  restrictDiscussionAccess(visiblePosts, userId, 'posts', db)
  const visibleComments = db('comments').where('comments.active', true).select('comments.id')
    .whereIn('comments.post_id', visiblePosts.clone())
  return db('activities').select('activities.id').where('activities.reader_id', userId || null)
    .whereExists(db('users').where({ 'users.id': userId || null, 'users.active': true }).select('users.id'))
    .where(q => q.whereNull('activities.post_id').orWhereIn('activities.post_id', visiblePosts))
    .where(q => q.whereNull('activities.comment_id').orWhereIn('activities.comment_id', visibleComments))
}
