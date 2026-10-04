# S97 — why the host built offers that bring nothing, or bring back what you took

**Status:** Answered. Led to ADR-0067. Served
`PLAN-2026-10-03-offer-certainty`.

**Question.** On 2026-10-03, on Pineta's own repo, the page contradicted
itself about vernal-pine. Its tab's ⋯ warned that archiving drops "work not
added to the project", while its strip said "nothing to add yet". The
header's ⇣ counted 14 threads with work to add, and fewer had any. Where do
the offers the page counts come from, and why did the host build them?

**Kill criterion.** If every offer bookmark in the repo held work the line
lacks, the fault is the page's alone, and the host needs no change.

**Throw away.** The read-only copies of the repo's `.jj` and `.git` the
reads below ran in, outside the workspace.

**Answers.**

1. **Some offers were empty, and the page counted them anyway.** 6 of 15
   `pineta-offer/*` bookmarks were empty commits. `offerView` read a record
   with no files as `nothing`. `openOffers`, which the ⇣ count and the tab's
   Archive list read, and `recordedSpan` checked only `taken === null`.
2. **"jj refused" read as "the lane has work".** vernal-pine's offer was
   taken as `bd47a088`, and the lane caught up with it: its tip `2dfcfc03`
   is a merge of `bd47a088` and the lane's previous tip. The offer's start
   was `bd47a088`. `changesNoFile` ran `jj diff -r 'bd47a088..2dfcfc03'`,
   and jj refused: "Cannot diff revsets with gaps in", since the range holds
   the merge but not one of its parents. A refusal read as a change, so the
   host built an offer, as the diff from the start to the tip:
   `jj diff --from bd47a088 --to 2dfcfc03` lists nothing. Every refresh then
   planned `none`, so the empty offer stayed.
3. **Takes from before `Pineta-Source` existed are invisible to the start.**
   90 commits on the line carry `Pineta-Thread`, `Pineta-Lane` and
   `Pineta-Entry` but no `Pineta-Source`: takes from before offers carried
   their ledger, the newest from 2026-10-02. `takenRevset` reads only
   `Pineta-Source`, so for six threads (loyal-plover, jade-elk, spry-flint,
   copper-newt, minty-poplar and cozy-mallard) the start stayed at the
   thread's old base, and each offer replayed what you had already taken
   onto today's line: 12 to 74 files, up to +13,668 lines, every one
   conflicted.
4. **A wider trigger woke them.** All six were built in 6 s at 18:03:41–47,
   in the first host operation for 3½ hours. ADR-0065's `planMarks` marks
   every named lane on a full observation; the poll before it touched only
   lanes with an offer bookmark or an open record.
5. **The rebuild loop S89 removed shows in the op log.** From 19:53 to
   20:09 the offer bookmarks swung between 9 and 13 as the host withdrew and
   rebuilt the same empty offers every few seconds.
6. **"Behind" compares commits, not files.** After a take, the line's
   commit is not the lane's base start, so the thread read as behind; its
   catch-up said "↓ caught up with the project: 0 files changed".

**Consequences** (ADR-0067).

- `workChanges` answers `none`, `some` or `unknown`. From one start it is
  the diff the build restores; jj's refusal is `unknown`, which never
  builds an offer.
- A take of a lane above its base that names no source makes the lane's
  start `untraced` (`untracedLanes`): nothing is offered until the lane
  catches up past it.
- The page reads one decoded `OfferStatus` for an offer; a record the line
  already holds is `held`, and nothing counts or warns about it.
- `pineta.base` records what catching up would change, read at a lane tip
  and a base commit, so catch-up says whether it would change anything.
- `apps/pineta/host/offers/refresh.test.ts` refreshes each history above as
  the host does, until a round writes nothing.
