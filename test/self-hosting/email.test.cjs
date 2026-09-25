const assert = require('node:assert/strict')
const { test } = require('node:test')
const net = require('node:net')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { configuration, createDelivery } = require('../../apps/backend/lib/email/delivery.cjs')
const { renderAccount } = require('../../apps/backend/lib/email/templates/account.cjs')
const loadBackend = require('./helpers/load-backend.cjs')
const base = { EMAIL_PROVIDER: 'smtp', EMAIL_NOTIFICATIONS_ENABLED: 'false', EMAIL_SENDER: 'community@example.org', SMTP_HOST: 'smtp.example.org', PROTOCOL: 'https', DOMAIN: 'hylo.example.org', NODE_ENV: 'production' }

test('SMTP validates TLS, optional authentication and sender without exposing secrets', t => {
  const config = configuration(base)
  assert.equal(config.transport.requireTLS, true)
  assert.equal(config.transport.tls.rejectUnauthorized, true)
  assert.equal(config.transport.auth, undefined)
  assert.equal(config.transport.disableFileAccess, true)
  assert.equal(config.transport.disableUrlAccess, true)
  assert.equal(configuration({ ...base, SMTP_TLS_MODE: 'tls' }).transport.secure, true)
  assert.equal(configuration({ ...base, SMTP_USER: 'account', SMTP_PASSWORD: 'secret' }).transport.auth.pass, 'secret')
  for (const patch of [{ SMTP_TLS_MODE: 'plain' }, { SMTP_TLS_MODE: 'bogus' }, { SMTP_USER: 'account' }, { SMTP_PASSWORD: 'secret' }, { SMTP_PORT: '587x' }, { SMTP_PORT: '-1' }, { EMAIL_SENDER: 'bad\r\nBcc: recipient@example.org' }, { PROTOCOL: 'http' }, { DOMAIN: 'hylo.example.org/escape' }, { SMTP_PASSWORD_FILE: '/nonexistent', SMTP_PASSWORD: 'secret' }, { EMAIL_NOTIFICATIONS_ENABLED: 'true' }]) assert.throws(() => configuration({ ...base, ...patch }))
  assert.deepEqual(configuration({}), { provider: 'none' })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hylo-smtp-secret-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const secretFile = path.join(directory, 'password')
  fs.writeFileSync(secretFile, 'synthetic-secret\n', { mode: 0o600 })
  assert.equal(configuration({ ...base, SMTP_USER: 'account', SMTP_PASSWORD_FILE: secretFile }).transport.auth.pass, 'synthetic-secret')
})

test('SMTP notification opt-out preserves mandatory account mail and exposes unsupported exports', async () => {
  const sent = []
  const email = loadBackend('api/services/Email.js', {
    env: { EMAIL_PROVIDER: 'smtp', EMAIL_NOTIFICATIONS_ENABLED: 'false' },
    mocks: {
      '../../lib/email/delivery.cjs': {
        createDelivery: () => async opts => {
          if (opts.email_id.startsWith('tem_')) throw new Error('EMAIL_TEMPLATE_UNAVAILABLE')
          sent.push(opts.email_id)
          return true
        }
      }
    }
  })
  for (const method of ['sendPasswordReset', 'sendEmailVerification', 'sendFinishRegistration']) {
    assert.equal(await email[method]({ email: 'member@example.org', templateData: {}, locale: 'de' }), true)
  }
  assert.equal(await email.sendInvitation('member@example.org', { locale: 'de' }), true)
  assert.equal(await email.sendPostNotification({ email: 'member@example.org' }), false)
  assert.equal(await email.sendWelcomeEmail({ email: 'member@example.org' }), false)
  await assert.rejects(email.sendExportUserAccount({ email: 'member@example.org' }), /EMAIL_TEMPLATE_UNAVAILABLE/)
  assert.deepEqual(sent, ['password-reset', 'email-verification', 'finish-registration', 'invitation'])
})

test('local account templates escape content, preserve origin and fall back to English', () => {
  const data = { group_name: '<script>group</script>', inviter_name: 'A & B', message: '<img src=x onerror=evil()>', invite_link: 'https://hylo.example.org/invite?token=private&email=member' }
  const result = renderAccount('invitation', data, 'de-DE', 'https://hylo.example.org')
  assert.equal(result.subject, 'Du wurdest eingeladen')
  assert.match(result.html, /&lt;script&gt;/)
  assert.match(result.html, /&amp;email=/)
  assert.doesNotMatch(result.html, /<script>|<img /)
  assert.match(result.text, /private&email/)
  assert.equal(renderAccount('invitation', data, 'fr', 'https://hylo.example.org').subject, 'You have been invited')
  for (const inviteLink of ['javascript:alert(1)', 'https://evil.example.org/invite', 'https://user:pass@hylo.example.org/invite', undefined]) assert.throws(() => renderAccount('invitation', { ...data, invite_link: inviteLink }, 'en', 'https://hylo.example.org'))
  for (const [template, key] of [['email-verification', 'verify_url'], ['password-reset', 'login_url'], ['finish-registration', 'verify_url']]) {
    const content = renderAccount(template, { code: '012345', [key]: 'https://hylo.example.org/verify?token=private' }, 'en', 'https://hylo.example.org')
    assert.match(content.text, template === 'password-reset' ? /once.*30 minutes/ : /four hours/)
    assert.match(content.html, /https:\/\/hylo.example.org/)
  }
})

