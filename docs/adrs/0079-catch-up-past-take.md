# ADR-0079 — A catch-up joins each take the lane holds to its source, so the lane's own work does not come in twice

**Status:** Accepted. Evidence: S102. Implementation:
`PLAN-2026-10-04-catch-up-past-take`. Amends ADR-0060 (how a thread
catches up with the line), and with it ADR-0072's catch-up with a parent,
which merges the same way.
Amended by ADR-0083: each take the lane holds is an *integrated-offer
commit*; the code joins those.

**Context.** A thread catches up by merging the line's commit into its lane
(ADR-0060), and jj chooses the merge's base from history. A take puts a
copy of the lane's work on the line, not the lane's commit. Its message
names the commit it copies (`Pinetrie-Source`). So the base was the take's
`Pinetrie-Start`, from before the lane's work, and both sides of the merge
made that work's changes. Wherever the line edited them after the take, the
merge conflicted: "this thread's text, the line's text", where the line's
was the thread's own text, edited. The same happened to a branch holding
its parent's taken work: a thread in pine·trie's own repo conflicted on 27
files after the line took grand-banjo's work and renamed a package over it
(S102). A resolution run was then started for conflicts no one made. The
update's list of what came in named the take, the lane's own work, as new.

**Decision.**
- **Before it merges, a lane joins each take it holds a source of to that
  source.** The join is a commit merging the source with the take. Both
  make the same changes, so it is clean. With the join in the lane's
  history, jj's base for the line's changes is the take, and for the
  lane's own its source, so the lane's work comes in once.
- **A take counts when it names any source the lane holds.** A squash of
  two takes names another lane's source too. The rest of the take is the
  line's work, which the update brings anyway.
- **Takes are joined oldest first, each join on the last.** A later take's
  base then holds the earlier ones. Joined alone, it conflicted where the
  line edited the first take's lines between them.
- **The update stays one commit:** a merge of the lane, the last join and
  the line's commit, carrying `Pinetrie-Base` as before. A join carries no
  trailer.
- **A join that conflicts is abandoned.** That is a take of an offer you
  edited where the lane wrote. Its take is merged as before.
- **What an update lists as come in, and a conflict's other side, leave out
  the takes joined,** and keep the line's commits under them, which did
  come in.

The decision is `planJoins` (`packages/lanes/plan.ts`), and `mergeBase`
(`packages/lanes/merge.ts`) carries it out.

**Consequences.**
- A thread whose work was taken, and a branch of one, catches up clean past
  edits on the line to that work. A conflict both sides really made still
  conflicts, now on that hunk alone.
- A lane's history holds a join commit for each take it caught up past.
  Your repo sees them in the lane's history (`tip@pinetrie-<lane>`).
- Every catch-up reads the takes above the lane: one `jj log`, and a second
  only when it finds one.
- A WIP thread catches up by merging a fresh copy of its WIP, which holds
  no take in its history, so it joins nothing. A take to a WIP that you
  then edit there can still conflict this way (S102, "Not probed").

**Alternatives rejected.**
- **Merge the take, then the line.** That conflicts once the lane has
  re-edited its own taken lines (S102 item 3).
- **Restore the conflicted files from the line**, as a file both sides hold
  alike is restored (S99). It loses the lane's later edits, and cannot tell
  a spurious conflict from a real one.
- **Rebase the lane's work onto the line.** A lane's history is never
  rewritten: its revisions, snapshots and offers' ledgers name its commits.
- **Name the merge's base.** jj takes none. The join is how history says
  that a copy is a commit.
- **Join only takes whose every source the lane holds.** A squashed take
  would still conflict (S102 item 6).
