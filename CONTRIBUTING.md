# Contributing to this fork

This fork is making the existing Hylo application independently operable.
Read the [community architecture decision](docs/adr/0001-community-self-hosting.md)
and [Docker guide](docs/self-hosting/README.md) for the direction and current
limitations. No particular editor or AI assistant is required to contribute.

Use the Node version in `.nvmrc` and Yarn version in `package.json`. From the
repository root, run `corepack enable`, `yarn install --immutable` and
`yarn build-packages`. Follow the [backend setup](apps/backend/README.md) and
[web setup](apps/web/README.md) for application configuration. The full developer
install includes more workspaces than the focused Docker build.

Issues and pull requests for this work belong in
[AlexDorsten/hylo](https://github.com/AlexDorsten/hylo/issues). Check dependencies
and acceptance criteria before picking an issue. Use a `codex/` branch and
target `dev`. Link partial work with `Related to #N`; close an issue only after
all acceptance criteria pass. Keep framework changes separate from adapter
work unless they are required for that feature.

Run the tests for the behavior you change, including authorization failures
where relevant. For the Docker foundation, `node --test test/self-hosting/*.test.cjs`
requires the backend/web dependencies and permission to bind local test ports.
The self-hosting CI additionally builds the image, bootstraps a disposable
database, verifies its privileges and guard, and runs migrations. A passing
bootstrap is not evidence that the complete application is production-ready.
Web changes also need the relevant lint, build and UI checks; follow the
[web contribution guide](apps/web/CONTRIBUTING.md). Add translations when adding
visible strings.

Describe the resulting behavior, affected issue and checks actually performed
in the PR. Include sanitized screenshots for visual changes. Never commit
filled environment files, private keys, database exports, operator domains,
access information or inventories of other applications. Use examples such as
`hylo.example.org` and `id.example.org`.
