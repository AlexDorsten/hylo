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
