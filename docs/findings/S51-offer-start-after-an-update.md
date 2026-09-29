# S51 — where an offer starts, after an update

A thread's offer (ADR-0038) came out conflicted in your repo, though the
thread's lane was clean and so was your `@`. This finding records why, and
the rule that fixes it (`PLAN-2026-09-29-offer-start`).

Observed in Pineta's own repo, on the offer `pineta-offer/stoic-raven`, with
jj 0.44.0. The commands were read-only, from a lane, against the repo mounted
at `/mnt/host-working-copy`: `jj log -r 'conflicts() | bookmarks(glob:"pineta-offer/*")'`,
`jj resolve --list -r <offer>`, and `jj evolog -r <offer>`.

**What the repos held.**

- The lane's tip, `d1690730` ("update: your work"), had no conflict. Your
  `@` had none either.
- The offer, `wqrzvlzs`, conflicted in four files: `packages/client/TECHNICAL.md`,
  `packages/lanes/TECHNICAL.md`, `packages/lanes/lanes.test.ts` and
  `scripts/mutations/marginalia.ts`.
- The lane had three copies of your `@` recorded as `pineta.have`:

  | copy | made | what it held |
  |---|---|---|
  | `4a6f3739` | when the lane forked | your `@` on `93906547`, with uncommitted edits |
  | `deb8378e` | the first "update from my work" | your `@-`, `324e0e4a`, nothing uncommitted |
  | `8d3ea0c5` | the second update | the same |

- Between the fork and the first update, you had committed those edits,
  reshaped, as `5d2b1a34` through `324e0e4a`. `4a6f3739` is not an ancestor
  of that line. It is an ancestor of the lane's tip.

**Answers.**

1. **The start kept the superseded copy.** An offer starts at
   `heads(::tip & ::(target | present(<each have>)))` (`offerStart`). Every
   rebuild after the first update started from
   `8d3ea0c5, deb8378e, 4a6f3739` (`jj evolog`: each "rebase … and
   descendants" of the offer moved it from a merge of those three onto
   `324e0e4a`, and came out conflicted).
2. **The four files are where your uncommitted edits changed before you
   committed them.** The start's merge put your old uncommitted state beside
   your current commits, and they disagree there. The lane's own changes are
   not in conflict: the tip, restored on `324e0e4a`, is clean.
3. **A delivered have is superseded in the same way** (reasoned, then shown by
   a test, not observed in use). You take an offer, so its lane commit is
   recorded as delivered; you change those lines in a commit of your own; you
   update the lane. The delivered commit and the new copy are both heads, and
   they disagree on those lines. `packages/lanes/lanes.test.ts` builds this
   case, and it conflicted before the fix.
4. **A copy of your `@` holds everything you had when it was made.** So once
   the lane's history holds a copy, the newest copy in that history
   supersedes every have recorded before it. Haves recorded after it (a
   later take) still count. The rule is `startHaves`
   (`packages/lanes/plan.ts`), read through `startOfOffer`
   (`packages/lanes/offer.ts`).
5. **The newest copy must be the newest in the tip's history, not the lane's
   newest.** A branch forked before its parent lane's update holds only the
   parent's older copy. Dropping that one because the parent has a newer copy
   would make the branch's offer hand your old uncommitted edits back to you.

**Not covered here.** Another thread's offer, `pineta-offer/silver-vine`,
also conflicted. Its only start was the lane's first copy, since it had never
been updated, and its conflicts were with your later commits in files both
sides changed. That is the conflict "update from my work" exists to resolve.
