# SMTP account delivery (first slice)

Set these values in the private `deploy/docker/backend.env`. These are generic
examples: replace them locally and never commit credentials or operator details.

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_SENDER=community@example.org
EMAIL_SENDER_NAME=Example Community
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_TLS_MODE=starttls
SMTP_USER=community@example.org
SMTP_PASSWORD=
SMTP_PASSWORD_FILE=/run/secrets/smtp_password
EMAIL_NOTIFICATIONS_ENABLED=false
```

Use **either** `SMTP_PASSWORD` or `SMTP_PASSWORD_FILE`. Optional authentication
requires both a username and password; leaving both unset supports a relay that
authorizes the host by other means. SMTP does not need a Sendwithus key or any
upstream email template. The Compose public `PROTOCOL`/`DOMAIN` determines links
and must be HTTPS in production.

For a mounted secret, create a local Compose override (kept outside version
control) and mount a mode-0600 password file readable by the application UID into
**api, worker and maintenance** at the same path. For example, the service entry
for each of those three services contains:

```yaml
volumes:
  - /private/path/smtp_password:/run/secrets/smtp_password:ro
```

Supply that override consistently with `docker compose -f compose.yaml -f
/private/path/compose.smtp.yaml ...`. Check its merged structure with `config
--quiet`; ordinary `config` expands secrets. A trailing newline in the password
file is ignored. Apply settings by recreating API and worker.

`starttls` requires STARTTLS (normally port 587). `tls` establishes TLS immediately
(normally port 465). Both validate certificates and require TLS 1.2 or newer.
There is no production switch to ignore certificate errors or send plaintext.
`plain` is restricted to loopback development/test sinks. A local test sink is
not a production relay. An existing authenticated relay requires no additional
Hylo container; running a mail relay is a separate operator responsibility.

## Supported messages and delivery behavior

The versioned templates in `apps/backend/lib/email/templates/account.cjs` cover:

| Message | Link/data |
| --- | --- |
| Signup verification | Verification URL and code |
| Finish registration | Verification URL for the stored verification code |
| Password recovery | Dedicated single-use password-change URL, valid for 30 minutes |
| Group invitation | Existing invitation URL and optional inviter/message |

Templates include text and HTML, escape variables, restrict action links to the
configured public origin and always use the configured sender. German and
English are provided; other locales fall back to English. SMTP messages do not
contain hosted tracking pixels, inbound reply links or action forms.

SMTP transport errors reject the queue job with a sanitized error code. They do
not report success or log recipients, credentials, reset links or mail bodies.
The worker's failure metadata excludes the job arguments. Existing queue retry
policy applies. Invitation sent counters advance only after successful SMTP
acceptance, and a retry reuses the same invitation token. SMTP cannot guarantee
exactly-once delivery: an ambiguous connection failure after acceptance, or a
database failure while recording success, may produce a repeated message.

`EMAIL_NOTIFICATIONS_ENABLED=false` **does not disable account email**.
This first SMTP implementation requires it to be false because notification and
digest templates have not yet been ported. Exports and unsupported custom
templates explicitly fail with `EMAIL_TEMPLATE_UNAVAILABLE`; do not advertise
them as working. A configured relay accepting a message does not prove inbox
delivery; test your own relay and recipient domains privately.

## Existing hosted installations

`EMAIL_PROVIDER=sendwithus` preserves the existing adapter and template IDs.
If the provider is unset, an existing `SENDWITHUS_KEY` selects that adapter;
otherwise delivery is unconfigured. `EMAIL_PROVIDER=none` permits a startup-only
test, but account email then fails explicitly. It is unsuitable for real signup.

Keep a protected copy of the existing configuration, disable notification mail,
configure SMTP and restart the API/worker. Verify all four account messages with
synthetic accounts before migrating a real community. Do not switch a community
that depends on digest/export email until the remaining templates are available.

## Password recovery

The existing “forgot password” form queues an account lookup and always returns
the same success response for unknown, ineligible and throttled addresses. Only
active, email-verified accounts receive a link. A verified social-only account
can also establish its first local password. Requests are limited to three per
address and ten per source IP in 15 minutes; completion attempts are limited to
30 per source IP in 15 minutes. The reverse proxy must replace untrusted forwarded
headers, and the API port must remain private, for IP limits to be meaningful.

The worker generates a cryptographically random 256-bit token. Redis stores its
SHA-256 digest and recovery metadata for 30 minutes. Mail delivery happens in the
worker; the job contains the address, never the raw reset token or password.
Failed delivery revokes that token and reports a sanitized error for retry.
The URL uses a fragment (`/noo/password-reset#…`), so normal HTTP/proxy access
logs do not receive the token. The page clears the fragment immediately and
uses no third-party resources, a restrictive CSP, `no-store` and `no-referrer`.
Opening a link does not consume it, which also protects against mail scanners.

The German/English completion page asks for the new password twice. It preserves
Hylo's minimum length and rejects passwords above bcrypt's 72-byte UTF-8 limit.
It sends JSON only to the configured same-origin endpoint. Redis atomically
claims the token; PostgreSQL locks the account and credential before changing
the password. A changed email, changed password, unverified/inactive account,
expired token or replay fails. Multiple outstanding links are bound to the old
credential; only one concurrent change can succeed. An infrastructure failure
after claiming a link requires a new link and rolls back the password change.

Recovery removes stored browser sessions, including old anonymous-key sessions,
and database-backed OIDC grants/tokens for that user. It does not sign the user
in: the user returns to regular login. It does not terminate already executing
requests or revoke the independent identity provider's sessions. Older stateless
Hylo login JWTs, including reset links sent **before this upgrade**, retain their
original expiry (up to four hours). Plan that transition window when upgrading
an existing instance; restarting API/worker alone does not revoke those JWTs.
Existing hosted mail templates may need their expiry/login wording updated.

Design reference: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Verification and release limits

`node --test test/self-hosting/email.test.cjs` uses a disposable local SMTP
listener and the real Nodemailer transport. It verifies all four MIME messages,
German/fallback templates, escaping, invalid origins/configuration, a temporary
delivery rejection followed by successful retry and invitation sent counters.
It never contacts real recipients. PostgreSQL operator checks are separate.

`password-recovery.test.cjs` covers the GraphQL request, the real Passport JWT
strategy's rejection of opaque recovery tokens, and the HTTP origin/JSON boundary.
`password-recovery.integration.cjs` runs with
`HYLO_SELF_HOSTING_INTEGRATION=1`, `DATABASE_URL` and `REDIS_URL` against disposable
PostgreSQL and Redis services. It tests expiry, replay, concurrent redemption,
credential/eligibility changes, stored-session revocation and failure rollback
using real bcrypt hashes. Docker CI also checks the actual Sails recovery routes.

Local browser review uses only synthetic accounts. A screenshot of the form is
available in [the review evidence](../../output/playwright/password-recovery-form.png).
The full pilot lifecycle with the real external relay and identity provider,
notification/digest templates, uploads and restore acceptance remain outstanding.
No production rollout is implied.
