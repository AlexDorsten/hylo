# Optional AI assistance: ongoing assessment

Assess AI assistance with each community feature and update this document and its issue. These are opportunities, not implemented capabilities. The discussion overview currently makes no AI calls and requires no AI service.

## Principles

- Every core discussion and decision workflow must work without AI.
- Assistance creates clearly labelled drafts. People choose whether to edit and publish them; published revisions retain a responsible human author.
- Give a provider only explicitly selected, currently accessible material. Recheck membership when gathering sources and showing results, including after access has been revoked. Do not silently include other groups, private messages or old revisions.
- Before implementation, decide provider configuration, self-hosted options, retention, consent and cost limits. No automatic external transmission; no new mandatory hosted dependency.
- Treat community text and attachments as untrusted input, never as instructions to tools. The model must not gain extra access or execute actions embedded in discussion content.
- Preserve minority views, uncertainty and links to evidence. Make missing sources and stale drafts visible. Human review must be possible without trusting the model's conclusion.

## Opportunities by delivery slice

| Slice | Possible assistance | Minimum input and human control | Failure cases to test |
| --- | --- | --- | --- |
| #14 Context, summary and open questions | Suggest a summary; identify unanswered questions; improve plain language | Explicitly selected discussion contributions with stable source links and versions. An author or moderator reviews a diff before publishing a normal revision. | Invented agreement, missing objections, wrong attribution, stale context, prompt injection, revoked access |
| #15–16 Decision rounds | Suggest duplicates among options; identify missing explanations or evidence | Only the selected round and discussion. Facilitator decides whether to combine or change anything. | Combining meaningfully different options, framing bias, hiding minority proposals |
| #17 Systemic consensus | Explain the resistance scale; draft neutral option descriptions; group explicitly submitted reasons | Participants supply their own resistance values. Aggregate explanations must follow the round's visibility rules and receive facilitator review. | Inferring resistance from text, changing votes, pressure toward a preferred result, exposing individual ballots |
| #18 Outcomes and follow-up | Draft an outcome explanation and possible next steps | The actual recorded result and approved discussion sources. A person publishes the outcome; task owners accept assignments. | Confusing low resistance with endorsement, inventing commitments or owners |
| #19 Catch-up | Prepare a personalised reading guide since the last visit | Only newly accessible contributions and approved summaries. Reader can inspect sources. | Omitting important dissent, stale membership, treating generated text as official decisions |
| #20 Export | Check an export for missing references; optionally translate or simplify an approved summary | The selected export scope only. User reviews derived text; preserve original and provenance. | Altered meaning, inaccessible source disclosure, presenting translation as the authoritative record |

AI must never cast votes, infer an individual's resistance, decide membership, suppress contributions, publish summaries or turn suggestions into commitments on its own. Aggregate result calculation remains deterministic and independently testable.

## Current assessment: discussion overview

The separately versioned summary and open questions provide a useful future review surface. A future assistant could propose changes to these fields while preserving the current `expectedVersion` conflict check. It still needs an explicit source-selection and citation model, provenance for assisted drafts, provider configuration and access-revocation tests. None of those exists yet; do not imply that the current editor is AI-assisted.

## Current assessment: discussion access and revocation

The access review found that a retained follow, a requested search group or a previously opened live channel could outlast actual membership. Those must never authorize a future assistant's sources. Explicitly selected, currently readable comments could help draft a source-linked summary or list unanswered questions; check each selected source again when collecting inputs, releasing a completed draft and opening or exporting it later. If access changes during generation, withhold the derived draft and require a fresh authorized selection. Removing a user from a group cannot erase information already received by that user or a provider.

Human review must show the selected sources, their revisions, omissions and any access changes before publishing a normal overview revision. Test cross-post reply references, revoked access during generation, stale search results, deleted sources and citations to inaccessible contributions. The GraphQL/search and delivery checks cover only the paths documented in the review notes, now including persisted discussion notifications, private new-post group events and inherited moderation. They do not establish permission for an arbitrary connector or generated draft. No broad data connector, AI provider or automatic summary publication is introduced or authorized by this slice.

## Current assessment: delayed delivery and reading guides

An optional assistant could draft a catch-up digest from explicitly selected, currently readable contributions and approved overview revisions. The new delivery checks illustrate an additional requirement: queue creation is not authorization to deliver later. Recheck every source and the intended recipient when releasing a generated digest or notification, and again when opening a saved draft. A previously joined socket, retained follow or preloaded activity must not bypass that check.

Before publication, a human reviews source links, disagreements, unresolved questions and the draft's date. Withhold drafts whose sources became inaccessible or were deleted; do not quietly produce a misleading partial summary. Test membership loss during generation and queueing, public-to-private changes, inactive accounts/groups, deleted comments, another linked group still granting access, and cross-recipient delivery. Already received information cannot be recalled. This is an assessment only: no automated reading guide, AI service or external transmission is added.

## Current assessment: persisted drafts and moderator access

A saved catch-up guide or suggested summary could remain useful across visits, but
its storage row and every nested source link must enforce the intended recipient's
current access. Pagination, counts and cached source excerpts must not reveal
inaccessible material. A moderator role is valid only while its group, assignment
and membership remain active; ordinary membership in a parent group grants no
private-space access. People review source versions, unresolved objections and
omissions before publishing any assisted text. Test role removal, disabled roles,
source deletion, cross-recipient records and stale schema caches. No AI service,
provider configuration or data transfer is introduced by these access changes.
