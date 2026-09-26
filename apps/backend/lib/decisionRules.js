// Pure rules; the API owns authorization, serialization and persistence.
export function validateDecisionConfig (input) {
  if (!input || !['single_choice', 'systemic_consensus'].includes(input.method) ||
    typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2000 ||
    typeof input.purpose !== 'string' || !input.purpose.trim() || input.purpose.length > 4000 ||
    !Number.isInteger(input.minimum) || input.minimum < 1 ||
    typeof input.deadline !== 'string' || !Number.isFinite(Date.parse(input.deadline)) ||
    !Array.isArray(input.options) || input.options.length < 2 || input.options.length > 20 ||
    input.options.some(o => !o || typeof o.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(o.id) ||
      typeof o.label !== 'string' || !o.label.trim() || o.label.length > 1000 || typeof o.passive !== 'boolean') ||
    new Set(input.options.map(o => o.id)).size !== input.options.length ||
    new Set(input.options.map(o => o.label.trim())).size !== input.options.length ||
    (input.method === 'systemic_consensus' && input.options.filter(o => o.passive).length !== 1) ||
    (input.method === 'single_choice' && input.options.some(o => o.passive))) throw new Error('DECISION_INVALID_CONFIG')
  return {
    method: input.method,
    question: input.question.trim(),
    purpose: input.purpose.trim(),
    minimum: input.minimum,
    deadline: new Date(input.deadline).toISOString(),
    options: input.options.map(({ id, label, passive }) => ({ id, label: label.trim(), passive }))
  }
}

export function validateDecisionBallot (config, state, answers) {
  if (!['vote', 'abstained', 'withdrawn'].includes(state) || !Array.isArray(answers)) throw new Error('DECISION_INVALID_BALLOT')
  if (state !== 'vote') {
    if (answers.length) throw new Error('DECISION_INVALID_BALLOT')
    return []
  }
  if (!['single_choice', 'systemic_consensus'].includes(config.method)) throw new Error('DECISION_UNSUPPORTED_METHOD')
  const ids = new Set(config.options.map(o => o.id))
  if (answers.some(a => !a || typeof a.optionId !== 'string')) throw new Error('DECISION_INVALID_BALLOT')
  if (new Set(answers.map(a => a.optionId)).size !== answers.length || answers.some(a => !ids.has(a.optionId)) ||
    (config.method === 'single_choice' && (answers.length !== 1 || answers[0].score != null)) ||
    (config.method === 'systemic_consensus' && (answers.length !== ids.size ||
      answers.some(a => !Number.isInteger(a.score) || a.score < 0 || a.score > 10)))) throw new Error('DECISION_INVALID_BALLOT')
  return answers.map(a => ({ optionId: a.optionId, ...(config.method === 'systemic_consensus' ? { score: a.score } : {}) }))
}

export function decisionResult (config, electorateCount, ballots) {
  const votes = ballots.filter(b => b.state === 'vote')
  const abstentions = ballots.filter(b => b.state === 'abstained').length
  const resistance = config.method === 'systemic_consensus'
  if (!resistance && config.method !== 'single_choice') throw new Error('DECISION_UNSUPPORTED_METHOD')
  const options = config.options.map(option => {
    const distribution = Array(11).fill(0)
    let total = 0
    for (const ballot of votes) {
      const answer = ballot.answers.find(a => a.optionId === option.id)
      if (resistance) { total += answer.score; distribution[answer.score]++ } else if (answer) total++
    }
    return { ...option, total, mean: votes.length ? total / votes.length : null, distribution: resistance ? distribution : [] }
  })
  // No ranking without an assessment. Ties retain every best option.
  if (votes.length) options.sort((a, b) => resistance ? a.total - b.total : b.total - a.total)
  const best = votes.length ? options.filter(o => o.total === options[0].total) : []
  const status = !votes.length
    ? 'no_ballots'
    : votes.length < config.minimum
      ? 'insufficient'
      : best.length > 1 ? 'tie' : best[0].passive ? 'passive_preferred' : 'assessed'
  return {
    status,
    eligible: electorateCount,
    complete: votes.length,
    abstentions,
    missing: electorateCount - votes.length - abstentions,
    options,
    bestOptionIds: best.map(o => o.id)
  }
}
