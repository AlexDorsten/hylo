const { randomBytes } = require('node:crypto')

// Like the transaction-mail templates, this standalone recovery screen supports
// German and English (fallback). It loads no app bundle, analytics or third party.
const copy = {
  en: {
    title: 'Choose a new password',
    intro: 'This link works once and expires after 30 minutes.',
    password: 'New password',
    confirmation: 'Repeat new password',
    submit: 'Save password',
    hint: 'Use at least 9 characters (at most 72 UTF-8 bytes).',
    invalid: 'This link is invalid, expired or already used. Request a new link.',
    mismatch: 'Enter the same password twice. Use at least 9 characters and at most 72 UTF-8 bytes.',
    failure: 'The password could not be changed. Request a new link and try again.',
    success: 'Your password has been changed. Sign in with your new password.',
    login: 'Sign in',
    request: 'Request a new link',
    working: 'Saving…'
  },
  de: {
    title: 'Neues Passwort wählen',
    intro: 'Dieser Link funktioniert einmal und läuft nach 30 Minuten ab.',
    password: 'Neues Passwort',
    confirmation: 'Neues Passwort wiederholen',
    submit: 'Passwort speichern',
    hint: 'Verwende mindestens 9 Zeichen (höchstens 72 UTF-8-Bytes).',
    invalid: 'Dieser Link ist ungültig, abgelaufen oder bereits verwendet. Fordere einen neuen Link an.',
    mismatch: 'Gib zweimal dasselbe Passwort ein. Verwende mindestens 9 Zeichen und höchstens 72 UTF-8-Bytes.',
    failure: 'Das Passwort konnte nicht geändert werden. Fordere einen neuen Link an und versuche es erneut.',
    success: 'Dein Passwort wurde geändert. Melde dich mit dem neuen Passwort an.',
    login: 'Anmelden',
    request: 'Neuen Link anfordern',
    working: 'Wird gespeichert…'
  }
}

function renderRecoveryPage (language) {
  const lang = language === 'de' ? 'de' : 'en'
  const c = copy[lang]
  const nonce = randomBytes(18).toString('base64')
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title} · Hylo</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f6f2;color:#20372b;font:17px/1.5 system-ui,sans-serif;padding:24px}main{max-width:480px;width:100%;padding:36px;background:white;border:1px solid #dde5df;border-radius:16px;box-shadow:0 12px 40px #20372b0a}h1{font-size:28px;line-height:1.2;margin:12px 0}p{color:#4d6255}.brand{font-weight:750;letter-spacing:.06em;color:#25683d}label{display:block;margin-top:20px;font-weight:600}input,button{font:inherit;width:100%;padding:12px;border-radius:7px}input{border:1px solid #85998c;margin:6px 0}button{margin-top:24px;border:0;background:#25683d;color:white;cursor:pointer}button:disabled{opacity:.65}a{color:#25683d}small{display:block;color:#4d6255}nav{display:flex;flex-wrap:wrap;gap:20px;margin-top:24px}[hidden]{display:none}#status:empty{display:none}
</style></head><body><main><div class="brand">HYLO</div><h1>${c.title}</h1><p>${c.intro}</p>
<noscript>JavaScript is required to use this recovery link.</noscript>
<form id="reset" hidden><label for="password">${c.password}</label><input id="password" type="password" autocomplete="new-password" minlength="9" maxlength="72" required aria-describedby="hint"><small id="hint">${c.hint}</small>
<label for="confirmation">${c.confirmation}</label><input id="confirmation" type="password" autocomplete="new-password" minlength="9" maxlength="72" required><button type="submit">${c.submit}</button></form>
<p id="status" role="status" aria-live="polite"></p><nav><a href="/login">${c.login}</a><a href="/reset-password">${c.request}</a></nav></main>
<script nonce="${nonce}">
(() => {
  const c = ${JSON.stringify(c)};
  let token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const form = document.getElementById('reset');
  const status = document.getElementById('status');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { status.textContent = c.invalid; return; }
  form.hidden = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const confirmation = document.getElementById('confirmation').value;
    if (password !== confirmation || !password.trim() || new TextEncoder().encode(password).length > 72) { status.textContent = c.mismatch; return; }
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = c.working;
    try {
      const response = await fetch('/noo/password-reset', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmation }) });
      const result = await response.json();
      if (response.ok && result.success) { token = ''; form.reset(); form.hidden = true; status.textContent = c.success; }
      else if (result.error === 'RECOVERY_PASSWORD_INVALID') status.textContent = c.mismatch;
      else { token = ''; form.reset(); form.hidden = true; status.textContent = response.status === 400 ? c.invalid : c.failure; }
    } catch { token = ''; form.reset(); form.hidden = true; status.textContent = c.failure; }
    finally { button.disabled = false; }
  });
})();
</script></body></html>`
  return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` }
}

module.exports = { renderRecoveryPage }
