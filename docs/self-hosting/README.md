# Docker self-hosting (work in progress)

This fork is preparing a portable Docker installation of Hylo. The foundation
builds a shared application image, provisions private data services and provides
a guarded first-install command. **It is not yet a complete production-ready
self-hosting release.** The current application still requires upstream-style
OAuth and Stripe configuration, operator-owned email templates and an upload
integration. The application profile is deliberately opt-in while those issues
are resolved. No placeholder provider credentials are supplied.

All examples use `hylo.example.org`. Keep real deployment details and filled
configuration files outside version control and public issue discussions.

## Containers and dependencies

| Service | Image/process | Role |
| --- | --- | --- |
| `db` | PostgreSQL 17 + PostGIS 3.5 | Persistent relational/geospatial data; no host port |
| `redis` | Redis 7.2 | Persistent queues, sessions and pub/sub; no host port |
| `api` | Custom image, `apps/backend/app.js` | API, GraphQL and Socket.IO; loopback port 3001 |
| `worker` | Same image, `apps/backend/worker.js` | Process background queues |
| `web` | Same image, `apps/web/src/server/index.js` | Serve built browser app; loopback port 9001 |
| `maintenance` | Same image, one-shot command | Bootstrap, migrations or individual scheduled jobs |
| HTTPS reverse proxy | Operator's choice | Terminate TLS and route to the two loopback ports |

Five persistent containers run after application enablement. Maintenance jobs
are short-lived. A reverse proxy can be a host service or an additional
container with suitable connectivity. The provided loopback example assumes it
can access the host loopback interface; an ordinary bridge-network container
cannot reach the host through its own `127.0.0.1`.

Outbound connections are needed for configured email, OAuth, upload and other
providers. Adding an SMTP or object-storage container alone does not implement
the adapters missing from this application. See the backlog below.

## Prerequisites and versioning

- A disposable Linux **amd64** test host, Docker Engine and Compose v2 with
  profiles and `up --wait`. Other architectures are not validated; check the
  selected PostGIS image's supported platforms before building elsewhere.
- Available disk and memory for a large Node/Vite build, persistent database,
  Redis and backups. Resource requirements have not yet been benchmarked;
  measure peak use on the test host before sizing a shared production host.
- A DNS name and HTTPS reverse proxy before enabling browser authentication.
- Git and OpenSSL for checkout and local secret generation.

The Dockerfile follows the repository's Node 24 and Yarn 4.9.2 requirements. It
focuses the backend/web workspaces, builds shared packages and then the web app.
Runtime currently retains development dependencies because backend startup uses
Babel and packages classified as development dependencies upstream.

Check out a reviewed commit of this fork and record its SHA. The example image
tags constrain major/minor versions, but are mutable: record and use verified
image digests for repeatable deployments. Set `HYLO_IMAGE` to a unique name/tag
per source revision. A changed domain or public browser key requires rebuilding.

```sh
git clone https://github.com/AlexDorsten/hylo.git
cd hylo
# Check out the reviewed self-hosting branch/commit before these commands.
git rev-parse HEAD
cd deploy/docker
umask 077
cp .env.example .env
cp backend.env.example backend.env
```

Edit `.env` locally. Set the domain and four independent generated values for
`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `COOKIE_SECRET` and `JWT_SECRET`:

```sh
openssl rand -hex 32
```

Run that command separately for each value. Keep the application database
password hex-only so it is safe in `DATABASE_URL`. Keep the administrative
password different. Store the files with mode 0600 and save a protected copy in
your secret store. Avoid publishing `docker compose config` output; it expands
secrets. Validate silently instead:

```sh
docker compose --profile application --profile maintenance config --quiet
docker compose build api
```

The build context excludes environment files, common key formats, database dumps
and local dependencies. Never pass server secrets as Docker build arguments.
All `VITE_*` values are browser-visible.

## Initialize an empty database

```sh
docker compose up -d --wait db redis
docker compose run --rm --no-deps maintenance node /app/deploy/docker/bootstrap.cjs
```

On first creation of the database volume, the administrator creates the PostGIS,
statistics and UUID extensions and a separate `hylo` role without superuser,
role-creation or database-creation privileges. The bootstrap command then loads
the schema as that application role and runs the matching default seeds. These
seeds also record the migrations represented by that schema. **Do not run
migrations before the initial schema/seeds, and never run default seeds on an
existing installation.**

Bootstrap checks for existing application relations under a database lock and
refuses to reinitialize them. If schema import fails, its transaction rolls back.
If seeding fails, the schema remains and bootstrap refuses a retry. Inspect the
failure and recover the disposable installation deliberately; do not bypass the
guard on a database containing user data. Changing passwords in `.env` does not
rotate roles in an existing database volume.

The upstream seeds create reference data, a starter group and a helper account.
They do not establish a trusted operator administrator. Some seeded assets still
reference upstream URLs. Explicit administrator provisioning is tracked in #3.

## Prepare application integrations

Fill `backend.env` with independently owned settings only after reviewing:

- [#3 — login and administrator provisioning](https://github.com/AlexDorsten/hylo/issues/3): OAuth strategies currently initialize eagerly and upstream email-based administrator shortcuts remain. Independent deployment must resolve these before public use.
- [#4 — email delivery](https://github.com/AlexDorsten/hylo/issues/4): Sendwithus uses fixed upstream template IDs. A key alone is insufficient; `SMTP_HOST` is not a supported adapter. `EMAIL_NOTIFICATIONS_ENABLED=false` does not suppress authentication email.
- [#5 — uploads and privacy](https://github.com/AlexDorsten/hylo/issues/5): the picker uses Filestack and backend storage uses AWS S3. S3-compatible endpoints and private attachment access need explicit implementation and testing.
- [#6 — optional payments](https://github.com/AlexDorsten/hylo/issues/6): Stripe is currently required during backend initialization even for a community that does not intend to use payments.

Generate and store an independent OIDC signing key; the parser expects a base64
encoded PKCS#1 PEM RSA private key. For OpenSSL 3:

```sh
openssl genrsa -traditional 2048 | openssl base64 -A
```

Place the result in `OIDC_KEYS` without publishing it. Keep a backup; changing
signing and session secrets affects active sessions/tokens. Map credentials are
needed for map features, separately from successful application startup.

## Own origin, cookies and reverse proxy

The build embeds `https://${HYLO_DOMAIN}` in browser API and Socket.IO URLs.
The web **server** uses `http://api:3001` internally at runtime. Do not put that
internal service URL in the browser build. Both backend `COOKIE_NAME` and web
`HYLO_COOKIE_NAME` are `hylo-session`; leaving `COOKIE_DOMAIN` unset produces a
host-only cookie. HTTPS is required by the configured secure cookies.

