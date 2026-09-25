# ADR 0001: Make the existing Hylo core independently operable

Status: **Accepted direction; implementation in progress**  
Date: 2026-09-25

## Context

This fork needs a community deployment that an operator can run with Docker,
their own domain, mail delivery, storage and identity providers. The existing
React web app and Node backend already implement substantial community behavior.
The backend is coupled to hosted services through eager startup initialization,
provider-specific templates, upload flows and some administrative assumptions.

The presence of editor or AI-assistant configuration is not evidence that the
application needs a framework rewrite. Reproducible builds, explicit service
boundaries, testable authorization and usable contributor documentation are the
criteria for this work. Contributor access must not depend on a paid editor or
AI service.

## Decision

Retain React/Vite, Node/Sails/GraphQL, PostgreSQL/PostGIS and Redis initially.
Keep the monorepo and upstream-compatible migrations. Remove mandatory external
service dependencies incrementally, delivering working user flows with each
adapter. Do not introduce microservices, Kubernetes or a replacement application
framework as prerequisites for a community installation.

| Concern | Community baseline | Optional extension |
| --- | --- | --- |
| Web/API/jobs | Existing application image with separate web, API and worker processes | Measured scaling later |
| Data | PostgreSQL/PostGIS and Redis on private networks, persistent volumes | Operator-managed compatible services |
| Login | Local email/password and explicit administrator grants | One or more operator-configured OIDC providers |
| Email | SMTP adapter and versioned templates in this repository | Existing hosted adapters behind the same interface |
| Files | Direct authenticated uploads and a persistent filesystem adapter | S3-compatible adapter later |
| Payments | Disabled without credentials | Explicitly enabled payment integration |
| Analytics, error reporting, push and maps | No mandatory third-party accounts; disabled features have a usable fallback | Explicit opt-in with capability checks |
| Operations | Docker Compose, HTTPS ingress, explicit jobs, backup/restore and migration checks | Operator's choice of external scheduler/proxy |

The baseline has five persistent application/data containers: web, API, worker,
PostgreSQL and Redis. Maintenance runs as a one-shot container. File storage is
a volume, not an additional mandatory service. An HTTPS proxy, SMTP relay and
OIDC provider may be independently hosted or connected to existing services;
their implementations and topology are not imposed by the application. An OIDC
provider is optional for the instance and need not run on the same host.

### External OpenID Connect login

Hylo already includes an OIDC **provider** that issues tokens to its clients.
The new requirement is also to act as a **relying party**, accepting browser
login from an operator's identity providers. Preserve the embedded provider and
its signing keys. Do not overload `OIDC_KEYS` with external-provider settings.

Configure multiple providers server-side with stable IDs, display names, exact
issuers, client IDs and secrets. Login UI consumes public capabilities only.
Use a maintained client library with Authorization Code flow, PKCE S256 and
session-bound single-use state/nonce, plus issuer, signature, audience and token
lifetime checks. Only operators can configure discovery targets. Identity is
the exact `(issuer, subject)` pair; labels and email addresses are not keys.
These constraints follow [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html)
and the supported flow in [openid-client](https://github.com/panva/openid-client).

Do not automatically link accounts by matching email. Linking requires an
authenticated user, recent reauthentication and a uniqueness check; an existing
identity cannot move silently to another user. Respect signup/invitation policy
and account restrictions. Require verified email or the local verification
flow. Claims do not grant platform-administrator rights automatically. Preserve
local login and recovery when a provider is unavailable. Browser SSO comes
first; native SSO and automated group/role provisioning are follow-up work.

### Mail and storage boundaries

Mail callers request a named message with validated data; an adapter renders
repository-owned templates and delivers through SMTP. Authentication mail and
optional notifications have separate controls. Failures must be observable and
safe to retry. Automated tests use a local SMTP sink.

Upload callers use storage operations rather than constructing provider URLs.
The backend enforces content, size and ownership rules. Private attachments
remain subject to group/post authorization at download time; never expose the
entire volume through the web server. Document intentionally public images.
Keep existing content readable while introducing the adapter and define an
explicit migration path. Database metadata and media must be restored together.

### Capabilities and contributors

Validate configuration centrally and expose only public capabilities to the
web app. Disabled integrations must not initialize clients, execute jobs or
offer unusable UI actions. A community acceptance test must exercise real core
flows without public SaaS access, not merely a successful process start.

Document contributor setup and checks independently of assistant tools. Keep
decisions and generic operator documentation in the repository. Preserve useful
upstream conventions and history so later upstream fixes remain practical to
merge. Replace older libraries only through bounded compatibility work backed
by tests, not as an unrelated part of containerization.

## Delivery and acceptance

1. [#1](https://github.com/AlexDorsten/hylo/issues/1) / [#2](https://github.com/AlexDorsten/hylo/issues/2): reproducible image, least-privileged database bootstrap and configurable HTTPS origin.
2. [#3](https://github.com/AlexDorsten/hylo/issues/3) / [#6](https://github.com/AlexDorsten/hylo/issues/6): local identity, explicit administrators and optional payments.
3. [#4](https://github.com/AlexDorsten/hylo/issues/4) / [#5](https://github.com/AlexDorsten/hylo/issues/5): SMTP and direct uploads with local storage.
4. [#11](https://github.com/AlexDorsten/hylo/issues/11): configurable external OIDC login and account-linking tests.
5. [#12](https://github.com/AlexDorsten/hylo/issues/12): capability-gated integrations and an end-to-end community test without mandatory SaaS access.
6. [#7](https://github.com/AlexDorsten/hylo/issues/7), [#8](https://github.com/AlexDorsten/hylo/issues/8), [#9](https://github.com/AlexDorsten/hylo/issues/9): scheduled work, restore/update exercises and a verified installation guide.

Production acceptance includes registration, recovery, both local and external
login, private group/post/file access, notifications, background processing and
restore. The current Docker foundation does not yet satisfy those criteria.
The [installation guide](../self-hosting/README.md) distinguishes implemented
configuration from planned functionality; do not add inert provider settings
that appear to enable unfinished adapters.

## Consequences

This keeps community features and upstream changes usable while progressively
reducing deployment dependencies. It also retains existing framework debt and
requires careful tests around legacy login, email and file behavior. Filesystem
storage initially targets a single-host deployment; multi-host workers require
a deliberately shared storage backend. Optional adapters and the community
baseline need separate compatibility tests.

All public examples are generic. Filled configuration, operator hosts, access
details and inventories of other applications stay outside the fork, its
issues, PRs, logs and screenshots.
