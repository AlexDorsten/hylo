import { graphql } from 'graphql'
import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import makeSchema from '../../../api/graphql/makeSchema'
import makeSubscriptions from '../../../api/graphql/makeSubscriptions'
import { validateCommentCreateData, canUpdateComment } from '../../../api/graphql/mutations/comment'

describe('Discussion access across legacy entry points', () => {
  let author, member, outsider, group, post, comment
  const revoke = () => bookshelf.knex('group_memberships').where({ group_id: group.id, user_id: member.id }).update({ active: false })
  const context = user => ({ currentUserId: user?.id, request: { headers: new Headers() } })
  const execute = async (user, source) => graphql({
    schema: await makeSchema({ req: { session: { userId: user?.id } } }),
    source,
    contextValue: context(user)
  })

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
    comment = await factories.comment({ post_id: post.id, user_id: member.id, text: 'Quokka private contribution' }).save()
    await factories.postUser({ post_id: post.id, user_id: member.id }).save()
  })
  afterEach(() => unspyify(Queue, 'classMethod'))

  it('revokes replying and editing even when the former member still follows the discussion', async () => {
    expect(await Post.isVisibleToUser(post.id, member.id)).to.equal(true)
    await revoke()
    expect(await Post.isVisibleToUser(post.id, member.id)).to.equal(false)
    await expect(validateCommentCreateData(member.id, { postId: post.id, text: 'No longer a member' })).to.be.rejectedWith('post not found')
    await expect(canUpdateComment(member.id, comment)).to.be.rejectedWith('permission')
  })

  it('filters direct post/comment URLs and nested replies for revoked members and anonymous readers', async () => {
    const source = `{ post(id: "${post.id}") { id details comments { items { id text } } } comment(id: "${comment.id}") { id text } }`
    const before = await execute(member, source)
    expect(before.errors).to.equal(undefined)
    expect(before.data.comment.text).to.equal('Quokka private contribution')
    await revoke()
    for (const user of [member, outsider, null]) {
      const result = await execute(user, source)
      expect(result.errors).to.equal(undefined)
      expect(result.data.post).to.equal(null)
      expect(result.data.comment).to.equal(null)
    }
  })

  it('treats explicit search group IDs as a scope, never as a permission grant', async () => {
    await FullTextSearch.refreshView()
    const search = (user, scoped) => Search.fullTextSearch(user.id, { term: 'Quokka', first: 20, ...(scoped ? { groupIds: [group.id] } : {}) })
    expect((await search(member, true)).models).to.have.length(2)
    await revoke()
    for (const user of [member, outsider]) {
      for (const scoped of [true, false]) {
        expect((await search(user, scoped)).models).to.have.length(0)
      }
    }
  })

  it('rejects a reply to a private parent from another post', async () => {
    const publicPost = await factories.post({ user_id: outsider.id, type: 'discussion', is_public: true }).save()
    await publicPost.groups().attach(group.id)
    await expect(validateCommentCreateData(outsider.id, { postId: publicPost.id, parentCommentId: comment.id, text: 'Cross-post reply' })).to.be.rejectedWith('parent comment not found')
  })

  it('does not expose a private parent through an existing reply attached to a public post', async () => {
    const publicPost = await factories.post({ user_id: outsider.id, type: 'discussion', is_public: true }).save()
    await publicPost.groups().attach(group.id)
    // Old or imported malformed links must not expose another discussion either.
    const reply = await factories.comment({ post_id: publicPost.id, user_id: outsider.id, comment_id: comment.id }).save()
    const result = await execute(outsider, `{ comment(id: "${reply.id}") { id parentComment { id text } } }`)
    expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
    expect(result.data.comment.parentComment).to.equal(null)
  })

  it('keeps a valid reply and its parent accessible to current members', async () => {
    const data = { postId: post.id, parentCommentId: comment.id, text: 'A relevant reply' }
    expect(await validateCommentCreateData(member.id, data)).to.equal(data)
    const reply = await factories.comment({ post_id: post.id, user_id: member.id, comment_id: comment.id }).save()
    const result = await execute(member, `{ comment(id: "${reply.id}") { parentComment { id text } } }`)
    expect(result.errors, JSON.stringify(result.errors)).to.equal(undefined)
    expect(result.data.comment.parentComment).to.deep.equal({ id: comment.id, text: 'Quokka private contribution' })
  })

  for (const [name, args] of [
    ['comments', 'postId'],
    ['comments', 'commentId'],
    ['peopleTyping', 'postId'],
    ['peopleTyping', 'commentId']
  ]) {
    it(`denies a new ${name} subscription by an outsider or removed member (${args})`, async () => {
      await revoke()
      for (const user of [member, outsider, null]) {
        const ctx = { ...context(user), pubSub: { subscribe: () => { throw new Error('Unauthorized channel opened') } } }
        await expect(Promise.resolve().then(() => makeSubscriptions()[name].subscribe(null, { [args]: args === 'postId' ? post.id : comment.id }, ctx))).to.be.rejectedWith('SUBSCRIPTION_ACCESS_DENIED')
      }
    })
  }

  for (const name of ['comments', 'peopleTyping', 'postUpdates', 'allUpdates']) {
    it(`rechecks access for every ${name} event on an existing subscription`, async () => {
      const payload = name === 'comments' ? { comment } : name === 'peopleTyping' ? { user: author } : { post }
      async function * events () {
        yield payload
        await revoke()
        yield payload
      }
      async function * empty () {}
      const ctx = {
        ...context(member),
        pubSub: { subscribe: channel => name !== 'allUpdates' || channel.startsWith('postUpdates:') ? events() : empty() }
      }
      const stream = await makeSubscriptions()[name].subscribe(null, { postId: post.id }, ctx)
      expect((await stream.next()).value).to.equal(payload)
      expect((await stream.next()).done).to.equal(true)
    })
  }

  it('keeps public discussions and participant-only message threads accessible', async () => {
    await post.save({ is_public: true })
    expect(await Post.isVisibleToUser(post.id, outsider.id)).to.equal(true)
    const thread = await factories.post({ type: 'thread', is_public: false }).save()
    await factories.postUser({ post_id: thread.id, user_id: member.id }).save()
    expect(await Post.isVisibleToUser(thread.id, member.id)).to.equal(true)
    expect(await Post.isVisibleToUser(thread.id, outsider.id)).to.equal(false)
    async function * events () { yield { user: author } }
    const subscription = makeSubscriptions().peopleTyping
    for (const [user, args] of [[outsider, { postId: post.id }], [member, { messageThreadId: thread.id }]]) {
      const stream = await subscription.subscribe(null, args, { ...context(user), pubSub: { subscribe: events } })
      expect((await stream.next()).value.user).to.equal(author)
      await stream.return()
    }
  })
})
