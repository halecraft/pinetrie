# S254 — a refresh runs 13 to 60 jj processes, most of them reads of accepted work's record it never uses; at about 20 ms each on the Mac, that is Duane's second

Numbered S232 until 2026-10-19, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0181

Run in a lane (Linux, jj 0.45.1) on a disposable colocated repo, with the
host's own refresh (`createRefresh`, `apps/pinetrie/host/jj/proposed/`) on
the owner (`startRepoOwner`), every command heard through its command watch
(`onSlowCommand` with no threshold). The probe was not committed.

## Brief

**Question.** Duane's refreshes take 1.0-1.2 s with no command over
500 ms (S256, item 4). How many jj and git processes does one run, in each
common case, which are they, and what does one cost?

**Kill criterion.** If a refresh runs a handful of commands, each one is
slow, and the cost is jj's on his repo, not the host's reads.

**Throw away.** The probe and its repo.

## Answers

1. **What a refresh runs** (a lane on accepted work with one revision of
   proposed changes):

   | case | processes |
   |---|---|
   | no lane tip | 12 |
   | first build | 45 |
   | unchanged, nothing moved since the last refresh | 2 |
   | unchanged, the head moved (a turn's import, your own command) | 13 |
   | accepted work moved: rebase | 43 |
   | a new turn: rebuild | 60 |

2. **Eleven of them, at every new operation, read accepted work's record.**
   A step's shared facts (`readShared`, `packages/jj/shared.ts`) are read
   once per operation: the accepted thread commits, `@`'s files, and
   `acceptedFacts`, which is nine more reads (accepted work's commit, the
   repo's two configs, the WIPs, the publish bookmark, how far your `@-` is
   behind and ahead, and `@`'s conflicts), and six more when your `@-` is
   behind (`catchUpPreview`). A refresh uses accepted work's commit, the
   accepted thread commits and `@`'s files, and nothing else of it. The
   rest is accepted work's record's (`apps/pinetrie/host/jj/accepted.ts`).
3. **A refresh that writes reads them twice:** before, and again after its
   steps, for the record's `yourEdits`, since its own write moved the head.
4. **The record after a write is read the separate way:**
   `readProposedChanges` (`packages/jj/proposed.ts`) runs ten reads (the
   bookmark, the revisions, the change ids, the host's version, the
   parents twice, the target, the files, the conflicts, the message),
   where `gatherLane`'s one `jj log` already says all of it for a lane on
   accepted work.
5. **An acceptance pays the most:** each lane whose proposed changes rebase
   writes, so the next lane's refresh reads the shared facts again: about
   43 processes a lane, one lane after another.
6. **A jj process that loads the repo costs 7-8 ms here** (`jj log`, `jj op
   log -n 1`, `jj diff`, medians of 20, on this lane's repo), and
   `jj config get` 3 ms; spawning alone 0.4 ms. On the Mac, S215 measured
   20 ms for `jj op log -n 1` on Duane's repo. At about 20 ms, a new turn's
   rebuild (60) is 1.2 s, and an unchanged refresh after a turn (13) about
   0.26 s: Duane's 1.0-1.2 s after each turn is the rebuild.

7. **After the change below,** the same cases run (the host's
   `refresh.test.ts` pins them):

   | case | before | after |
   |---|---|---|
   | no lane tip | 12 | 2 |
   | first build | 45 | 15 |
   | unchanged, nothing moved | 2 | 2 |
   | unchanged, the head moved | 13 | 3 |
   | accepted work moved: rebase | 43 | 13 |
   | a new turn: rebuild | 60 | 16 |

   At about 20 ms a process, a rebuild after a turn falls from about 1.2 s
   to 0.3 s on the Mac, and an acceptance costs each lane that rebases
   about 0.26 s instead of 0.9 s. Of a rebase's 13, five are reads before
   the steps, the rebase and the mark are four, the observation after a
   write two, and the record's read and the shared facts read again one
   each. One more each write, a second `jj op log` from the watch for a
   head the step had observed, is gone too.

## What it points to

- **Split the shared facts:** what a refresh reads (accepted work's commit,
  the accepted thread commits, `@`'s files) in one `jj log`, and accepted
  work's record's facts read only when that record is written, once per
  operation. A writing refresh's two reads of eleven become two of one.
- **Read proposed changes in one `jj log`** wherever `readProposedChanges`
  runs: the template already says the revisions, parents, the host's
  version, conflicts and the message.
- **Pin each case's count in a test** against real jj, so a read added
  later fails a value, not a clock.
- What stays: the steps themselves, and the owner's observation after a
  write (`jj op log -n 1` and the fingerprint). At an acceptance, most of a
  lane's 13 are its write: one read answering for every lane (S100) would
  save its three or four reads, not the rebase, the mark and the
  observation. Rebasing every lane's proposed changes in one `jj rebase`,
  marking them in one `git update-ref --stdin`, one import and one track,
  and observing once, would; that changes the refresh from one upkeep step
  per lane to one for an acceptance, a decision of its own.
