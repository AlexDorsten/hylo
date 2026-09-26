import { createHash, randomUUID } from 'crypto'
import { GraphQLError } from 'graphql'
import { discussionMemberGroups, discussionModeratorGroups } from '../../lib/discussionAccess'
import { validateDecisionConfig, validateDecisionBallot, decisionResult } from '../../lib/decisionRules'

const fail = code => { throw new GraphQLError(code, { extensions: { code } }) }
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const rules = (fn, ...args) => { try { return fn(...args) } catch (e) { fail(e.message) } }

// Deliberately narrower than general post access: exactly one private hosting
// group, current membership, active account. A follower/socket is not a grant.
async function access (db, userId, postId, lock = false) {
  if (!userId || !/^\d+$/.test(String(postId))) fail('DECISION_ACCESS_DENIED')
  const query = db('posts').where({ id: postId, active: true, type: 'discussion', is_public: false })
  const post = await (lock ? query.forUpdate() : query).first()
  const links = post ? await db('groups_posts').where('post_id', postId) : []
  if (links.length !== 1) fail('DECISION_ACCESS_DENIED')
  const groupId = links[0].group_id
  const group = await db('groups').where({ id: groupId, active: true, visibility: 0 })
    .whereIn('id', discussionMemberGroups(userId, db)).first()
  if (!group) fail('DECISION_ACCESS_DENIED')
  const moderator = await db('groups').where('id', groupId).whereIn('id', discussionModeratorGroups(userId, db)).first()
  return { post, groupId, canManage: String(post.user_id) === String(userId) || !!moderator }
}

function members (db, groupId) {
  return db('group_memberships as membership').join('users as member', 'member.id', 'membership.user_id')
    .where({ 'membership.group_id': groupId, 'membership.active': true, 'member.active': true })
    .distinct('membership.user_id')
}
const latestBallots = (db, roundId) => db('decision_ballots').where('round_id', roundId)
  .distinctOn('user_id').orderBy('user_id').orderBy('version', 'desc')
const ownBallot = (db, roundId, userId) => db('decision_ballots').where({ round_id: roundId, user_id: userId }).orderBy('version', 'desc').first()

async function present (db, row, userId, auth) {
  if (String(row.group_id) !== String(auth.groupId)) fail('DECISION_ACCESS_DENIED')
  const ballot = await ownBallot(db, row.id, userId)
  const eligible = !!await db('decision_electorate').where({ round_id: row.id, user_id: userId }).first()
  const { rows: [{ time }] } = await db.raw('select clock_timestamp() as time')
  return {
    id: row.id,
    version: row.version,
    phase: row.phase,
    config: row.config,
    previousRoundId: row.previous_round_id,
    electorateCount: row.electorate_count,
    createdAt: row.created_at.toISOString(),
    openedAt: row.opened_at?.toISOString(),
    closedAt: row.closed_at?.toISOString(),
    canManage: auth.canManage,
    canVote: eligible && row.phase === 'open' && time < new Date(row.config.deadline),
    eligible,
    ownBallot: ballot ? { version: ballot.version, state: ballot.state, answers: ballot.answers } : { version: 0, state: 'unanswered', answers: [] },
    result: row.phase === 'closed' ? rules(decisionResult, row.config, row.electorate_count, await latestBallots(db, row.id)) : null
  }
}

export async function decisionRounds (userId, { postId, beforeId }) {
  // Repeatable read prevents a single response mixing open config and later votes.
  return bookshelf.knex.transaction(async db => {
    await db.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const auth = await access(db, userId, postId)
    const query = db('decision_rounds').where({ post_id: postId, group_id: auth.groupId }).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(21)
    if (beforeId) {
      if (!uuid(beforeId)) fail('DECISION_INVALID_INPUT')
      const cursor = await db('decision_rounds').where({ id: beforeId, post_id: postId, group_id: auth.groupId }).first()
      if (!cursor) fail('DECISION_INVALID_INPUT')
      query.whereRaw('(created_at, id) < (?, ?::uuid)', [cursor.created_at, cursor.id])
    }
    const rows = await query
    return {
      canCreate: auth.canManage,
      eligibleCount: (await members(db, auth.groupId)).length,
      hasMore: rows.length > 20,
      rounds: await Promise.all(rows.slice(0, 20).map(row => present(db, row, userId, auth)))
    }
  })
}

