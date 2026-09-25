# Issue tracker

Use GitHub Issues in **AlexDorsten/hylo** for work in this fork. Pull requests
target `dev`; use `codex/` branch names. The upstream project is Hylozoic/hylo,
but do not create or modify upstream issues as a side effect of fork work.

```sh
gh issue list --repo AlexDorsten/hylo
gh issue view NUMBER --repo AlexDorsten/hylo
gh pr create --repo AlexDorsten/hylo --base dev
```

Self-hosting work has the `area:self-hosting` label. Issues contain acceptance
criteria and a `Blocked by` section. `agent-ready` describes a specified task;
check dependencies before starting it. Use `Related to #N` for partial work and
`Closes #N` only when all acceptance criteria are verified.

All published material must remain generic. Keep operator-specific hosts,
credentials, account names, inventories of other services and private deployment
configuration outside this repository, issues, PRs, logs and screenshots.
