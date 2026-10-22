# S313 — A live thread keeps every turn's snapshot, about 2,000 a day on pine·trie, and a nested lane keeps its inner projects' snapshots until its thread is archived: 36,000 subvolumes filled the lane VM's metadata

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** On 2026-10-21 the lane VM's data disk failed every write
with `ENOSPC` while `df` showed 37 GB free: btrfs had allocated the whole
device, and its metadata, 29 GiB, was full (S314). The disk held 35,989
subvolumes. What are they, what keeps each, and what would ever delete it?

**Kill criterion.** None: an account, read from the disk and the source.
Each claim names which.

**Throw away.** The listing (`btrfs subvolume list`, read-only, from a
privileged container on the lane VM).

## Answers

Read on 2026-10-21 from the lane VM's disk, after S314's recovery. A
snapshot's id holds its UUIDv7, so its time.

1. **Where they are:**

   | subvolumes | what |
   |---|---|
   | 16,442 | `projects/dff06c0e66d017b0/snapshots`: pine·trie's own project, a jj one |
   | 9,765 | one folder project inside `nested/t-01a1463f…`, a nested lane's store |
   | 8,355 | one folder project inside `nested/t-01a14116…` |
   | 253, 98 | the project's lanes, and its nested lanes' stores |
   | 1,076 | the rest: other nested lanes' inner projects and data roots |

2. **pine·trie's project grows by about 2,000 snapshots a day:** by day
   (UTC), 36 on 10-08, then 571, 793, 416, 684, 2,510, 636, 2,790, 1,563,
   2,205, 1,703, and 2,427 on 10-21. A turn snapshots its lane, and a
   thread can be branched from any of its turns, so a live thread keeps
   every one. Only an archive deletes them: its teardown deletes the
   snapshots no one will branch from (`apps/pinetrie/host/work/archive.ts`).
   Nothing bounds a live thread's.
3. **The two nested stores are a test's leftovers.** Their snapshots are
   `line-` states, a folder project's reads of accepted work's line: all
   9,765 made in 15 minutes on 10-16 (about 11 a second), and all 8,355 in
   46 minutes on 10-15. A folder project's host keeps a window of them and
   deletes the rest (`planKeep`, `apps/pinetrie/host/TECHNICAL.md`), but
   only while it runs. The inner host that made them was gone. What else
   removes them:
   - another host starting inside the same lane, whose sweep removes
     projects whose folders are gone (`sweepProjects`,
     `packages/docker/runtime.ts`);
   - an archive of the outer thread, whose lane's deletion drops its whole
     nested store (`planDisk`'s `delete`, `packages/lanehost/disks.ts`).

   Both threads were live, so neither had come.

So every subvolume on the disk was kept by a rule, and none bounds the
total: the metadata grows with work done in threads that stay open, and
with whatever a nested lane's tests leave behind. Not measured: the
metadata each subvolume costs. 29 GiB over 36,000 subvolumes is 0.8 MiB
each on average, but metadata also holds every file's tree.
