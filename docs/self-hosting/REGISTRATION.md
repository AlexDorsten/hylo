# Close self-registration

After provisioning the first operator, set this in the private `backend.env`:

```dotenv
HYLO_REGISTRATION_ENABLED=false
```

Then recreate the processes that read it:

```sh
docker compose up -d --force-recreate api worker
```

The default is `true` for compatibility with existing installations. Only the
literal values `true` and `false` are accepted; invalid values fail startup.
This is a runtime setting: after installing a version that supports it, no web
rebuild is needed to switch the policy. Reload open browser tabs after changing it.

When disabled:

- Login and recovery pages hide their registration links. Every `/signup/*`
  route redirects to `/login` before mounting verification or completion forms.
  If capabilities cannot be loaded, the browser keeps local login available and
  leaves registration closed.
- GraphQL `sendEmailVerification`, `verifyEmail` and `register` return
  `REGISTRATION_DISABLED`, including previously issued codes/links and sessions
  that had already verified their email. No signup mail, account, session or
  credential is created by those requests.
- The client-credential `POST /noo/user` endpoint returns HTTP 403. Legacy social
  callbacks cannot create users or finish pending email/API signups. Existing
  completed accounts retain their normal login behavior.
- Existing email/password login, password recovery and configured external OIDC
  login/linking remain available. OIDC only authenticates identities explicitly
  linked to existing accounts; it never creates a user or links by email match.
  Local administrators can remain entirely independent of an external provider.
- Group invitations do not override this instance-wide policy. Existing members
  can sign in to accept invitations; new members cannot register while closed.

`GET /noo/auth/providers` reports `registration: false` alongside the configured
login providers. To offer only email/password and community OIDC, leave Google
and LinkedIn credentials unset and configure the desired providers as described
in [OIDC.md](OIDC.md).
The legacy Facebook and native Apple handlers are unavailable in this server
configuration; they cannot bypass the configured provider list.

Keep registration enabled only while deliberately admitting new local accounts,
under appropriate access restrictions. Complete [first-operator setup](FIRST_OPERATOR.md)
before closing it. This switch does not delete pending accounts or revoke existing
sessions. Administrative imports and the guarded initial seed command are separate
operator operations; they are not self-registration endpoints.
