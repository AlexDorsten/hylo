# External OpenID Connect login — first implementation slice

Hylo can accept browser login from multiple operator-configured OIDC providers.
This initial slice works with **existing active accounts with locally verified
email and a password**. The user signs in locally, opens **My Home → Account**,
confirms their current Hylo password and connects a provider. After signing out,
they can use that provider's button on the login page. Local password login stays
available during provider outages.

This is partial implementation of [#11](https://github.com/AlexDorsten/hylo/issues/11).
It does not create users, bypass invitation/registration policy, import provider
roles, offer unlinking, perform provider-wide logout or add native mobile SSO.
An unknown external identity receives a generic failure and must first be
connected from an existing local account. SMTP/local account lifecycle acceptance
and independent-provider compatibility remain open before production release.

## Configure a confidential web client

For ZITADEL, follow the [provider configuration recipe](ZITADEL.md), including
its client-authentication choice and the existing-account acceptance procedure.

1. Use the provider's exact HTTPS issuer URL, including its realm/path and
   trailing slash if present in discovery metadata. The backend must reach its
   discovery, token and JWKS endpoints over trusted HTTPS.
2. Register a confidential client with Authorization Code flow, PKCE S256 and
   `openid` scope. Use `client_secret_basic` (default) or `client_secret_post`.
   This slice requests no email or group scopes and makes no UserInfo request.
3. Register this **exact** redirect URI for the provider ID `community`:
   `https://hylo.example.org/noo/login/oidc/community/callback`.
   Do not register wildcard redirect URIs.
4. In the private `deploy/docker/backend.env`, set a single-line JSON array:

```dotenv
HYLO_OIDC_PROVIDERS='[{"id":"community","name":"Community Login","issuer":"https://id.example.org/realms/community","clientId":"hylo","clientSecret":"REPLACE_LOCALLY","tokenEndpointAuthMethod":"client_secret_basic"}]'
```

Replace the example credentials locally. Use up to eight objects with unique,
stable lowercase IDs. The name is a public display label. Add another object for
a second provider; register its own `/noo/login/oidc/<id>/callback`. Runtime JSON
is validated at startup; malformed or partial credentials cause a startup error.
Never pass it through `VITE_*`, build arguments, public capabilities or source
control. Protect the env file and avoid pasting expanded Compose configuration.

Compose already sets `PROTOCOL=https` and `DOMAIN` from `HYLO_DOMAIN`. Those
values determine callback URLs; incoming Host/forwarded headers cannot override
them. Recreate API and worker containers after changing runtime configuration.
No web rebuild is needed solely for a new provider; labels/buttons come from
`GET /noo/auth/providers` and secrets/issuers are not exposed by that endpoint.
Keep the same provider ID for normal credential rotation. Changing an issuer or
subject changes the external identity and does not transfer existing links.

`OIDC_KEYS` remains required for Hylo's **own token issuer**, email verification
and recovery. External provider configuration does not replace those keys.

## Migration and administrator access

Existing instances run the normal migration command before starting this code.
The migration adds `external_oidc_identities` without changing existing users or
legacy social links. New installations include the equivalent table in the
reviewed schema snapshot. Its unique primary key is `(issuer, subject)`, with a
foreign key to the user. Removing the table removes external links; it does not
remove local password accounts.

**Before upgrading**, explicitly set `HYLO_ADMINS` to the local numeric user IDs
that should administer this installation. Use `HYLO_TESTER_IDS` for test-only
privileges when required. Existing domain-derived grants and separate admin
Google sessions no longer confer access. `/noo/admin/login` now leads to the
ordinary login page; `ADMIN_GOOGLE_CLIENT_ID` and `ADMIN_GOOGLE_CLIENT_SECRET`
are unused. An external login receives exactly the permissions of its linked
local account. Seeds do not choose an operator administrator; first-account
provisioning remains tracked in [#3](https://github.com/AlexDorsten/hylo/issues/3).

## Session and account rules

- The maintained `openid-client` implementation checks authorization responses,
  PKCE, nonce, issuer, audience, token lifetime and the ID-token signature using
  provider JWKS. Discovery is limited to server-configured issuers.
- A ten-minute attempt belongs to one browser session and provider. Redis consumes
  it atomically once across workers. Starting another attempt in the same session
  replaces the previous one; finish the latest browser flow.
- Linking requires same-origin JSON, an active locally verified account, a local
  password and fresh password verification. Five attempts per user per ten
  minutes limit password guessing. A changed session cannot finish a pending link.
- PostgreSQL transactions and uniqueness prevent concurrent link requests from
  moving an identity between users. Matching email, `email_verified`, groups and
  role claims never merge accounts or grant administrator access.
- Successful login/linking regenerates the local session. Tokens are not retained
  in the database/session. Signing out clears Hylo's session; the provider's SSO
  session may remain active. Provider-wide logout is not implemented yet.
- Backend access logs omit callback queries. Configure reverse-proxy/APM logs
  likewise so authorization codes and state are not recorded. Never publish a
  callback URL containing query parameters.

## Verification and remaining acceptance

`node --test test/self-hosting/*.test.cjs` tests the production OIDC client against
two disposable issuers with real RSA-signed tokens and an in-memory transport.
It covers forged signatures, wrong issuer/audience/nonce, expiry, wrong session,
state/replay, provider mix-ups, PKCE and outages, plus controller/authorization
checks. These fixtures are not evidence of compatibility with an independent
identity-provider product.

The Docker CI workflow also runs `oidc-storage.integration.cjs` against disposable
PostgreSQL and Redis. It compares the migration and fresh schema, tests competing
identity claims, deactivated/unverified accounts and atomic callback consumption.
Do not run these integration tests against an operator's production services.

Before treating #11 as complete, verify with an independently implemented OIDC
provider over HTTPS: local login → password-confirmed link → local logout → OIDC
login, two issuers, ordinary-user privilege denial, provider outage and local
recovery. Add registration/invitation policy, connection status/unlinking with
recovery safeguards, logout semantics and native-client follow-ups as specified
in the issue. The overall self-hosting release also needs SMTP, storage and
operational acceptance; see the [installation guide](README.md).

References: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html),
[openid-client](https://github.com/panva/openid-client).
