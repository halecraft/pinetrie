# S223 — what pine·trie keeps that grows with use, and what bounds each

- **Status:** Answered (the sizes are Duane's store on 2026-10-17, S221; the
  bounds read from the code at this revision)

## Brief

**Question.** Today's stalls came from data that grew with nothing to bound
it: shared-file lineages, pi's diagnostics, an op log, records not
compacted. What else that pine·trie keeps grows with use, how big is it,
and what bounds it, if anything?

**Kill criterion.** None: an inventory. It is right when each thing that
grows is listed with what bounds it, or with "nothing".

**Throw away.** Nothing.

## Answers

"Bound" means what keeps it from growing for good: a cap, a sweep, a
deletion when its owner goes, or nothing.

| what | where | size (S221) | grows with | bound today |
|---|---|---|---|---|
| shared-file lineages | session, `pinetrie.shared` | 97 MB, 140,100 paths | every file ever seen in a shared folder; every lane that read one | versions capped (`SHARED_KEPT`); paths and lanes: **nothing** (curly-camel's thread) |
| a turn's shared files read | roots, revision `disk.shared.read` | 60 MB | files read per turn | **nothing**, and nothing reads it (curly-camel's thread) |
| pi's diagnostics | roots, assistant messages | 161 MB | the square of a thread's length | **nothing** (spare-gazelle's thread) |
| conversation | roots, entries | ~390 MB without diagnostics | use, by design | pi's compaction shortens what is sent, not what is kept; a root goes when deleted |
| revision records, the rest | roots, `pinetrie.revision` | ~22 MB | turns | lists capped at `DISK_LISTED`; a root's go with it |
| usage rows | roots | 23 MB | model requests | a root's go with it |
| records not compacted | a running root | 24,088 records, 19.9 MB, in one | a run's writes | compacted at a settle only: **nothing** during a long run |
| bases | session, `pinetrie.base` | 1.75 MB, 194 | lanes | **nothing** found for an archived lane's |
| per-thread records (thread, lane, verdict, banner, name, mark) | session | under 0.3 MB each | threads | **nothing** found for an archived thread's |
| attention documents | `attention:*` | 2.7 MB, 677 records in 4 | your reads | not measured whether they compact |
| blobs | `pinetrie_blobs` | 153 MB, 387 | shares, images | `sweepBlobs` (unreferenced) |
| card histories, trash, holds, seats, move histories | session and others | small | moves | swept (`housekeeping.ts`) |
| your repo's op log | `.jj/repo/op_store` | 1.3 GB, ~3,000 operations a day (S220) | every host write to your repo | `pnpm tidy`, run by hand; a starting host says when one is due |
| your repo's index, `refs/jj/keep` | `.jj/repo/index`, `.git` | 41 MB, 17,115 refs | operations, rewritten commits | `pnpm tidy` (reindex, gc) |
| lane disks' snapshots | lanehost's disks | not measured | turns | not checked here: archive deletes a lane's |
| a folder project's states | the session's data directory | not measured | accepts, turns | `folder/sweep.ts` |

## What it points to

- **Every row with "nothing" is a decision to make:** cap it, sweep it, or
  delete it with its owner. The three biggest have threads.
- **A rule to make it hold by construction:** each stored collection that
  grows with use names its bound where it is declared (its spec or
  schema), and a test lists the collections with none, as
  `scripts/unproven.ts` lists suite checks with no mutation, so the list
  can only shrink.
- **Not measured here:** lane disks' snapshots, a folder project's states,
  and whether attention documents compact. A census of the lanes' disks
  needs Duane's machine.
