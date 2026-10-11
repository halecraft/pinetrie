# S156 — Naming a state by git's tree id costs under a millisecond per turn for the source class, and matches git on four real repos; a large file has to be chunked, after which btrfs's extents name a 16 GB file again in under 50 ms

Numbered S152 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** In pine·trie's model, a state is a content-addressed tree. S155
found that a path's class (source, derived, precious) follows from its
origin. What does it cost to name a state, and in what format?
1. A hasher of git's tree format, run over a disk: does it give git's own
   tree id? How long does a full hash take, for the source class and for a
   whole lane's disk?
2. How long does an update take, given a turn's changed paths? For a
   typical turn, and for an install, which writes about 20,000 files?
3. Large files, of 1, 4 and 16 GB, each edited three ways: an append of
   1 MiB, an overwrite of 1 MiB in the middle, and a full rewrite. What
   does naming the file again cost:
   - as one git blob, which means hashing all of it;
   - as content-defined chunks, rehashing only the chunks around the bytes
     that changed? Which bytes changed comes from FIEMAP: the extents the
     file no longer shares with the previous snapshot.
4. What can git's format not hold: empty directories, modes other than
   644 and 755, hard links, special files, extended attributes, names that
   are not UTF-8? How often does each occur in a lane, and in the corpus?

**Kill criterion.**
- If an update after a typical turn takes more than about 50 ms (S146's
  `send` diff takes 2 ms), a state cannot be named every turn, only when
  something reads its name.
- If hashing a 4 GB file again as one blob takes more than a second,
  large files are chunked, and git compatibility holds only up to a size
  threshold.

**Throw away.** The scripts and their output are kept in
`docs/findings/S156-state-identity/`:
- `gittree.py`: git's tree format, built in full or updated from changed
  paths.
- `identity.py`, steps `verify`, `lane`, `turn` and `survey`: answers 1, 2
  and 4. Each step writes `results-<step>.json`.
- `large.py`, with `cdc.c` (FastCDC's gear hash, minimum chunk 256 KiB,
  average about 1 MiB, maximum 4 MiB, plus a generator of pseudo-random
  data): answer 3. It writes `results-large-1-4-16.json`, and
  `results-large-1-4.json` for a rewrite that keeps most of the content
  (added afterwards).

Run in a lane: Debian 13, arm64, 16 cores, 11 GB of memory, on the lane's
btrfs, with no added capability. The corpus is S155's clones in
`/workspace/sandbox/probes/corpus/`, plus the Linux kernel, cloned at
depth 1.

## Answers

1. **The hasher gives git's tree id on all four repos, and a full hash of
   the source class is cheap until a repo is the size of Linux.**
   Timings are with a warm page cache.

   | repo | tracked files | MB | equals `HEAD^{tree}` | SHA-1 | SHA-256 | stat walk |
   |---|---|---|---|---|---|---|
   | pine·trie | 1,248 | 9.5 | yes | 13 ms | 12 ms | 32 ms, with `node_modules/` |
   | ripgrep | 237 | 3.3 | yes | 3 ms | 2.5 ms | 3 ms |
   | flask | 236 | 1.8 | yes | 2.3 ms | 2.1 ms | 17 ms, with `.venv/` |
   | Linux | 96,080 | 1,641 | yes | 1,541 ms | 1,186 ms | 72 ms |

   - **This lane's whole disk:** 38,959 files and 0.62 GB, skipping
     `.jj`, `.git`, `sandbox/` and `.plans/`. A stat walk takes 53 ms, and
     a SHA-1 hash 1,872 ms. Without the pnpm store, it is 21,336 files and
     0.32 GB, hashed in 274 ms.
   - **Speed of the algorithms:** SHA-256 is as fast as SHA-1 here or
     faster: 2.7 against 2.25 GB/s in memory. The same held on the Mac in
     S150.
2. **An update after a turn takes under a millisecond. An install, in a
   whole-disk name, takes a second.**
   - **A typical turn:** 5 files edited, 2 added in a new directory and 1
     deleted.
     - pine·trie: 0.3 ms. Linux: 0.5 ms.
     - Both results equal `git add -A && git write-tree`.
   - **A `pnpm install`, if derived files were part of the name:** 20,070
     new files, updated in 1,203 ms. That is why the name covers the
     source class only (below).
