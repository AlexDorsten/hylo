const assert = require('node:assert/strict')
const groupId = '8000000000005'
const postId = '8000000000002'
const users = ['8000000000001', '8000000000006', '8000000000007']
const first = '80000000-0000-4000-8000-000000000001'
const second = '80000000-0000-4000-8000-000000000002'
const requestId = '80000000-0000-4000-8000-000000000003'
const timestamp = new Date('2026-09-26T12:00:00Z')
const config = { method: 'systemic_consensus', question: 'Where to meet?', purpose: 'Review concerns.', minimum: 3, deadline: '2099-01-01T12:00:00Z', options: [
  { id: 'a', label: 'Community room', passive: false }, { id: 'b', label: 'Library', passive: false }, { id: 'p', label: 'Keep meeting online', passive: true }
] }
const answers = scores => scores.map((score, index) => ({ optionId: ['a', 'b', 'p'][index], score }))
const votes = [[0, 3, 5], [4, 3, 5], [8, 3, 5]]
const ballots = users.flatMap((id, index) => [
  { round_id: first, user_id: id, version: 1, state: 'abstained', answers: [], created_at: timestamp },
  { round_id: first, user_id: id, version: 2, state: 'vote', answers: answers(votes[index]), created_at: timestamp }
])
const events = [['create', 1], ['open', 2], ['close', 3]].map(([action, version]) => ({ round_id: first, actor_id: users[0], action, version, created_at: timestamp }))
const command = { post_id: postId, user_id: users[0], request_id: requestId, round_id: first, fingerprint: 'a'.repeat(64), created_at: timestamp }

exports.write = async db => db.transaction(async trx => {
  await trx('groups').insert({ id: groupId, name: 'Release rehearsal group', slug: 'release-rehearsal', visibility: 0, active: true })
  await trx('groups_posts').insert({ post_id: postId, group_id: groupId })
  await trx('decision_rounds').insert({ id: first, post_id: postId, group_id: groupId, phase: 'draft', version: 1, config: JSON.stringify(config), created_by: users[0], created_at: timestamp })
  await trx('decision_electorate').insert(users.map(id => ({ round_id: first, user_id: id })))
  await trx('decision_rounds').where({ id: first }).update({ phase: 'open', version: 2, electorate_count: 3, opened_at: timestamp })
  await trx('decision_ballots').insert(ballots.map(row => ({ ...row, answers: JSON.stringify(row.answers) })))
  await trx('decision_rounds').where({ id: first }).update({ phase: 'closed', version: 3, closed_at: timestamp })
  await trx('decision_events').insert(events)
  await trx('decision_commands').insert(command)
  await trx('decision_rounds').insert({ id: second, post_id: postId, group_id: groupId, previous_round_id: first, phase: 'draft', version: 1, config: JSON.stringify(config), created_by: users[0], created_at: timestamp })
})
exports.verify = async db => {
  const original = await db('decision_rounds').where({ id: first }).first()
  assert.deepEqual(original.config, config)
  assert.equal(original.phase, 'closed')
  assert.equal(original.electorate_count, 3)
  assert.equal(original.version, 3)
  assert.deepEqual(original.closed_at, timestamp)
  assert.deepEqual(await db('decision_electorate').where({ round_id: first }).orderBy('user_id'), users.map(id => ({ round_id: first, user_id: id })))
  assert.deepEqual(await db('decision_ballots').where({ round_id: first }).orderBy('user_id').orderBy('version'), ballots)
  assert.deepEqual(await db('decision_events').where({ round_id: first }).orderBy('version'), events)
  assert.deepEqual(await db('decision_commands').where({ request_id: requestId }).first(), command)
  const totals = await db.raw(`SELECT answer->>'optionId' AS option, sum((answer->>'score')::int)::int AS total FROM
    (SELECT DISTINCT ON (user_id) * FROM decision_ballots WHERE round_id=? ORDER BY user_id,version DESC) b,
    jsonb_array_elements(b.answers) answer WHERE state='vote' GROUP BY option ORDER BY option`, [first])
  assert.deepEqual(totals.rows, [{ option: 'a', total: 12 }, { option: 'b', total: 9 }, { option: 'p', total: 15 }])
  const next = await db('decision_rounds').where({ id: second }).first()
  assert.equal(next.previous_round_id, first)
  assert.equal(next.phase, 'draft')
  assert.equal((await db('decision_ballots').where({ round_id: second })).length, 0)
  await assert.rejects(db('decision_rounds').where({ id: first }).update({ config: JSON.stringify({ ...config, question: 'Tampered' }) }), /Frozen decision round/)
}
