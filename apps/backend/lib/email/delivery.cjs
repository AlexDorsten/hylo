const { readFileSync } = require('node:fs')
const { renderAccount } = require('./templates/account.cjs')

const legacyTemplates = {
  'email-verification': 'tem_h99yGHv9MXTpMrPSDVTjQFyB',
  'password-reset': 'tem_phRPHm3y6RHvRFww6Vc3VBVB',
  'finish-registration': 'tem_fqGSrDrSK6WpjTBFXSfY79k4',
  invitation: 'tem_GTwXKBfkTpTHRfHpmJWbYr9d'
}
const accountTemplates = new Set(Object.keys(legacyTemplates))
const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/

function configuration (env = process.env) {
  const provider = env.EMAIL_PROVIDER || (env.SENDWITHUS_KEY ? 'sendwithus' : 'none')
  if (!['none', 'smtp', 'sendwithus'].includes(provider)) throw new Error('Invalid EMAIL_PROVIDER')
  if (provider === 'none') return { provider }
  if (!address.test(env.EMAIL_SENDER || '')) throw new Error('EMAIL_SENDER must be a single email address')
  if (provider === 'sendwithus') {
    if (!env.SENDWITHUS_KEY) throw new Error('SENDWITHUS_KEY is required')
    return { provider, key: env.SENDWITHUS_KEY }
  }
  if (env.EMAIL_NOTIFICATIONS_ENABLED !== 'false') throw new Error('SMTP currently requires EMAIL_NOTIFICATIONS_ENABLED=false; notification templates are not yet ported')
  const mode = env.SMTP_TLS_MODE || 'starttls'
  const port = Number(env.SMTP_PORT || (mode === 'tls' ? 465 : 587))
  if (!env.SMTP_HOST || /[\s/@]/.test(env.SMTP_HOST) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP_HOST or SMTP_PORT')
  if (!['tls', 'starttls', 'plain'].includes(mode)) throw new Error('Invalid SMTP_TLS_MODE')
  if (mode === 'plain' && (env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(env.SMTP_HOST))) throw new Error('Plain SMTP is restricted to local development/test sinks')
  if (env.SMTP_PASSWORD && env.SMTP_PASSWORD_FILE) throw new Error('Use SMTP_PASSWORD or SMTP_PASSWORD_FILE, not both')
  let password = env.SMTP_PASSWORD
  if (env.SMTP_PASSWORD_FILE) {
    try {
      const content = readFileSync(env.SMTP_PASSWORD_FILE, 'utf8')
      if (content.length > 65536) throw new Error()
      password = content.replace(/\r?\n$/, '')
    } catch { throw new Error('Unable to read SMTP_PASSWORD_FILE') }
  }
  if (!!env.SMTP_USER !== !!password) throw new Error('SMTP_USER and SMTP password must be supplied together')
  let origin
  try {
    origin = new URL(`${env.PROTOCOL}://${env.DOMAIN}`)
    if (origin.origin !== `${env.PROTOCOL}://${env.DOMAIN}` || !['http:', 'https:'].includes(origin.protocol)) throw new Error()
    if (env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error()
  } catch { throw new Error('A valid public PROTOCOL and DOMAIN are required for SMTP mail links') }
  return {
    provider,
    origin: origin.origin,
    sender: { address: env.EMAIL_SENDER, name: env.EMAIL_SENDER_NAME || 'Hylo' },
    transport: {
      host: env.SMTP_HOST,
      port,
      secure: mode === 'tls',
      requireTLS: mode === 'starttls',
      ignoreTLS: mode === 'plain',
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: password } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true
    }
  }
}

function deliveryError (code = 'EMAIL_DELIVERY_FAILED') {
  const error = new Error(code)
  error.name = 'EmailDeliveryError'
  error.code = code
  return error
}

function createDelivery (env = process.env) {
  const config = configuration(env)
  let smtp
  let hosted
  return async opts => {
    const template = opts.email_id
    if (config.provider === 'smtp' && !accountTemplates.has(template)) {
      // This first SMTP slice supports transaction mail only. Never claim an
      // unsupported requested export/custom template was sent successfully.
      throw deliveryError('EMAIL_TEMPLATE_UNAVAILABLE')
    }
    if (config.provider === 'none') throw deliveryError('EMAIL_PROVIDER_UNCONFIGURED')
    try {
      if (config.provider === 'sendwithus') {
        hosted ||= require('sendwithus')(config.key)
        return await new Promise((resolve, reject) => hosted.send({ ...opts, email_id: legacyTemplates[template] || template }, (error, response) => error ? reject(error) : resolve(response || true)))
      }
      if (!address.test(opts.recipient?.address || '')) throw deliveryError('EMAIL_RECIPIENT_INVALID')
      const content = renderAccount(template, opts.email_data || {}, opts.locale, config.origin)
      smtp ||= require('nodemailer').createTransport(config.transport)
      const result = await smtp.sendMail({
        ...content,
        from: config.sender,
        to: { address: opts.recipient.address },
        ...(address.test(opts.sender?.reply_to || '') ? { replyTo: { address: opts.sender.reply_to } } : {}),
        headers: { 'X-Auto-Response-Suppress': 'All' },
        disableFileAccess: true,
        disableUrlAccess: true
      })
      if (!result.accepted?.length || result.rejected?.length) throw deliveryError()
      return true
    } catch (error) {
      // SMTP response lines, addresses and provider errors can contain tokens or
      // message content. Do not attach a cause or log the input here.
      throw deliveryError(['EMAIL_TEMPLATE_INVALID', 'EMAIL_RECIPIENT_INVALID'].includes(error.message) ? error.message : undefined)
    }
  }
}

module.exports = { configuration, createDelivery, deliveryError }
