# ADR-0072 — A thread catches up with the thread it branched from, and an offer says when its conflict came with its copy

**Status:** Accepted (Duane, 2026-10-04). Evidence: S99. Implemented by
`PLAN-2026-10-04-catch-up-parent`. Amends ADR-0060 (a thread catches up
with its base, and now also with the thread it branched from), ADR-0055
(a third card command, `catch-up-with-parent`) and ADR-0056 (a turn's paths
are read with jj; a revision records its commit's conflicts).
Amended by ADR-0080: the agent catches up with its parent through
`catch_up`, refused as the button's command is.
Amended by ADR-0083: the parent commit a lane last took is the one it
last *caught up with* (`caughtUpWith`).

**Context.** A branch that works in its own copy is cloned from its
parent's disk at the turn it branched from (ADR-0034), and from then on it
could catch up only with its base: the project, or a WIP (ADR-0060). A
branch was made while its parent's catch-up was still conflicted. Both
threads resolved the conflict the same way, and the parent's resolution was
taken onto the project. The branch's offer, the change from its start (the
conflicted merge) to its tip, then conflicted with the project in the file
both had resolved, and its button, "resolve in the thread", hid that it
catches up. Its resolution turn also counted 2084 files: git reads a
conflicted jj commit as every side's whole tree under `.jjconflict-*`
(S99).

**Decision.**
- **A thread can catch up with the thread its copy was cloned from**: the
  lane whose commit is nearest above its first prompt (`forkParent`, the
  commit `forkPoint` clones). The parent's newest commit, fetched from your
  repo, is merged into the thread's copy like the line's commit, with no
  `Pineta-Base`: it is no base. A conflict starts the usual resolution run
  (ADR-0033). Offers still go to the project or a WIP; the parent's work
  reaches the project by the parent's own offer.
- **Whether the parent is ahead is read from the document**, not your repo
  (`parentNow`): a lane's commits only move forward along its bookmark, so
  the parent is ahead when its newest commit is not the newest of its
  commits the thread holds: its fork commit, or what a later update or
  resolution merged. A refresh reads nothing more, and the refresh budget of ADR-0065
  holds.
- **It is offered while the parent is ahead**, in the offer's menu, and
  disabled while the parent runs: its copy moves with every turn. The host
  refuses it then too (`parent_running`), and for a thread that began at
  its base (`no_parent`).
- **A file both sides of a merge hold alike is merged as it is**, whatever
  the base says (`heldAlike`). jj keeps a conflict when the base is itself
  conflicted, as when a branch and its parent resolved one conflict alike.
- **An offer's conflict has a cause** (`conflictCause`): `start` when every
  file it conflicts in was already conflicted where it starts
  (`startConflicts`, read only for a conflicted offer), else `work`. A
  `start` conflict says "began from a copy with an unresolved conflict", and
  when the parent has resolved those files its button is "catch up with
  \<parent\>". Every other conflict's button is "catch up with \<base\> and
  resolve", which is what it always did.
- **A branch from a conflicted copy is warned** before its first send:
  each revision record carries the conflicts of the commit it names.
- **A turn's paths are read with jj** (`changedPaths`), which names a
  conflicted commit's files as jj means them.

**Consequences.**
- In the case that started this, catching up with the parent is clean, and
  the branch's offer is then withdrawn: its start moves above the parent's
  taken work, and its own work changes no file.
- A merge never conflicts in a file its two sides hold alike, for a
  catch-up with the base as well.
- A branch's offer, while its parent is ahead, can carry the parent's
  newer work once caught up, as a branch's offer always carried the
  parent's work up to the fork until the parent's offer is taken.
- Revision and offer records carry one more list each; records from
  before decode with none.

**Alternatives rejected.**
- *A new copy from the parent*, the parent's newest snapshot over the
  branch: it loses the branch's own work unless it has none, and a catch-up
  gives the same result then.
- *Catch up with the project instead*: it settles a `start` conflict only
  once the parent's resolution was taken.
- *Read the parent from your repo on each refresh*, stored in
  `pineta.base`, with a parent's move refreshing its children: jj processes
  on every refresh, against ADR-0065's budget, for what the document says.
- *A `Pineta-Parent` trailer* on the merge: the update and land messages
  record what was merged, and ancestry says the rest.
- *Filter `.jjconflict-*` out of git's paths*: it depends on jj's storage
  format.
