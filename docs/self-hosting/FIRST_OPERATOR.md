# First operator (isolated pilot)

The seed helper is not an administrator. Privilege is granted only through the
private `HYLO_ADMINS` list of local user IDs. Email domains and external OIDC
claims do not grant it. Do not give an existing seed account a password.

1. Follow the [Docker guide](README.md) through schema bootstrap. Configure an
   independent `OIDC_KEYS` signing key and [SMTP account delivery](SMTP.md).
   Start API, worker and web behind the configured HTTPS origin.
2. Register your own email address using local password registration in the web
   app. Receive the verification email, verify the code, finish the profile and
   confirm that password login works. Keep this local account as a recovery path
   even when you subsequently connect an external OIDC provider.
3. In `deploy/docker`, run the read-only lookup. Enter the registered email at
   its prompt; it is not a command-line argument or a committed configuration:

   ```sh
   docker compose run --rm --no-deps maintenance node /app/deploy/docker/operator.cjs
   ```

   The command requires exactly one matching active, email-verified account with
   a local password credential. It refuses the seed helper, duplicate email
   matches, social-only and unverified accounts. It makes no database writes and
   prints a `HYLO_ADMINS=<local-id>` assignment. Treat that output as private.
4. Add the ID to `HYLO_ADMINS` in the private `backend.env`. Preserve existing
   administrator IDs in the comma-separated list. Leave `HYLO_TESTER_IDS` empty
   unless you deliberately need tester features; it is not an admin grant.
5. Reload the backend processes, then sign out and sign back in:

   ```sh
   docker compose up -d --force-recreate api worker
   ```

   One-shot maintenance commands read the same file on their next invocation.
6. Verify authorized management access with this account. Use a separate normal
   account and a logged-out browser to confirm management access is denied.
   Removing an ID and recreating the backend processes must revoke access.

Do not paste real addresses, IDs, backend configuration or logs into public
issues. To recover from an incorrect grant, correct the private allowlist and
recreate the processes; the lookup never changes permissions itself.

The automated PostgreSQL test covers lookup eligibility, ambiguous addresses,
large IDs and lack of permission writes. End-to-end registration, ordinary-user
denial and administrator access through the actual pilot remain required before
closing issue #3. New password-reset links use the dedicated single-use flow
described in [SMTP account delivery](SMTP.md#password-recovery). Verify recovery
through the actual pilot's inbox and browser before accepting issue #4. This
procedure does not establish production readiness.
