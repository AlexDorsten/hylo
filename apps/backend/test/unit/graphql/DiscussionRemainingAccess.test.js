import { graphql } from 'graphql'
import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import makeSchema from '../../../api/graphql/makeSchema'
import { canDeleteComment } from '../../../api/graphql/mutations/comment'
import { savePost } from '../../../api/graphql/mutations/savePost'
import updatePost from '../../../api/models/post/updatePost'
import { reactOn, deleteReaction } from '../../../api/graphql/mutations'
import { deletePost } from '../../../api/graphql/mutations/post'
import checkAndSetPost from '../../../api/policies/checkAndSetPost'
import * as Websockets from '../../../api/services/Websockets'

describe('Persisted discussion access and inherited moderation', () => {
  let author, member, outsider, group, post, comment, activity, notification, schema
  const revoke = () => bookshelf.knex('group_memberships').where({ group_id: group.id, user_id: member.id }).update({ active: false })
  const execute = async (user, source, reuseSchema = false) => graphql({
    schema: reuseSchema ? schema : await makeSchema({ req: { session: { userId: user.id } } }),
    source,
    contextValue: { currentUserId: user.id, request: { headers: new Headers() } }
  })
  const notifications = '{ notifications(first: 1) { total hasMore items { id activity { id post { id details } comment { id text } } } } }'

  beforeEach(async () => {
    await setup.clearDb()
    mockify(Queue, 'classMethod', () => Promise.resolve())
    author = await factories.user().save()
    member = await factories.user().save()
    outsider = await factories.user().save()
    group = await factories.group({ visibility: 0, active: true }).save()
    for (const user of [author, member]) await user.joinGroup(group)
    post = await factories.post({ user_id: author.id, type: 'discussion', name: 'Quokka workshop', description: 'Private context', is_public: false }).save()
    await post.groups().attach(group.id)
    comment = await factories.comment({ post_id: post.id, user_id: member.id, text: 'Private contribution' }).save()
    activity = await new Activity({ reader_id: member.id, actor_id: author.id, post_id: post.id, comment_id: comment.id, meta: { reasons: ['newComment'] }, unread: true }).save()
    notification = await factories.notification({ user_id: member.id, activity_id: activity.id, medium: Notification.MEDIUM.InApp }).save()
    schema = await makeSchema({ req: { session: { userId: member.id } } })
  })
  afterEach(() => unspyify(Queue, 'classMethod'))

  it('filters revoked notifications before pagination, retaining unrelated activity', async () => {
    const other = await new Activity({ reader_id: member.id, actor_id: author.id, meta: { reasons: ['newComment'] } }).save()
    const retained = await factories.notification({ user_id: member.id, activity_id: other.id, medium: Notification.MEDIUM.InApp }).save()
    // The inaccessible notification comes first in the requested order.
    const source = notifications.replace('first: 1', 'first: 1, order: "asc"')
    expect((await execute(member, source, true)).data.notifications.items[0].id).to.equal(String(notification.id))
    await revoke()
    const result = await execute(member, source, true)
    expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
    expect(result.data.notifications).to.deep.equal({ total: 1, hasMore: false, items: [{ id: String(retained.id), activity: { id: String(other.id), post: null, comment: null } }] })
  })

  for (const change of ['post', 'comment', 'user', 'group']) {
    it(`hides persisted notifications after ${change} deactivation`, async () => {
      expect((await execute(member, notifications, true)).data.notifications.total).to.equal(1)
      const model = { post, comment, user: member, group }[change]
      await model.save({ active: false })
      const result = await execute(member, notifications, true)
      expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
      expect(result.data.notifications.total).to.equal(0)
    })
  }

  it('limits direct activities to their current authorized recipient', async () => {
    const source = `{ activity(id: "${activity.id}") { id post { details } comment { text } } }`
    expect((await execute(member, source, true)).data.activity.post.details).to.equal('Private context')
    expect((await execute(outsider, source)).data.activity).to.equal(null)
    await revoke()
    expect((await execute(member, source, true)).data.activity).to.equal(null)
    const marked = await execute(member, `mutation { markActivityRead(id: "${activity.id}") { id post { details } } }`)
    expect(marked.errors, JSON.stringify(marked.errors)).to.equal(undefined)
    expect(marked.data.markActivityRead).to.equal(null)
    expect((await Activity.find(activity.id)).get('unread')).to.equal(true)
  })

  it('does not reuse stale nested post/comment content from a cached schema', async () => {
    await execute(member, notifications, true)
    await post.save({ description: 'Updated context' })
    await comment.save({ text: 'Updated contribution' })
    const result = await execute(member, notifications, true)
    expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
    expect(result.data.notifications.items[0].activity.post.details).to.equal('Updated context')
    expect(result.data.notifications.items[0].activity.comment.text).to.equal('Updated contribution')
  })

  it('revokes comment deletion and bookmarking, even for retained authorship', async () => {
    expect(await canDeleteComment(member.id, comment)).to.equal(true)
    await revoke()
    expect(await canDeleteComment(member.id, comment)).to.equal(false)
    await expect(savePost(member.id, post.id)).to.be.rejectedWith('Post not found')
    expect(await PostUser.find(post.id, member.id)).to.equal(null)
  })

  it('does not let ordinary members replace another author’s discussion', async () => {
    await expect(updatePost(member.id, post.id, { name: 'Overwritten', description: 'Changed' })).to.be.rejectedWith('permission')
    expect((await Post.find(post.id)).get('name')).to.equal('Quokka workshop')
  })

  it('revokes editing and deletion even when the removed member authored the post', async () => {
    await post.save({ user_id: member.id })
    await revoke()
    await expect(updatePost(member.id, post.id, { name: 'Overwritten' })).to.be.rejectedWith('permission')
    await expect(deletePost(member.id, post.id)).to.be.rejectedWith('permission')
    expect((await Post.find(post.id)).get('name')).to.equal('Quokka workshop')
  })

  for (const entityType of ['post', 'comment']) {
    for (const mutation of ['reactOn', 'deleteReaction']) {
      it(`denies ${mutation} on a revoked ${entityType}`, async () => {
        await revoke()
        const result = await execute(member, `mutation { ${mutation}(entityId: "${entityType === 'post' ? post.id : comment.id}", data: { entityType: "${entityType}", emojiFull: "heart" }) { id details } }`)
        expect(result.errors?.[0]?.message).to.include('permission')
        expect(result.data?.[mutation]).to.equal(null)
      })
    }
  }

  for (const inactiveSource of ['post', 'comment']) {
    for (const mutation of ['reactOn', 'deleteReaction']) {
      it(`denies ${mutation} on a comment with an inactive ${inactiveSource}`, async () => {
        await ({ post, comment }[inactiveSource]).save({ active: false })
        const result = await execute(member, `mutation { ${mutation}(entityId: "${comment.id}", data: { entityType: "comment", emojiFull: "heart" }) { id details } }`)
        expect(result.errors?.[0]?.message).to.equal('Content not found')
        expect(result.data?.[mutation]).to.equal(null)
      })
    }
  }

  it('preserves reactions and author deletion for private message threads', async () => {
    const thread = await factories.post({ type: 'thread', is_public: false }).save()
    await factories.postUser({ post_id: thread.id, user_id: member.id }).save()
    const message = await factories.comment({ post_id: thread.id, user_id: member.id, text: 'Private message' }).save()
    await reactOn(member.id, message.id, { entityType: 'comment', emojiFull: 'heart' })
    expect((await message.reactions().fetch()).length).to.equal(1)
    await deleteReaction(member.id, message.id, { entityType: 'comment', emojiFull: 'heart' })
    expect((await message.reactions().fetch()).length).to.equal(0)
    expect(await canDeleteComment(member.id, message)).to.equal(true)
  })

  it('rejects a stored notification assigned to a different activity recipient', async () => {
    await notification.save({ user_id: outsider.id })
    expect(await notification.hasCurrentDiscussionAccess()).to.equal(false)
    expect(await notification.hasCurrentDiscussionAccess(member.id)).to.equal(false)
  })

  it('does not use a site administrator session as private discussion membership', async () => {
    const outcomes = []
    mockify(Admin, 'isSignedIn', () => true)
    try {
      await checkAndSetPost({ param: () => post.id, session: { userId: outsider.id } }, {
        locals: {}, forbidden: () => outcomes.push('denied'), serverError: error => { throw error }
      }, () => outcomes.push('allowed'))
      expect(outcomes).to.deep.equal(['denied'])
    } finally {
      unspyify(Admin, 'isSignedIn')
    }
  })

  it('returns discussion reactions to inherited moderators without a separate membership', async () => {
    await post.addReaction(author.id, 'heart')
    await GroupMembership.assignAdministratorRole(member.id, group.id)
    const space = await factories.group({ type: 'space', parent_id: group.id, active: true }).save()
    await post.groups().detach(group.id)
    await post.groups().attach(space.id)
    const result = await execute(member, `{ post(id: "${post.id}") { postReactions { emojiFull } } }`)
    expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
    expect(result.data.post.postReactions).to.deep.equal([{ emojiFull: 'heart' }])
  })

  it('includes inherited moderation in discussion search and removes it immediately', async () => {
    await GroupMembership.assignAdministratorRole(member.id, group.id)
    const space = await factories.group({ type: 'space', parent_id: group.id, active: true }).save()
    await post.groups().detach(group.id)
    await post.groups().attach(space.id)
    await FullTextSearch.refreshView()
    const search = scoped => Search.fullTextSearch(member.id, { term: 'Quokka', first: 20, ...(scoped ? { groupIds: [space.id] } : {}) })
    for (const scoped of [true, false]) expect((await search(scoped)).models).to.have.length(1)
    await revoke()
    for (const scoped of [true, false]) expect((await search(scoped)).models).to.have.length(0)
  })

  it('uses current inherited moderation for post, comment, notification and socket access', async () => {
    await GroupMembership.assignAdministratorRole(member.id, group.id)
    const space = await factories.group({ type: 'space', parent_id: group.id, active: true }).save()
    await post.groups().detach(group.id)
    await post.groups().attach(space.id)
    const source = `{ post(id: "${post.id}") { id } comment(id: "${comment.id}") { id } }`
    const assertAccess = async allowed => {
      expect(await Post.isVisibleToUser(post.id, member.id)).to.equal(allowed)
      const result = await execute(member, source, true)
      expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
      expect(!!result.data.post).to.equal(allowed)
      expect(!!result.data.comment).to.equal(allowed)
      expect((await execute(member, notifications, true)).data.notifications.total).to.equal(allowed ? 1 : 0)
      const delivery = await Websockets.pushToSockets(Websockets.postRoom(post.id), 'userTyping', {})
      expect([].concat(delivery?.room || []).includes(Websockets.postUserRoom(post.id, member.id))).to.equal(allowed)
    }
    await assertAccess(true)
    await bookshelf.knex('group_memberships_group_roles').where({ user_id: member.id, group_id: group.id }).update({ active: false })
    await assertAccess(false)
  })
})
