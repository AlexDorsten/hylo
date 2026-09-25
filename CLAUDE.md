# Hylo Community Fork — Project Guide

## Fork boundaries

- Work in `AlexDorsten/hylo`; upstream is a reference, not a publishing target.
- Public code, issues, PRs, fixtures and screenshots must contain only generic deployment examples and synthetic data. Keep operator infrastructure, domains, accounts, credentials and unrelated services out of this repository.
- For every community feature, assess where optional AI assistance could help and record the result in `docs/community/ai-assistance.md`. Describe the task, permitted input, human review and failure cases. An opportunity assessment does not authorize adding an AI provider or transmitting community data.

## Project Structure

Monorepo with Yarn workspaces:
- `apps/web` — React web frontend (Vite, port 3000)
- `apps/mobile-leap` — Expo / React Native mobile app
- `apps/backend` — Node.js API server (port 3001)
- `apps/desktop` — Electron desktop app
- `packages/` — Shared packages (`shared`, `graphql`, `hooks`, `contexts`, `presenters`, `navigation`, `urql`)

## Agent skills

### Issue tracker

Use GitHub Issues in `AlexDorsten/hylo`. See `docs/agents/issue-tracker.md`.

### Triage labels

Reuse the existing `agent-ready` and `wontfix` labels; other triage roles have no configured label yet. See `docs/agents/triage-labels.md`.

### Domain docs

Community domain context currently lives in `docs/community/`; no root context map or ADR directory exists yet. See `docs/agents/domain.md`.

## Common Commands

```bash
# Dev servers
yarn web:dev          # Start web frontend (builds packages first)
yarn backend:dev      # Start backend API

# Testing
cd apps/web
yarn test --watchAll=false                        # Unit tests (Jest)
yarn test --watchAll=false --testPathPattern=Name # Unit tests for specific component
yarn test:e2e                                     # E2E tests (Playwright, headless)
yarn test:e2e --headed                            # E2E tests (visible browser)

cd apps/backend
yarn test                                         # Backend tests

# Linting
cd apps/web && yarn lint
cd apps/web && yarn lint:fix

# Build
cd apps/web && yarn build
```

## GitHub

- Repo: `AlexDorsten/hylo`
- Main branch: `dev`
- Issues: `gh issue list --repo AlexDorsten/hylo`
- PRs target `dev` branch

## Workflow: Ticket to PR

When picking up and completing work autonomously, follow this process:

### 1. Find a ticket
```bash
gh issue list --repo AlexDorsten/hylo --label "agent-ready" --limit 10
gh issue view <number> --repo AlexDorsten/hylo
```

### 2. Create a branch
```bash
git checkout dev
git pull origin dev
git checkout -b codex/<issue-number>-short-description
```

### 3. Implement the changes
- Read relevant code before modifying
- Follow existing patterns and conventions
- Keep changes focused on the ticket scope

### 4. Test your work

**Unit tests:**
```bash
cd apps/web && yarn test --watchAll=false --testPathPattern=<relevant-pattern>
```

**E2E / Playwright screenshots:** Playwright is configured in `apps/web/playwright.config.js`.
- Tests live in `apps/web/e2e/`
- Auth is automatic — reads `E2E_TEST_USERNAME`/`E2E_TEST_PASSWORD` from `apps/web/.env`
- The dev server auto-starts when running tests (if not already running)
- Run: `cd apps/web && yarn test:e2e`

**Take a screenshot of any authenticated page:**
```bash
cd apps/web && E2E_PATH=/groups/building-hylo yarn screenshot
```

**Interactive screenshots (click, then capture):** Write a spec in `apps/web/e2e/` that interacts with the page and screenshots the result. See `apps/web/e2e/invite-copy.spec.js` for an example.

**Build verification:**
```bash
cd apps/web && yarn build
```

### 5. Create the PR
- PRs target `dev` branch
- Link the issue in the PR body (`Closes #NUMBER`)
- Include Playwright screenshots for visual/UI changes
- Include a test plan describing what was verified

**Screenshots:** Use isolated synthetic fixtures, inspect images for private data, and store review evidence under `docs/community/review/`. Link to the fork's committed images in the PR.

## Autonomous Agent Workflow

For working through the backlog autonomously (investigate → fix → PR):

### For each issue:
1. **Read the ticket** — understand what's reported
2. **Explore the code** — find the relevant component/logic
3. **Can you identify the problem?**
   - **YES** → Fix it, take Playwright screenshots, open a PR
   - **NO** → Comment on the issue with what you found and what info is missing
4. **Is this a duplicate or already fixed?**
   - **YES** → Comment with evidence and close

### Triage criteria for `agent-ready` label:
- Clear bug with screenshot or repro steps
- Expected vs actual behavior described
- Scoped to a single component/area
- Fix is deterministic (broken → correct)
- Does NOT require: design mockups, product decisions, mobile-native debugging, or multi-system coordination

### Confidence levels:
- **High** — clear bug, can fix and verify with screenshots
- **Medium** — understand the problem, may need a design decision mid-way
- **Low** — under-specified, needs human input before starting

### Running Playwright (important):
Use this from `apps/web/` — `npx playwright` picks up a wrong global version:
```bash
yarn node node_modules/@playwright/test/cli.js test [args]
```
Or use the package.json scripts: `yarn test:e2e`, `yarn screenshot`

## E2E Testing Guidelines

- Place tests in `apps/web/e2e/`
- Use `data-testid` attributes for selectors when possible
- Tests should be independent and not rely on state from other tests
- Use Playwright's auto-waiting — avoid manual sleeps
- For authenticated flows, set up auth state in a global setup or per-test

## Code Conventions

- Web app uses React with Tailwind CSS (legacy SCSS modules still exist but are being removed)
- GraphQL for API queries (some in `.graphql` files, most defined inline)
- Shared logic goes in `packages/` when used by both web and backend
- Standard.js linting for the web app

## Web App Guidelines
- When adding new strings always translate them to the different languages in public/locales
