# Community functionality roadmap

Status: incremental implementation in draft PR #21; not a released feature set.

The community fork will retain the existing Hylo core and improve complete user
workflows incrementally. Docker operation, configurable external OIDC providers
and removal of mandatory SaaS dependencies remain prerequisites for independent
operation; see [the self-hosting work](https://github.com/AlexDorsten/hylo/pull/10)
and [community capabilities](https://github.com/AlexDorsten/hylo/issues/12).
Successful startup is not evidence that a community can complete its work.

## First priority: discussions that lead to accountable decisions

A member should be able to follow a topic from its question and background through
clarification, alternative proposals, one or more decision rounds, a recorded
outcome and its follow-up. A late participant must be able to understand both the
current state and how it was reached without reading every comment.

The first implementation increment supports a private group. Cross-group voting,
public guest ballots, delegation and genuinely anonymous ballots require separate
acceptance criteria before being advertised. Existing Hylo functionality remains
available; legacy proposals must remain readable during migration.

### Current evidence

Inspection of the existing code found threaded comments, proposal templates,
single-choice and unrestricted multiple-choice voting, deadlines and quorum UI.
Templates labelled consent/consensus do not establish distinct voting algorithms:
the stored voting methods are currently single and multi-unrestricted. Discussions
and proposals are separate post types. A durable sequence of decision rounds,
per-alternative resistance ballots and accountable outcomes is not yet established.

One concrete defect is repaired on the implementation branch: the editor submits all options on
an ordinary proposal edit, and the backend used to delete their votes even if the
options were unchanged. Preserving identical options is a bounded repair. It does
not make changes to active or completed decisions immutable; round history is the
next structural step.

The next implemented increment adds a member-only discussion overview: editable
context, a separate summary, open questions and attributed revision history.
Existing posts, comments and attachments are preserved. See the
[discussion review evidence and remaining release gates](review/discussion-overview.md).
This does not yet add decision rounds, systemic consensus or automated summaries.
Issue #14 remains open until the broader legacy access checks and integration
with the deployment branch are complete.

With every increment, assess [optional AI assistance](ai-assistance.md): useful
tasks, minimum permitted input, human review and failure cases. The core workflow
must remain usable without an AI provider.

### Delivery slices

| Slice | Demonstrable user outcome | Dependency |
| --- | --- | --- |
| Preserve existing votes | Edit a proposal title/body without a ballot reset; warn when options really change | None |
| Discussion context and summary | Read the question, context, latest summary, open questions and their revision history above the existing conversation | None |
| Loomio feasibility demonstration | Follow one private-group decision across a local Hylo/Loomio setup and document identity, access, SK, history and operational gaps | None; maintainer decision before selecting an integration |
| Decision rounds in a discussion | Create, vote in, close and revisit a round without losing earlier versions | Context slice; feasibility decision for implementation approach |
| Systemic consensus | Evaluate all alternatives and an explicit passive option using resistance scores and inspect a correctly closed result | Decision rounds |
| Outcomes and follow-up | Record what happens next, who owns it and when it will be reviewed; connect any next round | Decision rounds and SK for its scenario |
| Return, notify and export | Resume a long discussion at unread activity, receive controlled reminders and retrieve a permission-safe decision record | Context, rounds and outcomes |

Every slice needs persisted data, authorization, API behavior, usable web UI and a
real-data acceptance test. A helper, mock screen or passing build alone does not
complete a slice. Use the linked issue list below for precise criteria and status.

## Systemic consensus is a required decision method

Implement [the systemic consensus specification](systemic-consensus.md), including
facilitated clarification and subsequent rounds. Do not reduce it to a yes/no poll
or relabel approval points as resistance. The minimum-resistance result informs a
recorded human decision; it must not silently execute an action.

## Loomio: investigate reuse before duplicating its decision engine

Loomio is a reference for coherent workflows, not a requirement to copy its
interface or add another mandatory service. Its documentation keeps discussion
context, comments, decisions and outcomes together. Its Score poll exposes a
numeric scale and aggregate results, but that does not demonstrate all of our SK
requirements. See [threads](https://www.loomio.com/docs/en/user_manual/discussions/using_discussions)
and [Score](https://www.loomio.com/docs/en/user_manual/polls/score).

A bounded demonstration must establish what the current self-hosted release and
supported APIs actually allow: shared login with an operator-selected OIDC provider,
account mapping, private-group access and revocation, creation and return navigation,
resistance rather than approval ranking, passive option, complete ballots, revisions,
result import and permission-safe export. Record exact versions, reproducible setup,
licensing constraints from upstream sources, failure behavior and maintenance cost.

Choose and record an ADR after that evidence: native rounds, an optional adapter,
or a justified hybrid. No remote account, SaaS subscription or unverified iframe
flow may become a hidden prerequisite. OIDC login alone does not synchronize group
membership or prove authorization. Until a decision is recorded, the native model
is a design candidate, not a committed migration or replacement of Hylo.

## Functional acceptance for the rest of the community platform

These are audit scenarios, not assertions that features are missing or verified.
Run with synthetic accounts against the real API, database, worker and local mail
capture, with vendor integrations disabled. Mark each result pass/fail/not-tested
with version, evidence and a focused follow-up issue for failures.

| Area | Complete acceptance scenario |
| --- | --- |
| Membership and identity | Invite a person, sign in through a configured OIDC provider, receive the intended group access, remove membership and verify access is revoked |
| Discussions and decisions | Private-group moderator and three members clarify alternatives, vote, close, publish an outcome, return later and export; an outsider sees no private content |
| Events | Create an event in one timezone, invite, RSVP, change its time, receive the update and cancel it without stale attendance state |
| Projects and tasks | Join a project, assign a task, record progress and completion, and recover the accountable owner and history |
| Offers, requests and resources | Publish, find, respond, record fulfillment or availability and retrieve it through search with correct access |
| Files and search | Upload into operator-owned storage, retrieve from allowed contexts, deny outsiders, delete and restore from backup without stale access |
| Notifications | Follow/unfollow, receive in-app and SMTP updates, respect preferences, retry a delivery failure without duplicate messages |
| Operations | Rebuild, migrate, back up and restore a populated installation containing memberships, discussions, ballots, outcomes and files |

Start with the discussion/decision scenario. Open subsequent module tickets from
observed failures instead of speculative rewrites. New community release claims
must identify which scenarios and clients were verified. The first target is web;
native mobile must safely display or explicitly mark unsupported decision methods
until its own acceptance flow passes, rather than misrendering SK as a legacy vote.

## Common release criteria

- Authorization is enforced on every read, write, subscription and export. A stale
  session after removal does not retain private access.
- Concurrent voting, closing and edits cannot mix versions or lose accepted ballots.
- Keyboard, screen-reader labels, narrow viewports and all existing locale strings
  are covered. Scores are not conveyed by color alone.
- Notifications respect preferences; delivery failures cannot change a decision.
- Migrations preserve existing posts/votes, and backup/restore preserves round and
  outcome history. Exports declare their privacy level and ballot visibility.
- Public evidence uses synthetic communities only. No operator hosts, credentials,
  accounts, service inventories or deployment topology belong in the fork.

## Tracking

- [#13 Preserve votes on ordinary proposal edits](https://github.com/AlexDorsten/hylo/issues/13)
- [#14 Discussion context and summary](https://github.com/AlexDorsten/hylo/issues/14)
- [#15 Loomio feasibility and architecture decision](https://github.com/AlexDorsten/hylo/issues/15)
- [#16 Immutable decision rounds](https://github.com/AlexDorsten/hylo/issues/16)
- [#17 Systemic consensus](https://github.com/AlexDorsten/hylo/issues/17)
- [#18 Outcomes and follow-up](https://github.com/AlexDorsten/hylo/issues/18)
- [#19 Return to unread activity and reminders](https://github.com/AlexDorsten/hylo/issues/19)
- [#20 Permission-safe decision export](https://github.com/AlexDorsten/hylo/issues/20)

Implementation status is tracked in the issues and PRs; this document does not
mark the planned workflows as complete. The return/export slice is tracked as
two independently verifiable deliverables.
