#!/usr/bin/env bash
# Run from deploy/docker, against the disposable Compose project created by CI.
set -euo pipefail
test "${HYLO_SELF_HOSTING_INTEGRATION:-}" = 1
test "${HYLO_DISPOSABLE_COMPOSE:-}" = 1
umask 077
backup_dir=$(mktemp -d)
trap 'rm -rf "$backup_dir"' EXIT

create_database() {
  docker compose exec -T db createdb -U postgres -O hylo "$1"
}
restore_database() {
  # The image also creates topology/geocoder extensions with privileged tables.
  # Restore as administrator, retaining archive ownership: application objects
  # belong to hylo, extension objects to postgres. Verify using hylo afterwards.
  docker compose exec -T db pg_restore -U postgres --no-privileges --exit-on-error -d "$1" < "$2"
}
rehearse() {
  docker compose run --rm --no-deps -e HYLO_SELF_HOSTING_INTEGRATION=1 maintenance node -e '
    const { spawnSync } = require("node:child_process")
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = "/" + process.argv[1]
    const result = spawnSync(process.argv[2], process.argv.slice(3), {
      env: { ...process.env, DATABASE_URL: url.href }, stdio: "inherit"
    })
    if (result.error) throw result.error
    process.exit(result.status ?? 1)
  ' "$@"
}

# Fresh bootstrap is the structure oracle; reconstruct the previous release in
# a separate database and keep both pre-upgrade and post-upgrade backups.
docker compose exec -T db pg_dump -U postgres -d hylo -Fc --no-privileges > "$backup_dir/fresh.dump"
create_database hylo_ci_upgrade
restore_database hylo_ci_upgrade "$backup_dir/fresh.dump"
rehearse hylo_ci_upgrade node /app/test/self-hosting/discussion-release.cjs baseline
docker compose exec -T db pg_dump -U postgres -d hylo_ci_upgrade -Fc --no-privileges > "$backup_dir/before.dump"
rehearse hylo_ci_upgrade yarn workspace backend migrate
rehearse hylo_ci_upgrade node /app/test/self-hosting/discussion-release.cjs write-revision
rehearse hylo_ci_upgrade node /app/test/self-hosting/discussion-release.cjs verify-revision
# A second normal migration must be a no-op and preserve the saved revision.
rehearse hylo_ci_upgrade yarn workspace backend migrate
docker compose exec -T db pg_dump -U postgres -d hylo_ci_upgrade -Fc --no-privileges > "$backup_dir/after.dump"
create_database hylo_ci_restore
restore_database hylo_ci_restore "$backup_dir/after.dump"
rehearse hylo_ci_restore node /app/test/self-hosting/discussion-release.cjs verify-revision

# Exercise recovery to the previous schema using its backup, not migration down.
docker compose exec -T db dropdb -U postgres hylo_ci_restore
create_database hylo_ci_restore
restore_database hylo_ci_restore "$backup_dir/before.dump"
rehearse hylo_ci_restore node /app/test/self-hosting/discussion-release.cjs verify-baseline
docker compose exec -T db dropdb -U postgres hylo_ci_restore
docker compose exec -T db dropdb -U postgres hylo_ci_upgrade
