const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isDecisionRequest } = require('../../apps/backend/lib/decisionPrivacy')
const loadBackend = require('./helpers/load-backend.cjs')
const { createRequire } = require('node:module')
const backendRequire = createRequire(require.resolve('../../apps/backend/package.json'))

test('private decision requests are recognized with aliases, inline inputs, fragments and serialized telemetry bodies', () => {
  for (const query of [
    'mutation { alias: submitDecisionBallot(input: {answers: [{optionId: "a", score: 4}]}) {id} }',
    'mutation Save($input: ManageDecisionInput!) { manageDecisionRound(input: $input) {id} }',
    'query { ...Private } fragment Private on Query { decisionRounds(postId: "1") { rounds {id} } }'
  ]) {
    assert.equal(isDecisionRequest({ query }), true)
    assert.equal(isDecisionRequest({ data: JSON.stringify({ query, variables: {} }) }), true)
    assert.equal(isDecisionRequest({ url: '/noo/graphql?query=' + encodeURIComponent(query) }), true)
  }
  assert.equal(isDecisionRequest(null), false)
  assert.equal(isDecisionRequest({ query: 'query { me {id} }' }), false)
})

test('enabled telemetry drops private decision bodies and custom GET request contexts before delivery', () => {
  let options
  loadBackend('lib/sentry.js', {
    env: { NODE_ENV: 'production', SENTRY_DSN: 'https://synthetic@example.invalid/1' },
    mocks: { '@sentry/node': { init: value => { options = value } } }
  })
  const query = 'mutation { private: submitDecisionBallot(input: {answers: [{optionId:"a", score:4}]}) {id} }'
  assert.equal(options.beforeSend({ request: { data: JSON.stringify({ query }) } }), null)
  assert.equal(options.beforeSend({ contexts: { request: { url: '/noo/graphql?query=' + encodeURIComponent(query) } } }), null)
  const ordinary = { request: { url: '/health' }, message: 'Synthetic ordinary error' }
  assert.equal(options.beforeSend(ordinary), ordinary)
})

test('GraphQL diagnostics suppress private payloads and exception details without disabling ordinary error reporting', async () => {
  let options
  const logs = []; const reports = []
  loadBackend('api/graphql/index.js', {
    env: { DEBUG_GRAPHQL: '1', AUTH_DEBUG: '1' },
    globals: { Error, sails: { log: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) } } },
    mocks: {
      'graphql-yoga': { createYoga: value => { options = value; return {} }, maskError: (error, message) => ({ message, originalError: error }) },
      '../services/RedisPubSub': {}, './makeSchema': () => {}, './filters': { createGroupVisibilityLoader: () => ({}) },
      '../../lib/sentry': { captureException: (...args) => reports.push(args) }
    }
  })
  const privateContext = await options.context({ req: { session: {}, headers: {} }, params: {
    query: 'mutation { submitDecisionBallot(input: {answers: [{optionId:"a", score:4}]}) {id} }',
    variables: { syntheticPrivateValue: 'must-not-be-logged' }
  } })
  assert.equal(privateContext.privateDecision, true)
  assert.equal(logs.length, 0)
  let execute
  options.plugins[0].onExecute({
    args: { contextValue: privateContext },
    setExecuteFn: value => { execute = value },
    executeFn: async () => { await Promise.resolve(); return options.maskedErrors.maskError(new Error('SQL bindings: must-not-be-logged'), 'Unexpected error.', true) }
  })
  const masked = await execute({ contextValue: privateContext })
  assert.equal(masked.originalError.message, 'Decision round request failed')
  assert.equal(reports.length, 0)
  assert.equal(logs.length, 1)
  assert.equal(JSON.stringify(logs).includes('must-not-be-logged'), false)
  options.maskedErrors.maskError(new Error('Synthetic ordinary resolver failure'), 'Unexpected error.', false)
  assert.equal(reports.length, 1)
})

test('real Yoga result hooks and its own logger never receive private resolver details', async () => {
  const realYoga = backendRequire('graphql-yoga')
  const { buildSchema, GraphQLError } = backendRequire('graphql')
  const schema = buildSchema('type Query { decisionRounds(denied: Boolean): String ordinary: String }')
  const secret = 'synthetic-private-SQL-binding-0-3-5'
  for (const [name, field] of Object.entries(schema.getQueryType().getFields())) {
    field.resolve = async (_, args) => {
      await Promise.resolve()
      if (args.denied) throw new GraphQLError('DECISION_ACCESS_DENIED', { extensions: { code: 'DECISION_ACCESS_DENIED' } })
      throw new Error(name === 'ordinary' ? 'synthetic-ordinary-resolver-failure' : secret)
    }
  }
  const logs = []; const reports = []
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)]))
  const { yoga } = loadBackend('api/graphql/index.js', {
    env: { DEBUG_GRAPHQL: '1', AUTH_DEBUG: '1' },
    globals: { Error, sails: { log: logger } },
    mocks: {
      'graphql-yoga': { ...realYoga, createYoga: options => realYoga.createYoga({ ...options, schema, logging: logger, maskedErrors: { ...options.maskedErrors, isDev: true } }) },
      '../services/RedisPubSub': {}, './makeSchema': () => {}, './filters': { createGroupVisibilityLoader: () => ({}) },
      '../../lib/sentry': { captureException: (...args) => reports.push(args) }
    }
  })
  const request = query => yoga.fetch('http://localhost/noo/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: query.includes('decisionRounds') ? { privateCanary: secret } : {} })
  }, { req: { session: {}, headers: {} } }).then(response => response.json())
  const result = await request('{ decisionRounds }')
  assert.equal(result.errors[0].message, 'Unexpected error.')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(reports.length, 0)
  assert.equal(require('node:util').inspect(logs).includes(secret), false)
  const [denied] = await Promise.all([request('{ decisionRounds(denied: true) }'), request('{ ordinary }'), request('{ decisionRounds }')])
  assert.equal(denied.errors[0].extensions.code, 'DECISION_ACCESS_DENIED')
  assert.equal(reports.length, 1)
  assert.equal(require('node:util').inspect(logs).includes(secret), false)
  assert.equal(require('node:util').inspect(reports).includes(secret), false)
})
