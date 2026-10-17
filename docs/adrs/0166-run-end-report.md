# ADR-0166 — A run's verdict is its run-end report, and *verdict* names nothing else

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `docs/glossary.md`, `packages/rules/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0077: the record is `RunEndReportRecord`, stored under
    `pinetrie.runEndReport`; a model's answer is the kind `modelSaid`, with
    its `urgency`.
  - ADR-0075: a run's end request closes with "Answer with the urgency line
    alone." or "Answer with the urgency line, then the summary.", and the
    `ask-digest` skill looks for those words.

**Context.** When a thread's run ends, the host asks a model what that end
asks of the people in the thread (`needs you: <reason>`, `worth a read:
<reason>` or `done`), in the same request as the ask's final digest. A
failed or stopped run's answer is its facts, with no model. The code called
the result a **verdict** (`Verdict`, `VerdictRecord`, `pinetrie.verdict`,
`verdictOf`, the skill's "verdict line"), and a reader needed ADR-0077 to
learn that it reports how a thread's last run ended and what that asks of
its readers. Its model-written half, `Said`, was named for the fact that a
model said it, not for what it says: how urgently people should look.
`verdictOf`, `endReplyOf` and `levelOf` each ended in a bare *of*.

The same word meant three other things: what a drop at the pointer would
do (`DragVerdict`, `data-drag-verdict`), a mutant's result (`KILLED`,
`SURVIVED`, …, in `scripts/mutate.ts`), and plain results in local code and
comments.

**Decision.**

- **A thread's last run's record is its run-end report.**

  | now | becomes |
  |---|---|
  | `Verdict`, `VerdictRecord` and its field `verdict` | `RunEndReport`, `RunEndReportRecord`, field `report` |
  | kind `said`, field `said: Said` | kind `modelSaid`, field `urgency: ReaderUrgency` |
  | `pinetrie.verdict`, `VERDICT`, `verdict.ts` | `pinetrie.runEndReport`, `RUN_END_REPORT`, `run-end-report.ts` |
  | `verdictOf`, `SaidLine`, `SAID_WORDS` | `parseUrgencyLine`, `UrgencyLine`, `URGENCY_WORDS` |
  | `endReplyOf`, `EndReply.verdict` | `parseEndReply`, `EndReply.urgency` |
  | `pendingVerdict`, `writePendingVerdict`, the run step `verdictPending` | `pendingRunEndReport`, `writePendingRunEndReport`, `runEndReportPending` |
  | `Answer`'s `verdict`, `verdict and digest` | `urgency`, `urgency and digest` |
  | `VERDICT_ALONE`, `VERDICT_THEN_DIGEST`, the skill's "verdict line" | `URGENCY_ALONE`, `URGENCY_THEN_DIGEST`, "urgency line" |
  | `readVerdicts`, `SCRIPTED_VERDICT` | `readRunEndReports`, `SCRIPTED_URGENCY` |
  | attention's `Raised` kind `verdict`, `levelOf` | kind `runEnd`, `attentionLevel` |

  `ReaderUrgency`'s values (`needsYou`, `worthARead`, `done`) and the
  attention document's fields are unchanged, so no schema hash moves.

- **The stored records move.** A one-time record migration
  (`apps/pinetrie/host/migrations/0024-run-end-report.ts`) writes each
  record under `pinetrie.verdict` to `pinetrie.runEndReport` in the new
  shape and deletes the old one, in one write. A record in no known shape
  is not moved: no reader decodes it today, the same start's sweep of
  undeclared records deletes it, and the thread's next run end writes a
  new report.

- **The other meanings get their own words.** What a drop would do is a
  `PlannedDrop` (`planDrop`), marked on its target as `data-drop-mark`. A
  mutant's result is a `MutantResult`. Plain local results are named for
  what they hold (`ignoredBy`, `acceptance`), and comments say "result" or
  "outcome".

**Consequences.**

- `rg -i verdict` finds the word only in old ADRs and spikes, and in the
  migration and its test until the migration is deleted.
- Every open "needs you" and "worth a read" mark survives the next start,
  and a pending report still settles.
- The rename lands as three revisions, the run-end report (with this ADR
  and the migration), the drop, and the plain words, each passing the
  gates alone. Mutations' anchors and `expect` titles move with the code
  they name.

**Alternatives rejected.**

- **`LastRunReport`.** The key already names the thread, and "last" says
  nothing the record's one-per-lane shape doesn't.
- **`HandBack`.** A metaphor to learn.
- **`RunOutcome`.** Too close to `AskOutcome`, which is facts read from
  entries.
- **`DropEffect`** for what a drop would do: the browser's DataTransfer
  already uses that name.
- **Keep `pinetrie.verdict` and rename only the code.** No migration, but
  the old word stays in the store and in the handoff, where readers look
  first.
- **Drop the stored records instead of moving them.** Every open "needs
  you" mark would vanish on the next start, and pending reports would never
  settle.
