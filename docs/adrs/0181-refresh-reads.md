# ADR-0181 — A lane's reads name the accepted thread commits by their revset, not by a list of them

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `packages/jj/TECHNICAL.md`
- **Evidence:** S253, S254, S87
- **Amends:**
  - ADR-0065: a lane's read and its start read name the accepted thread
    commits by the revset the shared facts read them by, and a long union of
    commits as a revset alias, never inline.
  - ADR-0067: a refresh of a lane whose base moved runs three more jj
    processes, not two: the start read too, while accepted work sits above the
    lane's base.

**Context.**

- **An acceptance refreshes every lane, one after another.** Accepted work
  moving marks every named lane whose thread is not archived (`planMarks`),
  and each refresh is upkeep on the owner of your repo (ADR-0065), which
  runs one step at a time. A lane shows **catch up** only once its own
  refresh has written its base record's catch-up read (`catchUpNow`). On
  Duane's Mac, after one acceptance, refreshes waited up to 45.9 s.
- **Most of each refresh was reads it did not need** (S254): the shared
  facts, accepted work's record's facts among them, at every new operation,
  and the proposed changes read back in ten reads after a write. With
  those gone, a refresh that rebases after an acceptance runs 13 jj
  processes, where it ran 43. In Duane's next host log, no refresh in the
  fan-out after an acceptance ran a second, and **catch up** reached the
  other lanes much faster.
- **What is left of a gather is mostly one revset.** In S253's copy of
  Duane's repo, the lane read (`gatherLane`) wrote out all 304 accepted
  thread commits, `(present(c1) | …)`, 15.8 KB, and took 148 ms against an
  empty `jj log`'s 13-15 ms. Naming them by the revset the shared facts
  read them by (`ACCEPTED_THREAD_COMMITS` under accepted work), through an
  alias, took 22 ms and printed the same bytes. The start read's union of
  sources, 8.9 KB, took 38 ms written out and 25 ms as an alias. On
  Duane's Mac, every lane's gather took 15.3 s in series written out and
  6.5 s with the revsets. The list grows with every acceptance.
- **The documented costs were low.** ADR-0065, as ADR-0067 amended it,
  says a lane whose base moved runs two more jj processes. The lane read
  holds every accepted thread commit not under the lane's base, other
  lanes' acceptances included, so once any acceptance sits above that base
  the start read (`readStart`) runs too. Nothing keeps it: unlike the
  catch-up diffs, `known` does not cover it. S253 counted five processes
  for 60 of 73 lanes.

**Decision.**

- **A long set of commits in a read is a revset, not a list.** Every read
  that names the accepted thread commits names them by the revset the
  shared facts (`readShared`) read them by, at the same operation, so it
  is the same set: `readShared` lists them from `::<accepted> &
  ACCEPTED_THREAD_COMMITS`, and the read names that revset. A union of
  commits that no revset expresses, such as the start read's sources,
  goes in as a revset alias (`--config revset-aliases.<name>=…`), not
  inline.
- **The documented costs are S253's.** Proposed changes left unchanged
  cost 2 jj processes in the gather. After accepted work moves past a
  lane's base, its gather runs 5: the lane read, the start read,
  `filesTouched`, and two catch-up diffs, plus one diff for each further
  head of its proposed changes' start.

**Consequences.**

- **A gather after an acceptance costs about half,** and stops growing
  with the number of acceptances: 15.3 s to 6.5 s for 73 lanes on Duane's
  Mac, with the same facts for every lane (S253 items 3 and 9).
- **Whether the revset gives the list's set in every case** is proved on
  `repo.test.ts`'s histories, an acceptance into a WIP among them (S81),
  before this lands. In S253 it did for all 73 lanes.
- Lanes on a WIP read the separate way and are not measured: S253's repo
  had none.

**Alternatives rejected.**

- **Gathering off the owner, four lanes at a time, with only the writes
  on it.** With the revsets, S253 measured every lane's gather at 1.7 s on
  the Mac four at once, against 6.5 s in series. Since S254, the fan-out
  after an acceptance no longer holds **catch up** back, and the parallel
  gather would add a second path for a refresh (a gather off the owner, a
  check that the head has not moved, a gather again on it when it has)
  for seconds nobody now waits on. If the fan-out grows slow again, this
  is the next step, and S253 holds its numbers.
- **One `jj log` for every lane's read.** It works, with each row tagged
  by its lane through aliases in a config file: 0.42-0.52 s for all 73
  lanes' reads, with the same facts. Written out as one argument, it was
  past Linux's 128 KiB limit for a single argument (`E2BIG`). It saves
  about another second over the aliased reads, while every lane still
  runs its other three or four reads, and S100's questions about lanes on
  a WIP still apply.
- **Every diff through one `git diff-tree --stdin`.** It answered all 152
  diffs in 72 ms, but listed other paths than jj for 40 of them. jj lists
  only a renamed file's new path, and git with `-M` pairs renames
  differently from jj (71 differ).
- **Running each repeated command once.** Of the 386 commands, 321 were
  distinct: a lane's diff from its own tip is its own.
- **Accepted work as a jj workspace, so jj brings lanes up to date.** jj
  carries work along only when a commit is rewritten, and an acceptance
  rewrites nothing. The lanes are repos of their own (ADR-0034), and
  catching up is a merge a thread chooses. ADR-0104 rejected a workspace
  to accept into.
