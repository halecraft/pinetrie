# S107 — a real model follows a pinned card, keeps to it with no new block, takes an edit, and drops it when unpinned

**Status:** Answered. ADR-0048, step 5's open question after S92, for
`PLAN-2026-10-03-pinned-cards`. Nothing in the design changes. Numbered
S101 until 2026-10-05, when another spike held that number, then S102
until 2026-10-05, when two files held that number.

**Question.** S92 measured what the model is *given*: a `<pinned-cards>`
block written with a run's prompt only when the cards changed, restating
every pinned card and naming those unpinned since, and the system prompt's
rule that "the latest block is what holds". Does a real model act on it?
In particular:
1. does it follow a pinned card at all;
2. does it keep following one when no new block is written, the
   "only when the cards changed" half of S92's design;
3. does the latest block replace an earlier one;
4. does "No longer applies" stop it.

**Kill criterion.** A failure at 2 or 4 with the others passing: the design
would need a block on every run, or stronger words for a retired card.

**Throw away.** The probe itself: `.plans/pinned-model-probe/` (`probe.ts`
and its `README.md`), not committed.

**Method.** Duane ran the probe on the Mac on 2026-10-05, with his pi
setup's default model (`{ kind: "configured" }`; the probe did not print
which model that was). The probe starts its own host (`startSuiteHost`)
and drives it as Ada through `join`, as the host suite does. It starts one
agent thread, then creates a card pinned at its end:

> Every reply you write in this thread must end with the word MARMALADE, on
> a line of its own.

It then sends four prompts, each after one change, and reads the cards
entry that is the prompt's parent, if any, and the reply. One trial.

Before this, it ran in a lane with a scripted stand-in that obeys the
latest block exactly (`PROBE_SCRIPTED=1`, 2 trials). Every step passed
there, which checks only the probe's own wiring.

**Answers.**

| step | change before the prompt | cards entry the run got | reply | |
|---|---|---|---|---|
| pinned | the card is pinned | the card | `2 + 2 = 4.\n\nMARMALADE` | pass |
| unchanged | nothing | none | `Blue.\n\nMARMALADE` | pass |
| edited | MARMALADE → PERSIMMON | the card, restated | `Apple.\n\nPERSIMMON` | pass |
| unpinned | the card is unpinned | no cards; 1 retired | `Fox.` | pass |

1. **The model follows a pinned card.**
2. **It keeps following one when no new block is written.** The block from
   an earlier run, still in the context, holds. So writing the block only
   when the cards change, which keeps the prompt cache (S92), costs nothing
   in obedience here.
3. **The latest block replaces the earlier one.** After the edit, the reply
   ends with the new word, and the old word does not appear.
4. **"No longer applies" stops it.** With no cards and one retired, the
   reply has neither word.

**Limits.** One trial, one model, four short turns in a fresh thread. It
says nothing about a long thread, where an early block is far back in the
context, or about pi's compaction, which S92 found carries the latest
block. `PROBE_TRIALS=5` or another model (`PROBE_PROVIDER`,
`PROBE_MODEL`) would widen it.
