import RedisClient from '../services/RedisClient'
const { configuration, capabilities } = require('../../lib/authentication.cjs')
const { createClient, linkLimitScript } = require('../../lib/externalOidc.cjs')
const { resolveIdentity } = require('../../lib/oidcIdentity.cjs')

let oidc
const settingsPath = '/my/account'
const sessionAction = (req, action) => new Promise((resolve, reject) => req.session[action](error => error ? reject(error) : resolve()))
const getClient = () => {
  if (!oidc) oidc = createClient({ config: configuration(), redis: RedisClient.create('external-oidc') })
  return oidc
}
const privateResponse = res => {
  res.set('Cache-Control', 'no-store')
  res.set('Referrer-Policy', 'no-referrer')
}

module.exports = {
  capabilities (req, res) {
    privateResponse(res)
    return res.json(capabilities())
  },

  async start (req, res) {
    privateResponse(res)
    try {
      if (req.session.userId) return res.redirect(settingsPath)
      // Persist even a previously untouched anonymous session before redirect.
      req.session.oidcStarted = true
      await sessionAction(req, 'save')
      return res.redirect(await getClient().start(req.params.providerId, req.sessionID))
    } catch {
      return res.redirect('/login?oidcError=1')
    }
  },

  async link (req, res) {
    privateResponse(res)
    try {
      if (!req.session.userId || req.get('origin') !== configuration().origin || !req.is('application/json')) return res.status(403).json({ error: 'Forbidden' })
      const redis = RedisClient.create('external-oidc')
      const limitKey = `oidc:link-limit:${req.session.userId}`
      const attempts = await redis.eval(linkLimitScript, 1, limitKey)
      if (attempts > 5) return res.status(429).json({ error: 'Try again later' })
      const currentUser = await User.find(req.session.userId)
      if (!currentUser || !currentUser.get('email_validated') || typeof req.body.password !== 'string') throw new Error('Account unavailable')
      const user = await User.authenticate(currentUser.get('email'), req.body.password)
      if (String(user.id) !== String(req.session.userId) || !user.get('active')) throw new Error('Account unavailable')
      // Credentials are checked for every link request, never accepted from an
      // old login timestamp or from untrusted provider email claims.
      const authorizationUrl = await getClient().start(req.params.providerId, req.sessionID, String(user.id))
      return res.json({ authorizationUrl })
    } catch {
      return res.status(403).json({ error: 'Unable to connect sign-in provider' })
    }
  },

  async callback (req, res) {
    privateResponse(res)
    let linking = !!req.session.userId
    try {
      // Use the raw query to preserve duplicate-parameter validation, but build
      // the callback origin from configuration rather than forwarded headers.
      const query = req.originalUrl.split('?').slice(1).join('?')
      const identity = await getClient().finish(req.params.providerId, req.sessionID, query)
      linking = !!identity.userId
      if ((linking && String(req.session.userId) !== identity.userId) || (!linking && req.session.userId)) throw new Error('Session changed')
      const userId = await resolveIdentity(bookshelf.knex, identity, identity.userId)
      const user = await User.find(userId)
      if (!user) throw new Error('Account unavailable')
      req.userId = user.id
      await sessionAction(req, 'regenerate')
      await UserSession.login(req, user, 'external-oidc')
      await sessionAction(req, 'save')
      return res.redirect(linking ? `${settingsPath}?oidcLinked=1` : '/')
    } catch {
      // Never send provider errors, codes, tokens or account-existence details
      // into logs, analytics or the browser URL.
      return res.redirect(linking ? `${settingsPath}?oidcError=1` : '/login?oidcError=1')
    }
  }
}
