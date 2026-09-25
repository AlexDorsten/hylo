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
| Password recovery | Existing Hylo login/recovery URL |
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

## Verification and release limits

`node --test test/self-hosting/email.test.cjs` uses a disposable local SMTP
listener and the real Nodemailer transport. It verifies all four MIME messages,
German/fallback templates, escaping, invalid origins/configuration, a temporary
delivery rejection followed by successful retry and invitation sent counters.
It never contacts real recipients. PostgreSQL operator checks are separate.

These transport checks do not establish the whole browser lifecycle. In
particular, password-reset links retain the upstream four-hour login JWT, which
is **reusable until expiry and not bound to a reset-only purpose**. One-time,
purpose-bound recovery, expiry/replay tests through real authentication,
notification/digest templates and external relay acceptance remain outstanding
in issue #4 before public release. No production rollout is implied.
