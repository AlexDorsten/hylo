# Discussion and self-hosting integration

PR #22 combines the discussion work from PR #21 (`0e6ab4f0f`) with the
self-hosting work from PR #10 (`b842ebb3d`). Its pilot acceptance at `2f28aecad`
closed #14. This is not completion of the self-hosting backlog. The next native
decision increment has a [separate rollout guide](decision-rounds.md).

## Integration boundaries

- GraphQL keeps both payment capability guards and discussion resolvers.
- All six locales keep both external-login and discussion strings.
- Fresh bootstrap includes external OIDC identities and discussion revisions.
  The schema fingerprint was updated after a real PostgreSQL comparison of
  migration-created and snapshot-created columns, defaults and constraints.
- Existing databases use normal migrations. Never bootstrap or reseed them.
- Closed registration, explicit local operator IDs, external OIDC and SMTP
  account mail retain the self-hosting branch's behavior and limitations.

## Automated release rehearsal

`test/self-hosting/discussion-release.sh` runs only with two explicit disposable
test flags. It clones the fresh CI database, reconstructs the preceding Docker
schema without revisions, adds synthetic legacy content and OIDC identity data,
and takes a custom-format PostgreSQL backup. Normal Knex migrations upgrade that
database, after which an attributed revision is written and verified. A second
migration run must preserve the revision. The upgraded database is backed up and
restored into a separate database, including content, identity and revision checks
and schema comparison with fresh bootstrap. Finally, the pre-upgrade backup is
restored and verified as a recovery rehearsal.

Restore uses the database administrator because the PostGIS image also creates
topology/geocoder extensions and their privileged metadata. Archive ownership is
preserved: application relations belong to `hylo`, extension objects to `postgres`.
Archive grants are omitted; migration and data checks then run as the application
role. The target must already contain both roles, with its own credentials.
This verifies database data and schema recovery; it does not verify uploaded file
bytes, Redis queues/sessions or an operator's secret store. Those remain part of
the complete instance-backup work in #8. The rehearsal must never target a pilot
or production Compose project.

## Pilot deployment gate

1. Both Docker/self-hosting and browser workflows must pass for the exact
   integrated revision. Build an immutable image with the operator's public
   origin and browser token; retain the previous image and deployment settings.
2. Put the instance into maintenance and stop every API, worker and scheduler
   publisher. Take a recoverable database backup and retain the media, queue and
   secret set outside the public repository. Verify the actual database restore
   in an isolated environment with outbound delivery disabled.
3. Run normal migrations from the new image. Start all web, API and worker
   processes from that image together, then reconnect browser clients.
4. Verify email login, existing community login, closed registration, overview
   editing/history and access revocation through the public origin. Check
   queued/group delivery and ensure no old publisher remains running.
5. If acceptance fails, keep maintenance enabled and restore the compatible
   pre-upgrade database with the previous image. Never discard new user changes
   silently; keep writes closed until the acceptance decision.

Mixed old and new API/worker publishers do not provide the new private-discussion
delivery boundary. A successful build or database migration alone is not pilot
acceptance. These integration and rollout gates remain required for subsequent releases;
#14 records acceptance of the preceding overview release.

AI opportunities and limits remain documented in `../ai-assistance.md`. No AI
provider, generation call or transfer of community data is part of this release.
