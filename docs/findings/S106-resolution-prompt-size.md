# S106 — A resolution's prompt carried every conflicted file whole, and a large conflict made one no run could start

**Status:** Answered. Led to ADR-0084, implemented by
`PLAN-2026-10-05-resolution-budget`: `resolutionFloor` and `planResolution`
(`packages/rules/land.ts`), `planCatchUp` (`apps/pinetrie/host/work/update.ts`)
and `LAND_BUDGET` (`packages/pi/compaction.ts`).

**Question.** The thread helpful-grove caught up with the project and
reported 37 conflicted files. "Catch up and resolve" then left it at 38
files conflicting with the project, and no resolution ran. Were the
conflicts real, why did the resolution not run, and would trying again help?

**Kill criterion.** If the resolution run failed for a reason outside the
prompt (the model, the container, the host), the prompt needs no change.

**Throw away.** Nothing was built. The lane's container was started only to
read its jj history, then stopped; the thread was read from the host's store.

**Answers.**

1. **The conflicts were real.** helpful-grove began from
   `lyrmmsww` (`30061fc6`). While it worked, the line integrated gleeful-anchor's
   `npptqxmk`, "a card waits for a pop, not a take" (ADR-0083): 147 files,
   renaming `take.ts` to `queued-card-pop.ts` and rewording "take"
   throughout. helpful-grove's own work, ADR-0080, edited the same lines.
   helpful-grove held no source of an integrated-offer commit above it, so
   ADR-0079 joined nothing, as it should: the catch-up was one merge of the
   lane and the line (`483f9f43`, in the lane). It conflicted in 37 files
   after `heldAlike` restored the files both sides held alike. The offer,
   helpful-grove's work rebased onto the line in your repo, conflicts in 38.
2. **The resolution's prompt was about 1 MB.** `planResolution` showed every
   conflicted file whole, with jj's markers. The 37 files held 993 061
   bytes, and the land message's entry in the thread's document is 1 045 954
   characters, about 250 000 tokens. `RESOLUTION_BUDGET` (60 000 characters)
   bounded only the reasons: ADR-0033 kept the hunks whatever the budget.
3. **The run failed before the model replied.** The land message is the
   thread's newest entry, with no reply after it. Its `pi.result` is `failed`:
   `summarization_failed: 429 rate_limit_error`. The lane's jj history has
   no operation after the merge.
4. **pi cannot compact such a prompt** (read from `@earendil-works/pi-agent-core`,
   `dist/harness/compaction/compaction.js` and `dist/harness/runtime/harness.js`):
   - pine·trie's lanes run on pi-agent-core's harness, and `createAgentHarness`
     was given no `compaction` option, so every lane ran with
     `DEFAULT_COMPACTION_SETTINGS`: `reserveTokens` 16 384,
     `keepRecentTokens` 20 000. A person's pi `settings.json` does not reach
     the harness.
   - `shouldCompact`: pi compacts when the context exceeds
     `contextWindow - reserveTokens`.
   - `findCutPoint` keeps the newest messages back to `keepRecentTokens` by
     `estimateTokens`, and summarises the rest. The newest message is always
     kept whole, so compaction never shrinks the resolution's prompt.
   - `estimateTokens` counts a `custom` message as the characters of its
     content over four, rounded up.

   So the 250 000-token prompt pushed the context past the window, pi tried
   to summarise the thread's long history first, and that request hit the
   rate limit. Had it succeeded, the prompt it kept would still not have fit.
5. **Trying again cannot help.** The lane already holds the merge, so the
   next catch-up finds nothing to merge (`mergeBase`: `missing.length === 0`)
   and builds no new prompt. The 1 MB message stays at the thread's tip, and
   every run on that branch sends it again.
6. **How much of the conflict each way of showing it costs.** The 38 files
   of `pinetrie-offer/helpful-grove`, read with `jj file show`:

   | shown | characters |
   |---|---|
   | whole files | 1 018 655 |
   | conflict sections (each `<<<<<<<` to its `>>>>>>>`) | 106 066 |
   | names | 1 132 |

   Two sections are whole files: a conflict "including 1 deletion" wraps the
   surviving side whole (`apps/pinetrie/host/take.ts`, 14 613;
   `apps/pinetrie/host/take.test.ts`, 19 773). Under 20 000 tokens, this
   conflict shows its files by name.

**Recovering a thread already stuck.** ADR-0084 bounds new prompts; it does
not shrink one already written. From a branch of the thread made before the
land message, send the agent an ordinary message asking it to resolve the
conflicts in its copy (`jj resolve --list` lists them). Or resolve the offer
in your repo.
