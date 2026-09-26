/* eslint-disable no-unused-expressions */
import { randomUUID } from 'crypto'
import { graphql } from 'graphql'
import setup from '../../setup'
import factories from '../../setup/factories'
import { mockify, unspyify } from '../../setup/helpers'
import makeSchema from '../../../api/graphql/makeSchema'
import { decisionRounds, manageDecisionRound, submitDecisionBallot } from '../../../api/graphql/decisions'
import { decisionResult, validateDecisionBallot } from '../../../lib/decisionRules'

const settled = promises => Promise.all(promises.map(p => p.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))))
const config = overrides => ({
  method: 'systemic_consensus',
  question: 'Where should we meet?',
  purpose: 'Discuss the assessment before recording an outcome.',
  minimum: 3,
  deadline: new Date(Date.now() + 3600000).toISOString(),
  options: [
    { id: 'a', label: 'Community room', passive: false }, { id: 'b', label: 'Library', passive: false },
    { id: 'p', label: 'Keep meeting online', passive: true }
  ],
  ...overrides
})
const answers = scores => ['a', 'b', 'p'].map((optionId, i) => ({ optionId, score: scores[i] }))

describe('Private decision rounds', () => {
  let author, voter, third, outsider, group, post
  const read = user => decisionRounds(user.id, { postId: post.id })
  const manage = (action, round, overrides = {}, user = author) => manageDecisionRound(user.id, {
    input: {
      postId: post.id, requestId: randomUUID(), expectedVersion: round?.version || 0, roundId: round?.id, action, ...overrides
    }
  })
  const voteInput = (round, overrides = {}) => ({
    postId: post.id,
    roundId: round.id,
    requestId: randomUUID(),
    expectedVersion: 0,
    state: 'vote',
    answers: answers([0, 3, 5]),
    ...overrides
  })
  const vote = (user, round, overrides) => submitDecisionBallot(user.id, { input: voteInput(round, overrides) })
  const open = async (overrides = {}) => manage('open', await manage('create', null, { config: config(overrides) }))
  beforeEach(async () => {
    await setup.clearDb()
    mockify(Queue, 'classMethod', () => Promise.resolve())
    ;[author, voter, third, outsider] = await Promise.all(['Facilitator', 'Voter Two', 'Voter Three', 'Outsider'].map(name => factories.user({ name }).save()))
    group = await factories.group({ visibility: 0, active: true }).save()
    for (const user of [author, voter, third]) await user.joinGroup(group)
    post = await factories.post({ user_id: author.id, type: 'discussion', is_public: false }).save()
    await post.groups().attach(group.id)
  })
  afterEach(() => unspyify(Queue, 'classMethod'))

  it('runs the SK reference round, hides open aggregates, and links a new empty round', async () => {
    const round = await open()
    expect(round.electorateCount).to.equal(3)
    await vote(author, round)
    await vote(voter, round, { answers: answers([4, 3, 5]) })
    await vote(third, round, { answers: answers([8, 3, 5]) })
    expect((await read(author)).rounds[0].result).to.equal(null)
    const closed = await manage('close', round)
    expect(closed.result.options.map(o => [o.id, o.total, o.mean])).to.deep.equal([['b', 9, 3], ['a', 12, 4], ['p', 15, 5]])
    expect(closed.result.status).to.equal('assessed')
    const next = await manage('create', null, { config: config({ question: 'Revised question' }), previousRoundId: closed.id })
    expect(next.ownBallot.version).to.equal(0)
    expect(next.previousRoundId).to.equal(closed.id)
    expect((await read(voter)).rounds.find(r => r.id === closed.id).result).to.deep.equal(closed.result)
    await expect(manage('update', closed, { config: config() })).to.be.rejectedWith('DECISION_FROZEN')
    await expect(vote(voter, closed)).to.be.rejectedWith('DECISION_INVALID_STATE')
  })
  it('rejects invalid replacement ballots atomically, including null, fractional, duplicated and foreign answers', async () => {
    const round = await open()
    await vote(voter, round)
    for (const invalid of [[], answers([0, null, 5]), answers([0, 1.5, 5]), answers([0, -1, 5]), answers([0, 11, 5]),
      answers([0, '3', 5]), answers([0, 3, 5]).slice(1), [...answers([0, 3, 5]), { optionId: 'alien', score: 2 }],
      [{ optionId: 'a', score: 0 }, { optionId: 'a', score: 0 }, { optionId: 'p', score: 5 }]]) {
      await expect(vote(voter, round, { expectedVersion: 1, answers: invalid })).to.be.rejectedWith('DECISION_INVALID_BALLOT')
    }
    expect((await read(voter)).rounds[0].ownBallot).to.deep.equal({ version: 1, state: 'vote', answers: answers([0, 3, 5]) })
  })
  it('retries once, rejects key reuse and stale edits, and records withdrawal separately from abstention', async () => {
    const round = await open()
    const input = voteInput(round)
    await submitDecisionBallot(voter.id, { input })
    await submitDecisionBallot(voter.id, { input })
    expect((await read(voter)).rounds[0].ownBallot.version).to.equal(1)
    await expect(submitDecisionBallot(voter.id, { input: { ...input, answers: answers([1, 2, 3]) } })).to.be.rejectedWith('DECISION_RETRY_CONFLICT')
    const competing = await settled([vote(voter, round, { expectedVersion: 1, answers: answers([1, 2, 3]) }), vote(voter, round, { expectedVersion: 1 })])
    expect(competing.filter(r => r.status === 'fulfilled')).to.have.length(1)
    expect(competing.find(r => r.status === 'rejected').reason.message).to.equal('DECISION_CONFLICT')
    await vote(voter, round, { expectedVersion: 2, state: 'withdrawn', answers: [] })
    await vote(third, round, { state: 'abstained', answers: [] })
    const closed = await manage('close', round)
    expect(closed.result).to.include({ complete: 0, abstentions: 1, missing: 2, status: 'no_ballots' })
    expect(closed.result.bestOptionIds).to.deep.equal([])
    expect(closed.result.options.every(o => o.mean === null)).to.equal(true)
  })
  it('freezes config and electorate; removal revokes access but preserves accepted votes and denominator', async () => {
    const round = await open()
    await vote(voter, round)
    await outsider.joinGroup(group)
    expect((await read(outsider)).rounds[0].eligible).to.equal(false)
    await expect(vote(outsider, round)).to.be.rejectedWith('DECISION_NOT_ELIGIBLE')
    await expect(manage('update', round, { config: config({ minimum: 1 }) })).to.be.rejectedWith('DECISION_FROZEN')
    await expect(bookshelf.knex('decision_rounds').where('id', round.id).update({ config: JSON.stringify(config({ minimum: 1 })) })).to.be.rejectedWith('Frozen decision round')
    await bookshelf.knex('group_memberships').where({ user_id: voter.id, group_id: group.id }).update({ active: false })
    await expect(read(voter)).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    await expect(vote(voter, round, { expectedVersion: 1 })).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    expect((await manage('close', round)).result).to.include({ eligible: 3, complete: 1, missing: 2, status: 'insufficient' })
  })
  it('authorizes every retry and excludes followers, non-facilitators and other linked groups', async () => {
    const draftConfig = config(); const requestId = randomUUID()
    const draft = await manage('create', null, { config: draftConfig, requestId })
    await factories.postUser({ post_id: post.id, user_id: outsider.id }).save()
    await expect(read(outsider)).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    await expect(manage('open', draft, {}, voter)).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    await GroupMembership.assignAdministratorRole(voter.id, group.id)
    const round = await manage('open', draft, {}, voter)
    await bookshelf.knex('group_memberships').where({ user_id: author.id, group_id: group.id }).update({ active: false })
    await expect(manage('create', null, { config: draftConfig, requestId })).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    const other = await factories.group({ visibility: 0 }).save()
    await outsider.joinGroup(other); await post.groups().attach(other.id)
    await expect(read(outsider)).to.be.rejectedWith('DECISION_ACCESS_DENIED')
    await expect(vote(voter, round)).to.be.rejectedWith('DECISION_ACCESS_DENIED')
  })
  it('serializes concurrent close and vote without partial acceptance', async () => {
    const round = await open()
    const results = await settled([vote(voter, round), manage('close', round)])
    const closed = (await read(author)).rounds[0]
    expect(closed.phase).to.equal('closed')
    expect(closed.result.complete).to.equal(results[0].status === 'fulfilled' ? 1 : 0)
    expect(results[1].status).to.equal('fulfilled')
    await expect(vote(third, round)).to.be.rejectedWith('DECISION_INVALID_STATE')
    expect(await bookshelf.knex('decision_events').where({ round_id: round.id, action: 'close' })).to.have.length(1)
  })
  it('samples the deadline after acquiring a contended lock', async () => {
    const round = await open({ deadline: new Date(Date.now() + 1500).toISOString() })
    let queued
    await bookshelf.knex.transaction(async db => {
      await db('posts').where('id', post.id).forUpdate().first()
      queued = vote(voter, round).then(() => 'accepted', e => e.message)
      await db.raw('select pg_sleep(1.6)')
    })
    expect(await queued).to.equal('DECISION_DEADLINE_PASSED')
    expect((await manage('close', round)).result.complete).to.equal(0)
  })
  it('rejects unknown methods, bad passive options, deadlines and thresholds; keeps cancelled rounds', async () => {
    for (const invalid of [config({ method: 'unknown' }), config({ minimum: 0 }), config({ options: config().options.slice(0, 2) }), config({ purpose: '' })]) {
      await expect(manage('create', null, { config: invalid })).to.be.rejectedWith('DECISION_INVALID_CONFIG')
    }
    for (const invalid of [config({ minimum: 4 }), config({ deadline: '2000-01-01T00:00:00Z' })]) {
      const draft = await manage('create', null, { config: invalid })
      await expect(manage('open', draft)).to.be.rejectedWith('DECISION_INVALID_CONFIG')
      const cancelled = await manage('cancel', draft)
      expect(cancelled.phase).to.equal('cancelled'); expect(cancelled.result).to.equal(null)
    }
  })
  it('runs single choice without touching legacy proposals; never falls back for unknown methods', async () => {
    const legacy = await factories.post({ user_id: author.id, type: 'proposal' }).save()
    const before = await bookshelf.knex('posts').where('id', legacy.id).first()
    const round = await open({ method: 'single_choice', options: config().options.slice(0, 2), minimum: 1 })
    await vote(voter, round, { answers: [{ optionId: 'a' }] })
    expect((await manage('close', round)).result.options.map(o => [o.id, o.total])).to.deep.equal([['a', 1], ['b', 0]])
    expect(await bookshelf.knex('posts').where('id', legacy.id).first()).to.deep.equal(before)
    expect(() => validateDecisionBallot({ ...config(), method: 'unknown' }, 'vote', answers([1, 2, 3]))).to.throw('DECISION_UNSUPPORTED_METHOD')
  })
  it('GraphQL exposes only the caller ballot and rejects raw lists or user selectors', async () => {
    const round = await open(); await vote(voter, round)
    const schema = await makeSchema({ req: { session: { userId: author.id } } })
    const query = 'query ($postId: ID!) { decisionRounds(postId: $postId) { rounds { ownBallot { version state answers { optionId score } } result { complete } } } }'
    const execute = (user, source = query) => graphql({ schema, source, variableValues: { postId: String(post.id) }, contextValue: { currentUserId: user.id } })
    const view = await execute(author)
    expect(view.errors).to.equal(undefined)
    expect(view.data.decisionRounds.rounds[0].ownBallot.version).to.equal(0)
    expect(view.data.decisionRounds.rounds[0].result).to.equal(null)
    expect((await execute(outsider)).errors).to.have.length(1)
    expect((await execute(author, query.replace('ownBallot {', 'ownBallot(userId: "1") {'))).errors).to.have.length(1)
    expect((await execute(author, query.replace('ownBallot', 'ballots'))).errors).to.have.length(1)
  })
})

describe('SK interpretation', () => {
  const result = scores => decisionResult(config(), 3, scores.map(row => ({ state: 'vote', answers: answers(row) })))
  it('preserves ties, passive preference, threshold, explicit zero and maximum resistance without veto', () => {
    expect(result([[0, 0, 0], [0, 0, 0], [0, 0, 0]]).bestOptionIds).to.deep.equal(['a', 'b', 'p'])
    expect(result([[0, 0, 0], [0, 0, 0], [0, 0, 0]]).status).to.equal('tie')
    expect(result([[1, 2, 0], [1, 2, 0], [1, 2, 0]]).status).to.equal('passive_preferred')
    expect(result([[0, 3, 5], [4, 3, 5]]).status).to.equal('insufficient')
    const maximum = result([[10, 4, 5], [0, 4, 5], [0, 4, 5]])
    expect(maximum.bestOptionIds).to.deep.equal(['a']); expect(maximum.options[0].distribution[10]).to.equal(1)
  })
})
