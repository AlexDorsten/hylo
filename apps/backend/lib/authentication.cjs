// One server-side source for strategy registration, routes and browser controls.
function registrationEnabled (env = process.env) {
  const value = env.HYLO_REGISTRATION_ENABLED
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error('HYLO_REGISTRATION_ENABLED must be true or false')
}

function configuration (env = process.env) {
  const configured = (id, secret) => {
    if (!!env[id] !== !!env[secret]) throw new Error(`Configure both ${id} and ${secret}, or neither`)
    return !!env[id]
  }
  let oidc
  try { oidc = JSON.parse(env.HYLO_OIDC_PROVIDERS || '[]') } catch { throw new Error('HYLO_OIDC_PROVIDERS must be a JSON array') }
  if (!Array.isArray(oidc) || oidc.length > 8) throw new Error('Configure at most eight OIDC providers')
  const ids = new Set()
  for (const p of oidc) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(p.id) || ids.has(p.id)) throw new Error('OIDC provider IDs must be unique lowercase slugs')
    ids.add(p.id)
    for (const field of ['name', 'issuer', 'clientId', 'clientSecret']) {
      if (typeof p[field] !== 'string' || !p[field].trim()) throw new Error(`OIDC ${p.id}: missing ${field}`)
    }
    let issuer
    try { issuer = new URL(p.issuer) } catch { throw new Error(`OIDC ${p.id}: invalid issuer URL`) }
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || p.issuer.length > 512 || (issuer.href !== p.issuer && issuer.origin !== p.issuer)) {
      throw new Error(`OIDC ${p.id}: issuer must be an exact HTTPS URL without credentials, query or fragment`)
    }
    if (p.name.length > 80 || !['client_secret_basic', 'client_secret_post'].includes(p.tokenEndpointAuthMethod || 'client_secret_basic')) throw new Error(`OIDC ${p.id}: invalid name or token endpoint authentication method`)
  }
  const origin = `${env.PROTOCOL}://${env.DOMAIN}`
  if (oidc.length) {
    let url
    try { url = new URL(origin) } catch { throw new Error('OIDC requires a valid PROTOCOL and DOMAIN') }
    if (url.origin !== origin || url.protocol !== 'https:') throw new Error('OIDC requires an HTTPS public origin without a path')
  }
  return {
    origin,
    registration: registrationEnabled(env),
    google: configured('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    linkedin: configured('LINKEDIN_API_KEY', 'LINKEDIN_API_SECRET'),
    oidc: oidc.map(({ id, name, issuer, clientId, clientSecret, tokenEndpointAuthMethod }) => ({ id, name, issuer, clientId, clientSecret, tokenEndpointAuthMethod }))
  }
}

function capabilities (config = configuration()) {
  return { password: true, registration: config.registration, google: config.google, oidc: config.oidc.map(({ id, name }) => ({ id, name, loginUrl: `/noo/login/oidc/${id}` })) }
}

function explicitId (value, list) {
  const id = String(value || '')
  return /^[1-9][0-9]*$/.test(id) && (list || '').split(',').some(entry => entry.trim() === id)
}

module.exports = { configuration, capabilities, explicitId, registrationEnabled }
