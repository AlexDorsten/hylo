# Sign in through ZITADEL

This recipe connects an independently operated ZITADEL instance to the generic
[external OIDC client](OIDC.md). It adds no identity-provider container to Hylo.
The provider is optional; other standards-compliant issuers remain configurable.
These are configuration instructions, not evidence of a completed ZITADEL login
acceptance test. The release limitations in [the installation guide](README.md)
still apply.

## Register the application

In the ZITADEL Console, create a dedicated Hylo project and a **Web** OIDC
application. Choose the **Code** / client-secret authentication option, with
Authorization Code grant, response type `code` and token authentication
`client_secret_basic`. Console labels can differ by version. Confirm the saved
authentication method rather than relying on a wizard label.

Hylo exchanges codes in its backend and additionally sends PKCE S256. Its current
configuration requires a client secret; a public client with authentication
method `none` (sometimes labelled **PKCE** in the wizard) is not supported by
this slice. Record the generated client ID and secret in private runtime
configuration. Do not reuse another application's credentials.

For provider ID `zitadel`, register exactly:

```text
https://hylo.example.org/noo/login/oidc/zitadel/callback
```

Keep development mode off and use HTTPS without wildcard redirects. No additional
CORS origin is required for Hylo's server-side token exchange. Do not configure a
provider-wide logout callback as if Hylo supported it; local logout is the only
implemented logout behavior.

References: [ZITADEL applications](https://zitadel.com/docs/guides/manage/console/applications-overview),
[client authentication](https://zitadel.com/docs/apis/openidoauth/authn-methods).

## Configure Hylo privately

Read `https://id.example.org/.well-known/openid-configuration` over trusted HTTPS
and use its exact `issuer` value, not the Console or login-page URL. Both the
browser and API container must reach the public provider. Keep TLS certificate
verification enabled even when both services run on the same host.

Replace the example values in the private `deploy/docker/backend.env`:

```dotenv
HYLO_OIDC_PROVIDERS='[{"id":"zitadel","name":"Community Login","issuer":"https://id.example.org","clientId":"REPLACE_WITH_CLIENT_ID","clientSecret":"REPLACE_LOCALLY","tokenEndpointAuthMethod":"client_secret_basic"}]'
```

This is a single-line JSON array. Preserve any other configured providers. Keep
the ID `zitadel` stable; it determines the callback path. Configure the actual
public Hylo domain through `HYLO_DOMAIN` in `.env`, as described in the main
guide. Recreate API and worker after the credentials are configured:

```sh
docker compose --profile application up -d --no-deps --force-recreate api worker
```

No browser rebuild is needed just to add a provider. Keep Hylo's independent
`OIDC_KEYS` and explicit `HYLO_ADMINS` configuration.

The current client requests only `openid`. ZITADEL's `sub` and `iss` identify the
external identity. Hylo makes no UserInfo call, requires no role/group scopes and
does not use email claims for linking. Extra profile or email claims inside an
ID token are therefore unnecessary. Existing local email verification and SMTP
are still needed. See [ZITADEL's OIDC endpoints](https://zitadel.com/docs/apis/openidoauth/endpoints).

## Verify before release

Use a dedicated ordinary test account and record results privately:

1. Register a local Hylo account, verify its email and set a password. Sign in
   locally, open **My Home → Account**, confirm the password and link ZITADEL.
2. Complete provider authentication. Hylo requests `prompt=login` during linking
   so the selected identity is visible. Confirm the intended provider account.
3. Sign out of Hylo, then sign in using **Community Login**. Confirm that the
   same local account opens and ordinary-user permissions remain unchanged.
   The ZITADEL SSO session can still be active after local logout.
4. Attempt login with an unlinked provider account. It must fail without creating
   or merging a local account, even when its email matches an existing user.
5. In a disposable test environment, make the provider unavailable and verify
   local password recovery/login. Do not stop a shared provider for this test.

Check any project-access restrictions against the chosen test account. Provider
roles do not grant Hylo administrator privileges. A successful discovery request
alone does not establish that the client registration or complete login works.

For redirect failures, compare the registered URI with Hylo's configured origin
and provider ID. For `invalid_client`, check the client ID, secret and saved
authentication method. Retry from a fresh Hylo login attempt after corrections;
callbacks are single-use. Preserve callback-query redaction in proxy logs and
keep real hosts, accounts, credentials and test evidence outside the public fork.

Direct signup through ZITADEL, unlinking/status and provider-wide logout remain
follow-ups in [#11](https://github.com/AlexDorsten/hylo/issues/11).
