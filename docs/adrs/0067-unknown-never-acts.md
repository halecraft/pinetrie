# ADR-0067 — What the host cannot tell, it does not act on

**Status:** Accepted. Evidence: S89, S97. Implemented by
`PLAN-2026-10-03-offer-certainty`. Amends ADR-0038 (an offer is built only
from work known to change a file, from a known start; the page reads one
status per offer), ADR-0060 (a take that names no source makes its lane's
start untraced; `pineta.base` records what catching up would change) and
ADR-0065 (every named lane is still refreshed on a full observation, which
this makes safe).
Amended by ADR-0083: a take above the base is an *integrated-offer
commit*.

**Context.** On Pineta's own repo the page contradicted itself: vernal-pine's
strip said "nothing to add yet" while its tab warned that archiving drops
its work, and the header counted 14 threads with work to add (S97). Six of
the offers were empty, and six more replayed work you had taken days
before, every one conflicted. The causes were each a fact the host or the
page could not tell, read as one it could:

- jj refused to diff a range with a gap, after a catch-up merged a take;
  `changesNoFile` read the refusal as "the lane has work", and the host built
  an empty offer.
- Takes made before offers carried `Pineta-Source` name no source;
  `takenRevset` read their absence as "nothing taken", so the start stayed
  at the thread's old base.
- The page decided "open" in four places from a record's raw fields, and
  three of them left out "the line already holds it".
- "Behind" compared commits, so your own take of a thread's work read as new
  work it lacks.

**Decision.**

1. **A read that can fail or be incomplete says so.** `workChanges` answers
   `none`, `some` or `unknown`; `startOfOffer` answers a known start or
   `untraced`. From one start, `workChanges` reads the diff a build restores,
   so the two cannot disagree.
2. **Unknown never creates an offer.** `planRefresh` builds only when the
   lane's work is known to change a file from a known start. An unknown
   answer keeps an offer that is there; an untraced start withdraws one you
   did not edit.
3. **A ledger field older data lacks reads as unknown, never as absent.** A
   take whose paragraph names a thread and a lane but no source
   (`untracedLanes`) is untraced. Catching up past it, which puts it under
   the lane's base, is what clears it.
4. **A cached fact names what it was read at.** `pineta.base`'s `catchUp`
   carries the lane tip and the base commit its files were read at; a reader
   whose base has moved since reads it as unknown. The host keeps it while
   both stay, so it is read once per move.
5. **A stored record that fails to decode is dropped**, and its reader treats
   the fact as unknown until the host writes it again. A `pineta.base`
   written before `catchUp` and `untraced` is such a record.
6. **The page decodes each record into one status that every reader
   shares.** `offerStatus` says `none`, `taken`, `held` or `open`; the strip,
   the header's ⇣, the tab's Archive item and the review read all switch on
   it. A record with no files that you did not edit is `held`: nothing
   counts it or warns about it.

**Consequences.**

- An empty offer is no longer built after a catch-up merged a take, and one
  built before is withdrawn. A thread taken before `Pineta-Source` existed
  gets no offer until it catches up, and its strip says so.
- An offer whose line already holds its work (S89) is still kept, as
  `held`, with its bookmark shown, and no take, review or count.
- "Catch up" is disabled, with its reason, when it would change nothing;
  "has new work" and the header's ↓ mean catching up changes files. Until
  the host reads what a move changes, catching up is enabled and claims
  nothing.
- A refresh of a lane whose base moved runs two more jj processes, once per
  move of its tip or base.
- Only a lane's own untraced takes are found. One of a lane it forked from
  is not.
- `apps/pineta/host/offers/refresh.test.ts` refreshes each history S97 found
  until a round writes nothing.

**Alternatives rejected.**

- **Refresh only lanes with an offer bookmark or an open record**, as the
  poll before ADR-0065 did. It hid the stale offers without removing their
  cause, and would leave idle lanes' `pineta.base` behind the line.
- **Recover an untraced take's source from its `Pineta-Entry`** through
  `pineta.revision`. The entry's revision may have no commit, the host would
  decide from the document, not the repo, and catching up clears the state
  anyway.
- **Never write an offer record with no files.** The page could not tell
  `held` from `none` while the bookmark still shows in jj.
- **Measure several starts' merge exactly with `git merge-tree`.** The range
  diff is exact when jj accepts it, and a refusal is `unknown`, which builds
  nothing.
- **A "settled" state for threads whose work was taken.** A new record with
  its own staleness; the rules above cover what S97 found from the repo
  itself.
- **Read catching up from the ledger** (every new line commit is this
  lane's take). A take you edited before taking brings changes back to the
  lane, and only the diff sees them.
