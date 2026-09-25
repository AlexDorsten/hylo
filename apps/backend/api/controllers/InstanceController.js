const { paymentsEnabled } = require('../../lib/payments.cjs')

module.exports = {
  capabilities: (req, res) => res.json({ payments: paymentsEnabled() })
}
