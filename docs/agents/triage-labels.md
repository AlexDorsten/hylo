# Existing triage vocabulary

| Role | Configured GitHub label |
| --- | --- |
| needs-triage | Not configured |
| needs-info | Not configured |
| ready-for-agent | `agent-ready` |
| ready-for-human | Not configured |
| wontfix | `wontfix` |

For roles without a configured label, explain the status in an issue comment.
Do not silently create a new label vocabulary. `agent-ready` requires a concrete,
bounded task with enough information to implement and verify it independently.
An enhancement or roadmap item is not automatically ready for an unattended agent.