// A disposable SMTP peer: test Nodemailer itself and delivery acknowledgement,
// including an actual rejected DATA followed by a successful retry.
async function sink (t) {
  const messages = []
  let reject = false
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    socket.write('220 test.example.org ESMTP\r\n')
    let buffer = ''; let data = null
    socket.on('data', chunk => {
      buffer += chunk
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        if (data !== null) {
          if (line === '.') {
            messages.push(data.join('\r\n')); data = null
            socket.write(reject ? '451 secret-link-and-address delivery failed\r\n' : '250 queued\r\n')
          } else data.push(line)
        } else if (/^EHLO/.test(line)) socket.write('250-test.example.org\r\n250 8BITMIME\r\n')
        else if (/^DATA/.test(line)) { data = []; socket.write('354 send data\r\n') } else if (/^QUIT/.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  return { port: server.address().port, messages, fail: value => { reject = value } }
}

test('real SMTP sends all four account mails without a hosted key; failed delivery rejects safely and can retry', async t => {
  const smtp = await sink(t)
  const deliver = createDelivery({ ...base, NODE_ENV: 'test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_TLS_MODE: 'plain' })
  const data = { code: '123456', verify_url: 'https://hylo.example.org/verify?token=private', login_url: 'https://hylo.example.org/reset?token=private', invite_link: 'https://hylo.example.org/invite?token=private', group_name: 'Test community' }
  const message = { recipient: { address: 'member@example.org' }, sender: { address: 'untrusted@example.net' }, email_data: data, locale: 'de' }
  for (const emailId of ['email-verification', 'password-reset', 'finish-registration', 'invitation']) assert.equal(await deliver({ ...message, email_id: emailId }), true)
  assert.equal(smtp.messages.length, 4)
  for (const raw of smtp.messages) {
    assert.match(raw, /From: Hylo <community@example.org>/)
    assert.match(raw, /To: member@example.org/)
    assert.match(raw, /multipart\/alternative/)
    assert.doesNotMatch(raw, /untrusted@example.net/)
  }
  smtp.fail(true)
  await assert.rejects(deliver({ ...message, email_id: 'invitation' }), error => {
    assert.equal(error.message, 'EMAIL_DELIVERY_FAILED')
    assert.doesNotMatch(JSON.stringify(error), /secret-link|member@example|private/)
    assert.equal(error.cause, undefined)
    return true
  })
  smtp.fail(false)
  assert.equal(await deliver({ ...message, email_id: 'invitation' }), true)
  await assert.rejects(deliver({ ...message, email_id: 'unsupported-export' }), /EMAIL_TEMPLATE_UNAVAILABLE/)
})

test('invitation failures do not increment sent counters; retries reuse the same invitation', async () => {
  let fail = true; const saves = []; const recipients = []
  const model = loadBackend('api/models/Invitation.js', {
    mocks: { './mixins/EnsureLoad': {} },
    globals: {
      bookshelf: { Model: { extend: methods => methods } },
      Frontend: { Route: { group: () => 'https://hylo.example.org/groups/test', useInvitation: token => 'https://hylo.example.org/invite?token=' + token } },
      Analytics: { pixelUrl: () => undefined },
      Email: { sendInvitation: async (email, data) => { recipients.push(data.invite_link); if (fail) throw new Error('EMAIL_DELIVERY_FAILED'); return true } }
    }
  })
  const attributes = { email: 'member@example.org', token: 'same-token', sent_count: 0 }
  const entity = { get: key => attributes[key], ensureLoad: async () => {}, relations: { creator: { get: () => 'Test', getLocale: () => 'en' }, group: { get: () => 'Community' } }, save: async changes => { saves.push(changes); Object.assign(attributes, changes) } }
  await assert.rejects(model.send.call(entity), /EMAIL_DELIVERY_FAILED/)
  assert.equal(saves.length, 0)
  fail = false
  await model.send.call(entity)
  assert.equal(attributes.sent_count, 1)
  assert.deepEqual(recipients, ['https://hylo.example.org/invite?token=same-token', 'https://hylo.example.org/invite?token=same-token'])
})