// Every command locks the discussion then the round. Close, vote and retry share
// this order. A retry rechecks access and returns current state without replaying.
async function command (userId, input, kind, apply) {
  return bookshelf.knex.transaction(async db => {
    const auth = await access(db, userId, input.postId, true)
    if (!uuid(input.requestId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 ||
      (input.roundId != null && !uuid(input.roundId))) fail('DECISION_INVALID_INPUT')
    if (kind === 'manage' && !auth.canManage) fail('DECISION_ACCESS_DENIED')
    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, input })).digest('hex')
    const key = { post_id: input.postId, user_id: userId, request_id: input.requestId }
    const retry = await db('decision_commands').where(key).first()
    if (retry && retry.fingerprint !== fingerprint) fail('DECISION_RETRY_CONFLICT')
    const roundId = retry?.round_id || input.roundId
    let row = roundId ? await db('decision_rounds').where({ id: roundId, post_id: input.postId, group_id: auth.groupId }).forUpdate().first() : null
    if (roundId && !row) fail('DECISION_ACCESS_DENIED')
    if (retry) return present(db, row, userId, auth)
    // PostgreSQL now() is transaction-start time and would accept a queued late
    // ballot. The clock must be sampled after acquiring the locks.
    const { rows: [{ time }] } = await db.raw('select clock_timestamp() as time')
    row = await apply(db, row, auth, time)
    await db('decision_commands').insert({ ...key, round_id: row.id, fingerprint })
    return present(db, row, userId, auth)
  })
}

export async function manageDecisionRound (userId, { input }) {
  return command(userId, input, 'manage', async (db, row, auth, time) => {
    const { action } = input
    if (!['create', 'update', 'open', 'close', 'cancel'].includes(action)) fail('DECISION_INVALID_INPUT')
    let changes
    if (action === 'create') {
      if (row || input.expectedVersion !== 0) fail('DECISION_CONFLICT')
      if (input.previousRoundId) {
        if (!uuid(input.previousRoundId)) fail('DECISION_INVALID_INPUT')
        const previous = await db('decision_rounds').where({ id: input.previousRoundId, post_id: input.postId, group_id: auth.groupId }).first()
        if (!previous || !['closed', 'cancelled'].includes(previous.phase)) fail('DECISION_INVALID_STATE')
      }
      const config = rules(validateDecisionConfig, input.config)
      const id = randomUUID()
      await db('decision_rounds').insert({
        id,
        post_id: input.postId,
        group_id: auth.groupId,
        phase: 'draft',
        version: 1,
        config: JSON.stringify(config),
        previous_round_id: input.previousRoundId || null,
        created_by: userId
      })
      row = await db('decision_rounds').where({ id }).first()
    } else {
      if (!row || row.version !== input.expectedVersion) fail('DECISION_CONFLICT')
      if (action !== 'update' && input.config != null) fail('DECISION_INVALID_INPUT')
      if (action === 'update') {
        if (row.phase !== 'draft') fail('DECISION_FROZEN')
        changes = { config: JSON.stringify(rules(validateDecisionConfig, input.config)) }
      } else if (action === 'open') {
        if (row.phase !== 'draft') fail('DECISION_INVALID_STATE')
        const config = rules(validateDecisionConfig, row.config)
        const electorate = await members(db, auth.groupId)
        if (config.minimum > electorate.length || new Date(config.deadline) <= time) fail('DECISION_INVALID_CONFIG')
        await db('decision_electorate').insert(electorate.map(member => ({ round_id: row.id, user_id: member.user_id })))
        changes = { phase: 'open', opened_at: time, electorate_count: electorate.length }
      } else {
        if ((action === 'close' && row.phase !== 'open') || (action === 'cancel' && !['draft', 'open'].includes(row.phase))) fail('DECISION_INVALID_STATE')
        changes = { phase: action === 'close' ? 'closed' : 'cancelled', closed_at: time }
      }
      await db('decision_rounds').where('id', row.id).update({ ...changes, version: row.version + 1 })
      row = await db('decision_rounds').where('id', row.id).first()
    }
    await db('decision_events').insert({ round_id: row.id, version: row.version, actor_id: userId, action })
    return row
  })
}

export async function submitDecisionBallot (userId, { input }) {
  return command(userId, input, 'ballot', async (db, row, auth, time) => {
    if (!row || row.phase !== 'open') fail('DECISION_INVALID_STATE')
    if (new Date(row.config.deadline) <= time) fail('DECISION_DEADLINE_PASSED')
    if (!await db('decision_electorate').where({ round_id: row.id, user_id: userId }).first()) fail('DECISION_NOT_ELIGIBLE')
    const previous = await ownBallot(db, row.id, userId)
    if ((previous?.version || 0) !== input.expectedVersion) fail('DECISION_CONFLICT')
    const answers = rules(validateDecisionBallot, row.config, input.state, input.answers)
    await db('decision_ballots').insert({ round_id: row.id, user_id: userId, version: input.expectedVersion + 1, state: input.state, answers: JSON.stringify(answers) })
    return row
  })
}
