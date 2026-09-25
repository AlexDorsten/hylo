const { randomBytes, createHash } = require('node:crypto')

const ttl = 30 * 60
const digest = value => createHash('sha256').update(value).digest('hex')
const tokenKey = token => 'password-recovery:token:' + digest(token)
const fingerprint = accounts => digest(JSON.stringify(accounts.map(a => [String(a.id), a.provider_user_id])))
const limitScript = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 900) end
return n`
// Older password logins retain an anonymous session ID. Match the stored user,
// not the key prefix, and compare/delete atomically in case the session changes.
const revokeSessionScript = `local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, session = pcall(cjson.decode, raw)
if ok and type(session) == 'table' and tostring(session.userId) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`
const unavailable = () => new Error('RECOVERY_UNAVAILABLE')

function createRecovery ({ knex, redis, origin, validatePassword, hashPassword, deliver, enqueue }) {
  const url = new URL(origin)
  if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Recovery requires a fixed HTTPS origin')
  const passwords = (db, id) => db('linked_account').where({ user_id: id, provider_key: 'password' }).orderBy('id')
  const limited = async (kind, value, max) => (await redis.eval(limitScript, 1, `password-recovery:limit:${kind}:${digest(String(value || 'unknown'))}`)) > max

  return {
    async request ({ email, ip }) {
      if (await limited('request-ip', ip, 10)) return
      if (typeof email !== 'string' || email.length > 254) return
      email = email.trim().toLowerCase()
      if (!email.includes('@') || await limited('email', email, 3)) return
      // Queue even unknown addresses: account lookup and mail delivery must not
      // affect the response body or latency of the public request endpoint.
      await enqueue({ email })
    },

    async send ({ email }) {
      const user = await knex('users').whereRaw('lower(email) = ?', [email]).where({ active: true, email_validated: true }).first()
      if (!user) return
      const accounts = await passwords(knex, user.id)
      if (accounts.length > 1) return
      const token = randomBytes(32).toString('base64url')
      const state = { purpose: 'password-reset', userId: String(user.id), email: user.email, fingerprint: fingerprint(accounts), expiresAt: Date.now() + ttl * 1000 }
      await redis.set(tokenKey(token), JSON.stringify(state), 'EX', ttl)
      try {
        await deliver({
          email: user.email,
          locale: user.settings?.locale || 'en',
          templateData: { login_url: `${origin}/noo/password-reset#${token}` }
        })
      } catch {
        await redis.del(tokenKey(token))
        // Queue retries are safe, but SMTP diagnostics and tokens are private.
        throw new Error('RECOVERY_DELIVERY_FAILED')
      }
    },

    async complete ({ token, password, confirmation, ip }) {
      if (await limited('complete-ip', ip, 30)) throw unavailable()
      if (typeof password !== 'string' || password !== confirmation || Buffer.byteLength(password, 'utf8') > 72 || validatePassword(password)) throw new Error('RECOVERY_PASSWORD_INVALID')
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable()
      // Claim before touching the database. A database/Redis failure consumes
      // this link and fails closed; the user can request a new one.
      const raw = await redis.getdel(tokenKey(token))
      if (!raw) throw unavailable()
      const state = JSON.parse(raw)
      if (state.purpose !== 'password-reset' || state.expiresAt <= Date.now()) throw unavailable()
      const hashed = await hashPassword(password)
      await knex.transaction(async trx => {
        const user = await trx('users').where({ id: state.userId, active: true, email_validated: true }).forUpdate().first()
        if (!user || user.email !== state.email) throw unavailable()
        const accounts = await passwords(trx, user.id).forUpdate()
        if (accounts.length > 1 || fingerprint(accounts) !== state.fingerprint) throw unavailable()
        if (accounts.length) await trx('linked_account').where({ id: accounts[0].id }).update({ provider_user_id: hashed })
        else await trx('linked_account').insert({ user_id: user.id, provider_key: 'password', provider_user_id: hashed })

        // Revoke server-side OIDC grants/tokens as part of the same transaction.
        const grants = trx('oidc_payloads').select('grant_id').whereRaw("payload->>'accountId' = ?", [state.userId]).whereNotNull('grant_id')
        await trx('oidc_payloads').whereRaw("payload->>'accountId' = ?", [state.userId]).orWhereIn('grant_id', grants).del()
        let cursor = '0'
        do {
          const result = await redis.scan(cursor, 'MATCH', 'sess:*', 'COUNT', 100)
          cursor = result[0]
          for (const key of result[1]) await redis.eval(revokeSessionScript, 1, key, state.userId)
        } while (cursor !== '0')
      })
      // Never create a browser session or mint login/access tokens here.
    }
  }
}

module.exports = { createRecovery, tokenKey, ttl }
