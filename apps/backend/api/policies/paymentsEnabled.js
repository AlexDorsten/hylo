const { paymentsEnabled } = require('../../lib/payments.cjs')

module.exports = (req, res, next) => paymentsEnabled()
  ? next()
  : res.status(503).json({ error: 'PAYMENTS_DISABLED' })
