/* eslint-disable no-unused-expressions */
import { expect } from 'chai'
import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import updatePost from '../../../api/models/post/updatePost'

describe('Proposal option preservation', () => {
  let author, voter, group, post, options, votes

  const readOptions = () => bookshelf.knex('proposal_options').where('post_id', post.id).orderBy('id')
  const readVotes = () => bookshelf.knex('proposal_votes').where('post_id', post.id).orderBy('id')
  const readResets = () => bookshelf.knex('activities').where('post_id', post.id).whereRaw("meta->'reasons' @> ?::jsonb", ['["voteReset"]'])

  beforeEach(async () => {
    await setup.clearDb()
    // Keep persistence and activities real; prevent background delivery to external services.
    mockify(Queue, 'classMethod', () => Promise.resolve())
    mockify(Post, 'afterRelatedMutation', () => Promise.resolve())
    author = await factories.user().save()
    voter = await factories.user().save()
    group = await factories.group().save()
    await author.joinGroup(group)
    await voter.joinGroup(group)
    post = await factories.post({ user_id: author.id, type: 'proposal', name: 'Original question' }).save()
    await post.groups().attach(group.id)
    await ProposalOption.forge({ post_id: post.id, text: 'First option', color: null, emoji: null }).save()
    await ProposalOption.forge({ post_id: post.id, text: 'Second option', color: '', emoji: '' }).save()
    options = await readOptions()
    await ProposalVote.forge({
      post_id: post.id,
      option_id: options[0].id,
      user_id: voter.id,
      created_at: new Date('2025-01-01T12:00:00Z')
    }).save()
    votes = await readVotes()
  })

  afterEach(() => {
    unspyify(Queue, 'classMethod')
    unspyify(Post, 'afterRelatedMutation')
  })

  for (const edit of [
    { name: 'Clarified question' },
    { description: '<p>Additional context</p>' }
  ]) {
    it(`preserves persisted option IDs, votes and timestamps after a ${Object.keys(edit)[0]} edit`, async () => {
      const submittedOptions = options.slice().reverse().map(({ id, text, color, emoji }) => ({
        id: String(id), text, color: color || '', emoji: emoji || ''
      }))

      await updatePost(author.id, post.id, {
        name: post.get('name'),
        description: post.get('description'),
        ...edit,
        group_ids: [group.id],
        proposalOptions: submittedOptions
      })

      const updated = await Post.find(post.id)
      for (const [field, value] of Object.entries(edit)) expect(updated.get(field)).to.equal(value)
      expect(await readOptions()).to.deep.equal(options)
      expect(await readVotes()).to.deep.equal(votes)
      expect(await readResets()).to.have.length(0)
      expect(Post.afterRelatedMutation).not.to.have.been.called.with(post.id, { changeContext: 'vote' })
    })
  }

  it('keeps the legacy reset and notification when an option actually changes', async () => {
    const changed = options.map(({ id, text, color, emoji }, index) => ({
      id: String(id), text: index === 0 ? 'Changed option' : text, color, emoji
    }))

    await updatePost(author.id, post.id, {
      name: post.get('name'),
      group_ids: [group.id],
      proposalOptions: changed
    })

    expect(await readVotes()).to.have.length(0)
    expect((await readOptions())[0].text).to.equal('Changed option')
    const resets = await readResets()
    expect(resets).to.have.length(1)
    expect(String(resets[0].reader_id)).to.equal(String(voter.id))
    expect(Post.afterRelatedMutation).to.have.been.called.with(post.id, { changeContext: 'vote' })
  })
})
