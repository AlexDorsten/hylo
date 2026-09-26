# ADR 0002: Native discussion decision rounds and systemic consensus

Status: Accepted, 2026-09-26. Explicit maintainer decision: build decision rounds
and systemic consensus directly in Hylo, incrementally retaining its core.

## Context

Issues #16 and #17 need a frozen question, alternatives, rules and electorate;
complete resistance ballots; private member access; and preserved previous rounds.
Hylo's legacy proposal votes do not provide that contract. They must stay readable.

The source review for #15 examined Loomio at
`390573d745f990f80c4f4f37fd4f65f2470a06c8`. Its score input and editable poll
lifecycle require changes for explicit unanswered values and frozen rounds. Its
OAuth and group membership also require separate authorization integration.
This was a source assessment, not a completed deployment or OIDC acceptance test.
The proposed Loomio demonstration is superseded by this native implementation
decision; it must not be reported as having passed.

## Decision

Add separate discussion decision rounds within the existing Node/GraphQL,
PostgreSQL and React stack. No extra service or container is required.

- First scope: one private hosting group, current active membership, author or
  group moderator facilitation. Cross-posted/public discussions are excluded.
- New tables retain rounds, the opening electorate, append-only ballot revisions,
  idempotency receipts and lifecycle events. Legacy proposal tables are unchanged.
- Single choice and systemic consensus are explicit methods. Unsupported methods
  are rejected, never interpreted as another method.
- Opening freezes configuration and deduplicates active group members. Later
  joiners cannot vote; removal revokes access while accepted votes and the original
  denominator remain. A changed electorate requires a separate linked round.
- SK requires exactly one explicit passive option and an integer 0–10 for every
  option. Abstention and withdrawal contain no scores. Missing is never zero.
- The server serializes commands, checks versions and checks wall-clock deadlines
  after locks. Retries reauthorize and never duplicate ballots or lifecycle events.
- Participants can retrieve only their own ballot. Aggregates are available after
  closure, to current hosting-group members. Operator anonymity is not promised.
- Closing is explicit, including an explicitly confirmed early close. The server
  rejects votes after the deadline even if a facilitator has not closed the round.
- A new linked round starts empty. The ranking is an assessment, not an adopted
  outcome. Structured outcomes/owners/review dates remain in #18; exports in #20.
- No ballot data enters post payloads, subscriptions, notifications or ordinary
  exports. Native mobile clients keep their existing discussions and proposals;
  the new round controls initially live in the responsive web interface.

## Consequences and validation

Hylo owns the additional domain logic and must test access revocation, concurrent
close/vote, complete-ballot arithmetic, historical preservation and backup/restore.
The deployment adds a migration to the existing database. No production migration
is implied by accepting this ADR; release checks precede deployment.

Small-group aggregate results can disclose preferences. The UI explains this and
operator access before voting. No AI provider or external data flow is added;
optional assistance opportunities are documented separately.