`CORS_ALLOWED_ORIGINS` adds the operator origin consistently to HTTP, GraphQL
and production WebSocket allowlists. Existing trusted origins remain for
upstream compatibility. `HYLO_DATABASE_SSL=false` disables database TLS only
for the private Docker connection; it does not disable TLS verification globally.
Without that explicit opt-out, production retains its existing TLS behavior.

`HYLO_MARKETING_PROXY=false` lets the local application serve `/` and marketing
paths. The preexisting `DISABLE_PROXY` flag instead produces maintenance errors
and should not be used for this purpose.

Example Caddy configuration for a proxy with host-loopback access:

```caddyfile
hylo.example.org {
    encode zstd gzip
    @api path /noo /noo/* /socket.io /socket.io/* /.well-known/openid-configuration
    handle @api {
        reverse_proxy 127.0.0.1:3001
    }
    handle {
        reverse_proxy 127.0.0.1:9001
    }
}
```

Preserve the path prefixes. Forward the original host and scheme and support
WebSocket upgrades. If you change loopback ports, update the proxy accordingly.
Database and Redis must stay unpublished. After resolving the integration and
administrator issues above, start the application in an isolated test setup:

```sh
docker compose --profile application up -d
docker compose --profile application ps
docker compose logs --tail=100 api worker web
```

Logs and a running process alone do not establish readiness. Verify registration,
login/logout, recovery, invitations, ordinary-user privilege denial, private
groups, attachment access, realtime updates and background delivery through HTTPS
before permitting real users.

## Scheduled jobs

The worker does not schedule interval jobs. The existing commands are one-shot:

```sh
docker compose run --rm maintenance node cron.js --interval every10minutes
docker compose run --rm maintenance node cron.js --interval hourly
docker compose run --rm maintenance node cron.js --interval daily
```

The intervals cover search refreshes, digests and cleanup/payment tasks. Current
code uses an upstream business timezone and catches some errors without a failing
exit status. Do not install a production scheduler or infer success from exit
status alone yet. [#7](https://github.com/AlexDorsten/hylo/issues/7) tracks
timezone configuration, failure reporting, overlap prevention and monitoring.

## Updates and recovery

Stop API, worker, web and the external scheduler before a coordinated update.
Record the current source/image digests and retain a recoverable database, media,
queue and secret set. A database-only export is useful, but is not a complete
instance backup:

```sh
umask 077
docker compose exec -T db pg_dump -U postgres -d hylo -Fc > hylo.dump
docker compose exec -T db pg_restore --list < hylo.dump > /dev/null
```

Store backups encrypted off-host with a retention policy. Restore into an
isolated instance with external delivery/payment actions disabled and verify
data and authorization there before relying on the procedure. The complete
media/queue restore exercise remains [#8](https://github.com/AlexDorsten/hylo/issues/8).

After checking out and building the reviewed next revision, run only migrations
against an existing database:

```sh
docker compose build api
docker compose run --rm maintenance
docker compose --profile application up -d
```

If a migration is not reversible, rollback requires the old image **and** a
compatible data restore. Never use `down -v` as an update operation: it deletes
the persistent database and queue volumes.

## Delivery plan and verification

1. [#1 Docker build/bootstrap](https://github.com/AlexDorsten/hylo/issues/1) and [#2 custom origin](https://github.com/AlexDorsten/hylo/issues/2): foundation in this branch.
2. [#3 identity](https://github.com/AlexDorsten/hylo/issues/3) and [#6 optional payments](https://github.com/AlexDorsten/hylo/issues/6): remove mandatory unused-provider requirements.
3. [#4 mail](https://github.com/AlexDorsten/hylo/issues/4) and [#5 uploads](https://github.com/AlexDorsten/hylo/issues/5): decide and implement independently owned integrations.
4. [#7 scheduling](https://github.com/AlexDorsten/hylo/issues/7), [#8 restore](https://github.com/AlexDorsten/hylo/issues/8) and [#9 verified guide](https://github.com/AlexDorsten/hylo/issues/9): complete operational acceptance.

The `Docker self-hosting foundation` workflow validates Compose, builds the
image, runs focused configuration/HTTP tests, imports schema and seeds as the
non-superuser role, rejects a second bootstrap and exercises migrations.
It uses disposable CI-generated secrets and no provider accounts. It does not
test full application startup, browser authentication, mail, uploads or restore.
Check the workflow result for the exact revision before using the artifacts.

References: [PostGIS image](https://github.com/postgis/docker-postgis),
[Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
