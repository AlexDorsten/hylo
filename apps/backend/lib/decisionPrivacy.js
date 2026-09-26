// Conservative match: aliases and inline inputs still contain the actual field
// name. Also matches serialized HTTP/Sentry bodies; false positives are safe.
const decisionField = /\b(?:decisionRounds|manageDecisionRound|submitDecisionBallot)\b/
function isDecisionRequest (value) {
  if (value == null) return false
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (decisionField.test(serialized)) return true
  try { return decisionField.test(decodeURIComponent(serialized)) } catch (_) { return false }
}
module.exports = { isDecisionRequest }
