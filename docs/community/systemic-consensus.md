# Systemic consensus (Systemisches Konsensieren, SK)

Status: required community capability; proposed implementation contract. This is
not implemented by the existing single/multiple-choice proposal model.

## Purpose and terms

A **discussion** holds a question, context, wishes for a good solution, constraints,
comments and a maintained summary. A **decision round** freezes a question,
solution alternatives, electorate and method. A **ballot** is one person's complete
assessment in that round. An **outcome** records the human decision and follow-up.

For SK, participants assess resistance to each alternative. Lower total resistance
is preferred. The **passive option (Passivlösung)** explicitly describes what
happens without an agreed change. It is not necessarily the status quo: an existing
fallback procedure might let another body decide. It is assessed on the same scale.
This interpretation is illustrated by the method practitioners' [relocation case](https://sk-prinzip.eu/2019/10/09/eine-firma-uebersiedelt-ohne-gewinner-und-verlierer/).

The method involves understanding concerns and improving solutions, not just
calculating a ranking; see [SK's method](https://sk-prinzip.eu/methode/) and the
[first-party tool's description of clarification and iteration](https://gruppenentscheidung.de/).

The constraints below are product choices for a testable first implementation,
not a claim that every SK process must use this exact workflow or scale.

## Prepare and open

- Begin inside one private group, using the existing discussion and membership
  model. The author or a group moderator can facilitate the round.
- Collect alternatives and optional concerns in the discussion before opening.
  Require at least one actionable alternative and exactly one non-empty, explicitly
  marked passive option. Do not silently insert a generic "do nothing" answer.
- Explain integer scores **0 = no resistance** through **10 = maximum resistance**.
  Zero is not a declaration of enthusiasm; ten is not an automatic veto.
- Before opening, display eligibility, deadline/timezone, participation threshold,
  ballot visibility and how the result will be used. These settings cannot change
  in the active round. Do not introduce an arbitrary acceptance-percentage cutoff.
- First-version eligibility is active members of the hosting group at opening,
  deduplicated by person ID, stored as a round snapshot. Later joiners participate
  in the next round. Removed members lose access and cannot submit/update; previously
  accepted ballots remain counted and the original denominator remains visible.
  A materially changed electorate can be handled by cancelling and replacing the
  round, preserving the old record. Never silently rewrite its membership snapshot.
- Require an explicit minimum number of complete ballots between 1 and the snapshot
  electorate size. Show the value and denominator before submission and at results.
- First-version ballots are **confidential from other participants**, not anonymous
  from the operator: identity is retained to enforce one ballot per member. Explain
  that distinction before voting. Do not expose other people's per-option ballots
  or ballot-linked identifiers through API, subscriptions, logs or ordinary exports.
  Only the voter can retrieve their own ballot; group moderators see aggregates.
  Aggregate results become visible to authorized group members when the round closes.
  A separate reviewed design is needed before offering anonymous or secret ballots.

## Submit and revise a ballot

- Each option, including the passive option, must receive an explicit integer 0–10.
  Controls start unanswered. No preselected zero, automatic conversion, coercion of
  empty strings/null to zero, or default response on a newly added alternative.
- Validate option IDs against the frozen round, reject duplicates, missing/extra
  options, decimals and out-of-range values on the server as well as in the UI.
- Persist the entire ballot atomically. Repeated submission retries are idempotent;
  before closing, a member may replace or withdraw their own ballot. Stale competing
  edits return a conflict rather than silently overwriting a newer ballot.
- Abstention is an explicit separate participation state, with no numeric scores.
  It is reported separately and does not meet the complete-ballot threshold. Missing
  responses are also reported separately and never count as zero resistance.
- Allow optional identified discussion comments about concerns, with clear visibility.
  Do not require a justification for a high score or reveal which ballot it belongs to.

## Close and interpret

Use the same complete-ballot set for every alternative. For N accepted ballots and
scores r(i,j), calculate total R(j) = sum(r(i,j)) and mean R(j)/N. Sort by total
ascending; mean is supplementary. Ranking and equality use exact integer totals,
not rounded display values. Do not label a derived index as the percentage of people
who agree. The first version need not display such an index.

Show the number eligible, complete ballots, abstentions and missing responses,
threshold, closing time, passive option, each option's total and mean, and a simple
aggregate distribution of scores. Explain that aggregates in a very small group
may reveal individual preferences. Avoid automatic claims of unanimity or consent.

Keep these states distinct:

| Condition | Required interpretation |
| --- | --- |
| No complete ballots | No assessment; no ranking, division by zero or selected winner |
| Below the configured threshold | Insufficient participation; descriptive results only |
| One actionable option has the lowest total | Least resistance in this round, subject to the human outcome |
| Passive option alone has the lowest total | Passive option preferred; no automatic change decision |
| Several lowest totals, including or excluding the passive option | Tie; list all tied options without a random/order-based tie-break |
| One or more scores are 10 | Maximum resistance exists; invite voluntary clarification, without an automatic veto |

Closing is a server transaction with a deadline check: a concurrent ballot is
accepted before the close or rejected after it, never partially included. Round
cancellation preserves its ballots/history but produces no adopted result. Retry
of closing must not duplicate outcomes, notifications or exported results.

## Improve proposals and document the decision

After reviewing concerns, ask what should happen next. The facilitator can publish
an outcome (including choosing the passive option), defer/cancel or create a new
round with revised alternatives. An outcome includes rationale, an accountable
owner when action is required, due/review date and links to the relevant discussion
and round. Explain a departure from the numerical ordering.

Changing the question, options, scale, electorate rules or threshold after opening
requires a new round. Never delete or reinterpret old votes and never copy scores
into the new round. Link the superseding round and show all earlier closed/cancelled
rounds. Ordinary commentary and summaries may evolve with attributable revisions;
the question and alternatives presented to voters remain frozen in their round.

## Acceptance examples

Synthetic fixture with three eligible voters, threshold three, two alternatives
and the passive option:

| Voter | A | B | Passive |
| --- | ---: | ---: | ---: |
| One | 0 | 3 | 5 |
| Two | 4 | 3 | 5 |
| Three | 8 | 3 | 5 |
| Total | 12 | 9 | 15 |
| Mean | 4 | 3 | 5 |

B has the least resistance. Verify also:

1. All zeroes produce a tie across every alternative, not a unique winner.
2. Passive [0, 0, 0] is preferred to A/B above; no change is auto-adopted.
3. One missing B value rejects the entire new ballot; an earlier accepted ballot
   remains intact. An explicit zero is accepted.
4. With two complete ballots and one abstention, the threshold is not met.
5. A [10, 0, 0], B [4, 4, 4], Passive [5, 5, 5]: A has the least total resistance
   while maximum resistance is still visible in its aggregate distribution.
6. Withdraw, replace, retry, concurrent submission/close and late submission produce
   one deterministic state; unauthorized users cannot change or inspect ballots.
7. Revise an alternative into round two: round one remains retrievable unchanged,
   round two begins without ballots, and export matches each round's result.
8. Restore a populated backup and recompute identical totals and round/outcome links.

Automate the arithmetic/validation cases, database invariants and a real-browser
private-group flow with facilitator, three voters and an outsider. Include keyboard
and mobile-width score entry, translated explanations and privacy checks on API,
notifications and exports. SK is release-ready only when the entire flow passes;
a calculation helper or renamed poll template is insufficient.
