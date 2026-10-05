# S102 — A lane that holds work the line took as a copy conflicts when it catches up; joining each take to its source first makes the merge clean

**Status:** Answered. Led to ADR-0079, implemented by
`PLAN-2026-10-04-catch-up-past-take`: `planJoins` (`packages/lanes/plan.ts`)
and `mergeBase` (`packages/lanes/merge.ts`), held by the tests "catching up
past a take of the lane's work (S102)" in `packages/repo/repo.test.ts`.

**Question.** A thread caught up with the line and conflicted on lines it
had not touched since the line last saw them. The thread had merged its
parent thread grand-banjo's lane (ADR-0072). The line then took
grand-banjo's offer as a copy, and renamed `@pinetrie/marginalia` to
`@pinetrie/rules` on top of it. Every conflict read "this thread: grand-banjo's
text; the line: the same text, renamed". Why does this happen, does it
happen when a lane's own offer is taken, and what merge avoids it?

**Kill criterion.** If the one-step merge of the lane's tip with the line
is clean whenever the line has edited the taken lines since the take, there
is no bug to fix.

**Throw away.** Scratch repos in `/tmp`, made with `jj git init`. jj 0.44.0.

**Answers.**

1. **The merge base is from before the take, so the lane's work comes in
   twice.** The update was one merge of the lane's tip with the line's
   commit (`planMerge`'s `line` case, `mergeUpdate`), as jj chooses its
   base: `heads(::tip & ::line)`. A take is a copy on the line, not the
   lane's commit (ADR-0060), so that base is the take's `Pinetrie-Start`.
   Both sides then make the lane's changes. Where they agree, jj merges
   them. Where the line edited them after the take, they conflict. In
   pine·trie's own repo: the lane held grand-banjo's tip `7a27fddb`; the take
   `pyolxksm` names `Pinetrie-Source: 7a27fddb`; the base was `mlzklntq`,
   its `Pinetrie-Start`. 27 files conflicted, and each conflict differed only
   by the rename.
2. **A lane's own take does it too.** The scratch repo: a base `B`; the
   lane's commit `S` changing lines 3 and 6; the line moving elsewhere, then
   a take `C` copying `S`'s files and naming `Pinetrie-Source: S`; then `R`,
   on the line, rewriting line 3. The lane's tip, `S` or a later commit of
   the lane, merged with `R` in one step: **conflicted** in every case,
   own take or parent's.
3. **Merging the take before the line is not enough.** `jj new <tip> <C>`,
   then that with `R`, was clean while the lane had not touched its taken
   lines again. When the lane edited line 6 after `S`, both merges
   conflicted: merging the take still uses the base from before `S`.
4. **Joining the take to its source is.** First `J = jj new <S> <C>`: the
   same changes on both sides, so clean. Then the lane's tip, `J` and the
   line, in one merge (`jj new <tip> <J> <R>`), or the tip with `J` and
   that with `R`. With `J` in both histories, the base of the line's
   changes is the take, and of the lane's own changes its source. Clean, and
   the tree exactly what is wanted, in every case:

   | case | one step | take, then line | join |
   |---|---|---|---|
   | own take, lane unchanged since | conflict | clean | clean |
   | own take, lane edited elsewhere | conflict | clean | clean |
   | own take, lane re-edited its own taken line | conflict | conflict | clean |
   | parent's take, held by a catch-up merge | conflict | clean | clean |
   | pine·trie's repo (two steps, take then line) | conflict | clean, the project's tree byte for byte | not run |

5. **A real conflict stays, and reads better.** When the lane rewrote line
   3 too, as the line did, every strategy conflicted, as it should. The
   one-step and take-first conflicts show the lane's whole work against
   `B`. The join's shows one hunk: the lane's `S3 → T3` against the line's
   `R3`, the conflict a resolution has to settle.
6. **A take counts when it names any source the lane holds.** A squash of
   two takes (S77 item 6) names a source the lane lacks too. Joined with the
   lane's `S` anyway, it was clean, and the merge brought the other lane's
   work along. That work is the line's, and the update brings it anyway.
   Requiring every source to be held would leave the bug in place for any
   squashed take.
7. **Two takes of one lane need both joined, the older first.** The lane
   made `P1` (line 3), then `P2` (line 6). The line took `P1`, rewrote line
   3, took `P2` (started from `P1`), then rewrote line 6. Joining only the
   newest take with `P2` conflicted on line 3. Joining `P1` with its take,
   then `P2` with its take and that first join, then the octopus with the
   line: clean, and the tree wanted.
8. **Finding the takes, from the lane.** The takes the lane lacks are
   `(::<line> ~ ::<tip>) & description(regex:"(?m)^Pinetrie-Source: ")`
   (`trailerRevset(["source"])`, `packages/core/trailers.ts`). One is held
   when a source its message names (`sourcesOf`) is in
   `::<tip>`, read with `present()` since a source may never have been
   fetched into the lane. A lane's tip with no source of the take found
   none. A take already merged is in `::<tip>`, so each take is joined by one
   update only.
9. **What the joins change downstream.** After the join merge, `jj diff
   --from <line> --to <merge>` held only the lane's own work: nothing when
   the lane had done nothing since the take. The commits an update names
   (`ours..line`, `titlesOf`) list the take as new: it is the lane's own
   work, as a copy. Read from the join merge instead (`k1..R`), the list
   lost `L1` too, the line's own work under the take, which did come in.
   So the list wanted is `ours..line` without the takes joined.

10. **A take you edited where the lane wrote is left out.** Found by the
    implementation's test, in `repo.test.ts`. You reword a line the lane
    added in its offer, keeping its message, and take it. The join of the
    lane's commit with that take conflicts: both add the file, differently.
    It is abandoned, and the take is merged as before the joins. The update
    conflicts, as it did, and no join is left in the lane's history.

**Not probed.**

- A take to a WIP, which a WIP thread's update copies (`planWipCopy`)
  rather than merges.
- `catchUpFiles`' preview, which compares trees and not history. It should
  be unchanged, but it was not run.
- The offer that `offerStart` and `takenRevset` (S81) build on a history
  holding join commits was not probed. The implementation's test builds it:
  it holds the lane's own work alone, and the batched and separate reads
  agree on it (`agrees()`).