3. **A large file has to be chunked. With chunks, FIEMAP names it again in
   milliseconds after an edit in place, and stores only the chunks around
   the change.**

   | file | edit | one blob, hashed again (SHA-1) | FIEMAP | chunks, incremental | MB hashed | new chunks stored |
   |---|---|---|---|---|---|---|
   | 1 GB | append 1 MiB | 614 ms | 0.7 ms | 2.2 ms | 1.8 | 1.8 MB |
   | 1 GB | overwrite 1 MiB | 641 ms | 0.1 ms | 2.2 ms | 1.4 | 1.4 MB |
   | 1 GB | rewrite | 570 ms | 0.1 ms | 900 ms | 1,075 | 1,075 MB |
   | 4 GB | append 1 MiB | 3,024 ms | 0.6 ms | 2.0 ms | 1.4 | 1.4 MB |
   | 4 GB | overwrite 1 MiB | 2,944 ms | 0.2 ms | 3.2 ms | 2.6 | 2.6 MB |
   | 4 GB | rewrite | 2,878 ms | 0.3 ms | 5,433 ms | 4,296 | 4,296 MB |
   | 16 GB | append 1 MiB | 11,858 ms | 44 ms | 3.9 ms | 2.2 | 2.2 MB |
   | 16 GB | overwrite 1 MiB | 14,508 ms | 46 ms | 6.5 ms | 2.7 | 2.7 MB |
   | 16 GB | rewrite | 12,192 ms | 43 ms | 23,908 ms | 17,181 | 17,181 MB |

   - **The kill criterion fires.** A 4 GB file takes about 3 s to hash
     again as one blob, and a 16 GB file 12 to 15 s. That is disk-bound:
     the 16 GB file does not fit in the page cache. Every version as one
     blob also stores the whole file again.
   - **FIEMAP works without privilege and is exact enough.** On btrfs, a
     write in place moves only the written range to a new extent. In all
     nine cases, the chunks found incrementally equal a full rechunking of
     the edited file. A 16 GB file has about 1,500 extents, and reading
     them takes 44 ms.
   - **A rewrite costs a full read, but not the storage.** An app that
     saves by rewriting writes a new file and renames it over the old one,
     so no extent is shared, and the whole file has to be read and
     chunked again. The table's "rewrite" row writes all-new content, so
     every chunk is new. An app's save is mostly the same content.
     `results-large-1-4.json` adds that case: the file copied without
     reflinks, 1 MiB changed, then renamed over the original.

     | file | rewrite with a 1 MiB change | chunked, all of it hashed again | new chunks stored |
     |---|---|---|---|
     | 1 GB | 583 ms as one blob | 877 ms | 1.2 MB |
     | 4 GB | 2,828 ms as one blob | 4,986 ms | 1.2 MB |

     So whether an app saves in place decides only how long naming takes,
     never how much is stored.
   - **Chunking from scratch is slower than one blob** (22.6 s against
     12.4 s for 16 GB). That is the cost of this probe's Python loop over
     chunks plus a second pass to chunk, not of chunking itself: the gear
     hash alone ran at 2 GB/s.
4. **For the source class, git's format lost nothing in four repos and
   this lane. Everything it cannot hold was derived.**

   | where | files | empty dirs | modes not 644 or 755 | hard links | symlinks | over 1 MiB |
   |---|---|---|---|---|---|---|
   | this lane, tracked | 1,259 | 0 | 0 | 0 | 0 | 0 |
   | this lane, whole disk | 38,959 | 78 | 0 | 4 | 1,137 | 42 |
   | pine·trie clone, with `node_modules/` | 21,321 | 0 | 0 | 0 | 1,137 | 23 |
   | ripgrep, after builds | 1,059 | 23 | 0 | 48 | 1 | 107 |
   | flask, after `uv sync` and builds | 9,051 | 0 | 2 | 0 | 4 | 10 |
   | Linux, as cloned | 96,080 | 0 | 0 | 0 | 102 | 112 |

   - **Where the gaps were:**
     - the empty directories were in `.pnpm-store/` and `target/`;
     - the hard links were cargo's, in `target/debug/`;
     - the two odd modes were `.venv/.lock` (0600) and a wheel in `dist/`
       (0666).
   - **No other gaps:** no special files, no extended attributes, and no
     names that are not UTF-8.
   - **Case:** Linux has 13 pairs of names that differ only in case.
     Git's format holds them; a Mac's disk does not (S150).
   - **The column that matters is "over 1 MiB",** for D: jj's default
     `snapshot.max-new-file-size` is 1 MiB. Linux tracks 112 such files,
     the largest a 24 MB generated header. jj would not track a new one
     of those on its own.

**What this decides.**
- **A state's name is the git tree id of its source class.** The name is
  computed every turn, from the turn's changed paths, at under a
  millisecond. Derived files are left out of the name, because a recipe's
  key rebuilds them (ADR-0131). Including them would cost a second on any
  turn that installs. Nothing in the source class of four repos needed
  more than git's format holds.
- **Above a size threshold, a file is chunked.** Its entry in the tree
  names the list of its chunks, not one blob. The threshold is a design
  choice, not settled here:
  - one blob costs about 0.7 s per GB to hash again, disk-bound once the
    file is past the page cache;
  - a turn's budget is tens of milliseconds;
  - so the threshold is somewhere between tens of MB and about 100 MB.

  Above it, the state is no longer a plain git tree for that file. The jj
  codec maps the chunk list to one blob, or to a pointer as git LFS does.
  That is probe D's question.
- **Precious paths are not part of the name.** They are never sent, so a
  name for them would mean nothing outside the lane. Nothing measured here
  forces this; it follows from the definition.

**Open.**
- **The threshold** for chunking.
- **What a chunked file's tree entry looks like** (a git blob of the chunk
  list, so that the tree stays a valid git tree).
- **Cost on the Mac:** none of this was measured there, where APFS has
  clones but FIEMAP behaves differently.
