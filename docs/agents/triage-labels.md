# Triage labels

| Canonical state | GitHub representation |
| --- | --- |
| needs-triage | No readiness label yet |
| needs-info | `question` |
| ready-for-agent | `agent-ready` (also check blockers) |
| ready-for-human | `question`, with an explicit decision recorded in the issue |
| wontfix | `wontfix` |

Use `bug`, `enhancement` or `documentation` for kind, and `area:self-hosting`
for Docker deployment work. AFK/HITL are written in issue bodies; HITL identifies
a decision needed from an operator or maintainer, not permission to publish
private infrastructure information.

Do not silently create a new label vocabulary. `agent-ready` requires a concrete,
bounded task with enough information to implement and verify it independently.
An enhancement or roadmap item is not automatically ready for an unattended agent.
