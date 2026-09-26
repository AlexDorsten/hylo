const { configuration } = require('../../lib/authentication.cjs')
const { renderRecoveryPage } = require('../../lib/passwordRecoveryPage.cjs')

function privateResponse (res) {
  res.set('Cache-Control', 'no-store')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
}

module.exports = {
  show (req, res) {
    privateResponse(res)
    const { html, csp } = renderRecoveryPage(req.acceptsLanguages('de', 'en'))
    res.set('Content-Security-Policy', csp)
    res.type('html')
    return res.send(html)
  },

  async complete (req, res) {
    privateResponse(res)
    if (req.get('origin') !== configuration().origin || !req.is('application/json')) return res.status(403).json({ error: 'Forbidden' })
    try {
      const { token, password, confirmation } = req.body || {}
      await PasswordRecovery.complete({ token, password, confirmation, ip: req.ip })
      return res.json({ success: true })
    } catch (error) {
      const expected = ['RECOVERY_UNAVAILABLE', 'RECOVERY_PASSWORD_INVALID'].includes(error.message)
      return res.status(expected ? 400 : 503).json({ error: expected ? error.message : 'RECOVERY_UNAVAILABLE' })
    }
  }
}
