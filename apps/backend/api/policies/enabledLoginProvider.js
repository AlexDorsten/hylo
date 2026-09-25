const { configuration } = require('../../lib/authentication.cjs')

module.exports = (req, res, next) => {
  const provider = req.path.split('/')[3]?.replace(/-token$/, '')
  const config = configuration()
  if ((provider === 'google' && config.google) || (provider === 'linkedin' && config.linkedin)) return next()
  return res.notFound()
}
