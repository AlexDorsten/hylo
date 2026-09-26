// Repository-owned transaction mail. Unsupported locales deliberately fall back to English.
const copy = {
  en: {
    'email-verification': ['Verify your email address', 'Confirm your email address to continue.', 'Verify email'],
    'password-reset': ['Reset your password', 'Use the link below to choose a new password.', 'Reset password'],
    'finish-registration': ['Complete your registration', 'Confirm your email address to complete registration.', 'Complete registration'],
    invitation: ['You have been invited', 'You have been invited to join', 'Open invitation'],
    code: 'Verification code',
    ignore: 'If you did not request this email, you can ignore it.',
    expiry: 'This link expires after four hours.',
    recoveryExpiry: 'This link works once and expires after 30 minutes.'
  },
  de: {
    'email-verification': ['E-Mail-Adresse bestätigen', 'Bestätige deine E-Mail-Adresse, um fortzufahren.', 'E-Mail bestätigen'],
    'password-reset': ['Passwort zurücksetzen', 'Über den Link kannst du ein neues Passwort wählen.', 'Passwort zurücksetzen'],
    'finish-registration': ['Registrierung abschließen', 'Bestätige deine E-Mail-Adresse, um die Registrierung abzuschließen.', 'Registrierung abschließen'],
    invitation: ['Du wurdest eingeladen', 'Du wurdest eingeladen, dieser Gruppe beizutreten:', 'Einladung öffnen'],
    code: 'Bestätigungscode',
    ignore: 'Wenn du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.',
    expiry: 'Dieser Link läuft nach vier Stunden ab.',
    recoveryExpiry: 'Dieser Link funktioniert einmal und läuft nach 30 Minuten ab.'
  }
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function renderAccount (template, data, locale, origin) {
  const language = String(locale || 'en').toLowerCase().split(/[-_]/)[0]
  const strings = copy[language] || copy.en
  const entry = strings[template]
  if (!entry) throw new Error('EMAIL_TEMPLATE_UNAVAILABLE')
  const [subject, intro, action] = entry
  const link = template === 'invitation' ? data.invite_link : template === 'password-reset' ? data.login_url : data.verify_url
  let url
  try { url = new URL(link) } catch { throw new Error('EMAIL_TEMPLATE_INVALID') }
  if (url.origin !== origin || url.username || url.password) throw new Error('EMAIL_TEMPLATE_INVALID')
  const paragraphs = [intro]
  if (template === 'invitation') {
    if (!data.group_name) throw new Error('EMAIL_TEMPLATE_INVALID')
    paragraphs.push(String(data.group_name))
    if (data.inviter_name) paragraphs.push(String(data.inviter_name))
    if (data.message) paragraphs.push(String(data.message))
  } else {
    if (template === 'email-verification') {
      if (!/^\d{1,6}$/.test(String(data.code))) throw new Error('EMAIL_TEMPLATE_INVALID')
      paragraphs.push(`${strings.code}: ${data.code}`)
    }
    paragraphs.push(template === 'password-reset' ? strings.recoveryExpiry : strings.expiry)
  }
  paragraphs.push(strings.ignore)
  return {
    subject,
    text: `${paragraphs.join('\n\n')}\n\n${action}: ${url.href}\n`,
    html: `<html lang="${copy[language] ? language : 'en'}"><body>${paragraphs.map(p => `<p>${escape(p).replace(/\r?\n/g, '<br>')}</p>`).join('')}<p><a href="${escape(url.href)}">${escape(action)}</a></p></body></html>`
  }
}

module.exports = { renderAccount }
