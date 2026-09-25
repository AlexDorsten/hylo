# External OIDC UI review

These screenshots show the production web build in Chrome with German locale.
The API responses were intercepted locally with two generic provider labels and
an invented account (`member@example.org`). No operator data or credentials are
included. These are UI checks, not an end-to-end identity-provider acceptance test.

- `oidc-login-desktop.png`: local password login and two configured providers;
  Google is absent when disabled.
- `oidc-login-mobile-error.png`: the translated callback failure message and
  provider buttons at 390px width. The page scrolls to the remaining controls.
- `oidc-account-link.png`: account linking after a simulated HTTP 403; the
  password is cleared, actions are disabled until it is re-entered, and the
  translated recovery message is visible.

The local password form also remained available when the capabilities endpoint
returned HTTP 503. Protocol, controller and database verification are described
in [the OIDC guide](../../docs/self-hosting/OIDC.md).

## Community payments disabled

`community-payments-disabled.png` shows the production build at a synthetic
public offering URL with German locale and `payments: false` from a locally
mocked `/noo/capabilities` response. The offering component does not mount or
request payment data. The same check passed with HTTP 503 from that endpoint:
zero payment queries and the unavailable message remained visible. Optional
cookies were declined and external network requests were blocked. This is UI
evidence, not a successful checkout or a full community-flow acceptance test.

## Password recovery

`password-recovery-form.png` and `password-recovery-success.png` show the German
standalone recovery page in local Chrome. The fixture loads the actual HTTP
controller and recovery service against isolated PostgreSQL and Redis, with an
invented verified account. Mail delivery is captured locally. The browser URL
has no token after loading, mismatched confirmation is rejected, and successful
submission hides and clears the form without logging in. The stored bcrypt
credential accepts the new password and rejects the old one after submission.
No real mail, user account, provider or operator configuration is used. These
screenshots do not establish deployment or external-inbox acceptance.
