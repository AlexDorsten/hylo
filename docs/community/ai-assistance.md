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
