/* eslint-disable no-unused-expressions */
import { graphql } from 'graphql'
import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import makeSchema from '../../../api/graphql/makeSchema'
import { discussionOverview, discussionHistory, updateDiscussion } from '../../../api/graphql/discussions'
import * as migration from '../../../migrations/20260925120000_discussion_revisions'

describe('Structured discussions', () => {
  let author, member, moderator, outsider, group, post
  const input = overrides => ({ postId: post.id, expectedVersion: 0, context: 'Why we are discussing this', summary: 'We still need evidence', openQuestions: ['What is missing?'], ...overrides })
  const read = user => discussionOverview(user.id, { postId: post.id })
  const history = (user, args = {}) => discussionHistory(user.id, { postId: post.id, ...args })
  const revoke = user => bookshelf.knex('group_memberships').where({ group_id: group.id, user_id: user.id }).update({ active: false })
  const legacy = '<p>Original context</p><p><a href="https://example.org/evidence">Evidence</a></p>'

  beforeEach(async () => {
    await setup.clearDb()
    mockify(Queue, 'classMethod', () => Promise.resolve())
    author = await factories.user({ name: 'Discussion Author' }).save()
    member = await factories.user({ name: 'Late Participant' }).save()
    moderator = await factories.user({ name: 'Discussion Moderator' }).save()
    outsider = await factories.user().save()
    group = await factories.group({ visibility: 0, active: true }).save()
    for (const user of [author, member, moderator]) await user.joinGroup(group)
    await GroupMembership.assignAdministratorRole(moderator.id, group.id)
    post = await factories.post({ user_id: author.id, type: 'discussion', description: legacy, is_public: false }).save()
    await post.groups().attach(group.id)
  })

  afterEach(() => unspyify(Queue, 'classMethod'))

  it('imports legacy context with link targets without writing a revision', async () => {
    const view = await read(author)
    expect(view.canEdit).to.equal(true)
    expect(view.current.version).to.equal(0)
    expect(view.current.context).to.equal('Original context\nEvidence (https://example.org/evidence)')
    expect(await history(author)).to.have.length(0)
  })

  it('preserves the original post, comments, attachments and their IDs through revisions', async () => {
    const comment = await factories.comment({ post_id: post.id, user_id: member.id }).save()
    const beforePost = await bookshelf.knex('posts').where('id', post.id).first()
    const beforeComments = await bookshelf.knex('comments').where('post_id', post.id)
    await bookshelf.knex('media').insert({ post_id: post.id, type: 'image', url: 'https://example.org/diagram.png', name: 'Evidence diagram' })
    // Attachment records refer to the post, which the overview never changes.
    const beforeMedia = await bookshelf.knex('media').where('post_id', post.id)
    await updateDiscussion(author.id, input())
    const view = await updateDiscussion(moderator.id, input({ expectedVersion: 1, summary: 'Moderator synthesis' }))
    expect(view.current.version).to.equal(2)
    expect(view.current.author.id).to.equal(String(moderator.id))
    expect(view.lastSummary.createdAt).to.be.a('string')
    expect((await history(member)).map(row => row.author.id)).to.deep.equal([String(moderator.id), String(author.id)])
    expect(await bookshelf.knex('posts').where('id', post.id).first()).to.deep.equal(beforePost)
    expect(await bookshelf.knex('comments').where('post_id', post.id)).to.deep.equal(beforeComments)
    expect(await bookshelf.knex('media').where('post_id', post.id)).to.deep.equal(beforeMedia)
    expect(String(beforeComments[0].id)).to.equal(String(comment.id))
  })

  it('lets a participant read but not edit', async () => {
    await updateDiscussion(author.id, input())
    expect((await read(member)).canEdit).to.equal(false)
    expect((await history(member))[0].summary).to.equal('We still need evidence')
    await expect(updateDiscussion(member.id, input({ expectedVersion: 1 }))).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
  })

  it('inherits space moderation only from active parent membership and role assignments', async () => {
    const space = await factories.group({ type: 'space', parent_id: group.id, active: true }).save()
    await post.groups().detach(group.id)
    await post.groups().attach(space.id)
    expect((await read(moderator)).canEdit).to.equal(true)
    await updateDiscussion(moderator.id, input())
    await expect(read(member)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
    await bookshelf.knex('group_memberships_group_roles').where({ user_id: moderator.id, group_id: group.id }).update({ active: false })
    await expect(read(moderator)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
    await bookshelf.knex('group_memberships_group_roles').where({ user_id: moderator.id, group_id: group.id }).update({ active: true })
    await bookshelf.knex('groups').where('id', group.id).update({ active: false })
    await expect(read(moderator)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
  })

  it('denies outsiders, even if the post is public or they follow it', async () => {
    await updateDiscussion(author.id, input())
    await factories.postUser({ post_id: post.id, user_id: outsider.id }).save()
    await post.save({ is_public: true })
    await expect(read(outsider)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
    await expect(history(outsider)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
  })

  for (const role of ['author', 'member', 'moderator']) {
    it(`denies a revoked ${role}, including retained roles and subscriptions`, async () => {
      const user = { author, member, moderator }[role]
      await updateDiscussion(author.id, input())
      await factories.postUser({ post_id: post.id, user_id: user.id }).save()
      await revoke(user)
      await expect(read(user)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
      await expect(history(user)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
      await expect(updateDiscussion(user.id, input({ expectedVersion: 1 }))).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
    })
  }

  it('denies inactive users, groups, posts and other post types', async () => {
    for (const [table, id, changes, restore] of [
      ['users', author.id, { active: false }, { active: true }],
      ['groups', group.id, { active: false }, { active: true }],
      ['posts', post.id, { active: false }, { active: true }],
      ['posts', post.id, { type: 'proposal' }, { type: 'discussion' }]
    ]) {
      await bookshelf.knex(table).where({ id }).update(changes)
      await expect(read(author)).to.be.rejectedWith('DISCUSSION_ACCESS_DENIED')
      await bookshelf.knex(table).where({ id }).update(restore)
    }
  })

  it('does not move the latest-summary marker for context-only edits or unchanged saves', async () => {
    const first = await updateDiscussion(author.id, input())
    const second = await updateDiscussion(author.id, input({ expectedVersion: 1, context: 'More context' }))
    expect(second.lastSummary).to.deep.equal(first.lastSummary)
    await updateDiscussion(author.id, input({ expectedVersion: 2, context: 'More context' }))
    expect(await history(author)).to.have.length(2)
  })

  it('rejects a stale edit and serializes simultaneous saves without losing history', async () => {
    const results = await Promise.all([
      updateDiscussion(author.id, input()),
      updateDiscussion(moderator.id, input({ summary: 'Concurrent summary' }))
    ].map(promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))))
    expect(results.filter(result => result.status === 'fulfilled')).to.have.length(1)
    expect(results.find(result => result.status === 'rejected').reason.message).to.equal('DISCUSSION_CONFLICT')
    expect(await history(author)).to.have.length(1)
    await expect(updateDiscussion(author.id, input())).to.be.rejectedWith('DISCUSSION_CONFLICT')
  })

  it('validates bounds and returns a stable, bounded history page', async () => {
    for (const invalid of [{ context: 'x'.repeat(50001) }, { summary: 'x'.repeat(20001) }, { openQuestions: [' '] }, { openQuestions: ['x'.repeat(1001)] }, { openQuestions: Array(31).fill('Question') }]) {
      await expect(updateDiscussion(author.id, input(invalid))).to.be.rejectedWith('DISCUSSION_INVALID_INPUT')
    }
    for (let version = 0; version < 21; version++) {
      await updateDiscussion(author.id, input({ expectedVersion: version, summary: `Summary ${version}` }))
    }
    const firstPage = await history(member)
    expect(firstPage).to.have.length(20)
    expect(firstPage[0].version).to.equal(21)
    const secondPage = await history(member, { beforeVersion: firstPage[19].version })
    expect(secondPage.map(row => row.version)).to.deep.equal([1])
  })

  it('enforces permissions through GraphQL, without exposing revisions on general Post', async () => {
    await updateDiscussion(author.id, input())
    const source = 'query($id: ID!) { discussionOverview(postId: $id) { canEdit current { context summary } } discussionHistory(postId: $id) { context } }'
    const execute = async user => graphql({
      schema: await makeSchema({ req: { session: { userId: user?.id } } }),
      source,
      variableValues: { id: String(post.id) },
      contextValue: { currentUserId: user?.id }
    })
    expect((await execute(member)).data.discussionOverview.current.summary).to.equal('We still need evidence')
    const denied = await execute(outsider)
    expect(denied.data.discussionOverview).to.equal(null)
    expect(denied.data.discussionHistory).to.equal(null)
    expect(denied.errors.every(error => error.extensions.code === 'DISCUSSION_ACCESS_DENIED')).to.equal(true)
    const anonymous = await execute(null)
    expect(anonymous.data.discussionOverview).to.equal(null)
    expect(anonymous.data.discussionHistory).to.equal(null)
    const schema = await makeSchema({ req: { session: { userId: author.id } } })
    expect(schema.getType('Post').getFields()).not.to.have.property('discussionOverview')
    expect(schema.getSubscriptionType().getFields()).not.to.have.property('discussionOverview')
    await revoke(member)
    expect((await execute(member)).data.discussionOverview).to.equal(null)
  })

  it('applies and rolls back the migration on an existing schema', async () => {
    await migration.down(bookshelf.knex)
    await migration.up(bookshelf.knex)
    expect((await updateDiscussion(author.id, input())).current.version).to.equal(1)
  })
})
