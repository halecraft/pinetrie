# S159 — jj's tree is the state's name when the codec writes the exclude file first; the codec can write a turn's commit itself in 4 ms and jj imports it; files of a gigabyte cannot go through jj or git's CLI in a lane

Numbered S155 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** In pine·trie's model, jj is a codec. It maps a state's source
class to commits and back, for projects that want git remotes. A state's
name is the git tree id of its source class (S156). What has to be true
for jj to carry a state exactly?
1. **Snapshot.** In real repos with their derived files present, is jj's
   snapshot of the working copy the tree the state is named by? How long
   does it take?
2. **No VCS.** In a folder with no VCS, plain jj tracks everything. Does an
   exclude file generated from the class map make jj's tree the state's
   name? And what of three cases:
   - a kept output inside an excluded directory;
   - a local `.env`;
   - a path tracked before it was excluded?
3. **Large files.** jj's default `snapshot.max-new-file-size` is 1 MiB.
   What happens to a new file above it, and what does a file of a gigabyte
   cost through jj and through git?
4. **Writing directly.** Can the codec write a turn's commit itself (its
   blobs, the trees above them, the commit) and have jj take it as its own?
   At what cost, against a jj snapshot and commit of the same turn?
5. **Contradiction.** What does jj do with a commit that tracks a path its
   ignore rules exclude?
6. **Round trip.** Does state, then jj commit, then a fresh checkout, give
   the same state? What happens to an executable, a symlink, an empty
   directory, a 0600 file, and a 2 MiB file?

**Kill criterion.** If a mismatch cannot be closed by the codec (for
example, jj silently dropping a large file), then for a jj project jj stays
the record of the source class. The state model would hold only for
projects without jj: two modes, which the model was meant to avoid.

**Throw away.** The script and its output are kept in
`docs/findings/S159-jj-codec/`:
- `codec.py`, one step per question (`snapshot`, `novcs`, `large`,
  `direct`, `contradiction`, `roundtrip`), each writing
  `results-<step>.json`. It uses S156's `gittree.py` for the state's name.
- `results-by-hand.json`: jj's memory and git's times for large files,
  measured by hand after the `large` step.

Run in a lane (Debian 13, arm64, memory limited to 4 GiB by its cgroup):
- jj 0.45.1, with an empty config (`JJ_CONFIG`), because the lane's own jj
  config names commits these repos lack;
- git 2.47.3;
- the corpus of S155 and S156, with its derived files present.

## Answers

1. **jj's snapshot is the state's name in all four repos.**

   | repo | tracked files | jj snapshot | jj's tree is the state's name |
   |---|---|---|---|
   | pine·trie, with `node_modules/` | 1,248 | 5.4 ms | yes |
   | ripgrep, with `target/` | 237 | 5.4 ms | yes |
   | flask, with `.venv/` and caches | 236 | 4.9 ms | yes |
   | Linux | 96,080 | 28 ms | yes |

   Each repo's `.gitignore` already excludes its derived files, so jj's view
   and the class map agree. This is the case the codec is built for.
2. **With no VCS, jj needs the exclude file written before its first
   snapshot.**
   - **Plain jj** on S158's scenario folder tracked 33 of 35 files:
     `node_modules/`, `site/`, `.cache/` and the rest. Its tree is not the
     state's name.
   - **With the codec:** `.git/info/exclude` was written from the class map
     (the derived directories and `.env`) before jj ever snapshotted, and
     the kept output in an excluded directory was tracked with
     `jj file track --include-ignored dist/keep.txt`. jj's tree then *was*
     the state's name.
     - `.env` was never tracked.
     - The kept file stayed tracked through an edit.
     - A new file in an excluded directory stayed untracked.
   - **Order matters:** a path jj tracked before it was excluded **stays
     tracked**. Reclassifying a path as derived or local therefore needs
     `jj file untrack`, not only a new exclude line. This is lucky-falcon's
     case from the shared directories.
   - **jj honours `.git/info/exclude`,** as S108 found with jj 0.44.
3. **Large files: jj refuses them by default, can be told to take them, and
   cannot take a gigabyte in a lane.**
   - **A new file over 1 MiB is left untracked by a snapshot,** with a
     warning on stderr. In a lane, where nobody reads stderr, the file is
     dropped without anyone knowing.
   - **`jj file track` alone also refuses it.**
     `jj file track --include-ignored` takes it whatever its size (jj's own
     hint says so), and so does `snapshot.max-new-file-size=0`.
   - **A tracked file that grows past the limit stays tracked.**
   - **jj holds about four times a file's size in memory:**

     | new file | `jj file track --include-ignored` | peak memory |
     |---|---|---|
     | 64 MB | 0.6 s | 293 MB |
     | 256 MB | 2.7 s | 1,064 MB |
     | 512 MB | 5.1 s | 2,089 MB |
     | 1 GB | killed (exit 137) | over the lane's 4 GiB |

   - **git's CLI is no way around it.** For 1 GB, `git hash-object` took
     99 s to hash and 271 s to write, while `sha1sum` took 2.5 s. For
     256 MB it took 1.9 s, so its cost grows faster than the file.
   - **The codec's own streamed writer** (SHA-1 plus zlib, the format of a
     git object) took 15.1 s per GB at zlib level 1 on incompressible data,
     and 0.98 s per GB at level 0 (stored). Media is already compressed, so
     level 0 loses nothing for it.
4. **The codec can write a turn's commit itself, and jj takes it as its
   own.** Write only what is new: the changed blobs, the trees from them to
   the root, and a commit, as loose objects. Then point a ref at it and
   run `jj git import`.

   | repo | changed paths | codec writes | `jj git import` | jj snapshot and commit of the same turn |
   |---|---|---|---|---|
   | pine·trie | 7 | 3.6 ms | 10 ms | 17 ms |
   | Linux | 7 | 4.8 ms | 88 ms | 189 ms |

   - **Correct by construction:** in both repos, jj showed the codec's
     commit with the state's name as its tree, recorded as "import git
     refs" in its operation log. `jj commit` of the same edits gave the same
     tree.
5. **jj keeps tracking a committed `.env` that `.gitignore` excludes,** and
   shows an edit to it as a change. It never reports the contradiction.
   Catching it (a commit that tracks a path the class map calls local) is
   the codec's job at import.
6. **The round trip holds for what git can hold.**
   - State, then jj commit, then a fresh workspace, gives the same state
     name.
   - The executable bit and the symlink came back.
   - The 2 MiB file came back, with the limit set to 0.
   - The empty directory did not come back; S156 found empty directories
     only among derived files.
   - The 0600 file came back as 0644. Git keeps only 644 and 755, and S156
     found other modes only among derived files.

**Against the kill criterion.** It does not fire. Each mismatch has a way
the codec closes it:
- **Derived and local paths** are closed by the exclude file the codec
  generates, written before jj's first snapshot, together with `untrack` on
  any reclassification.
- **Kept outputs inside ignored directories** are closed by
  `track --include-ignored`.
- **Large new files** are closed by `max-new-file-size=0` in the lane's jj
  config. Without it, jj drops them with only a warning: the silent drop
  the criterion names.
- **Files of a gigabyte** cannot pass through jj, because of its memory,
  or through git's CLI, because of its time. The codec writes their blobs
  itself, streamed, which is also how it can write every turn's commit
  (answer 4).

**What this decides for the codec.**
- **The codec writes the commit; jj imports it.** That is correct by
  construction (the commit's tree is the state's name), cheaper than
  `jj commit` (4–5 ms plus 10–88 ms to import, against 17–189 ms), and the
  only path for large files.
- **jj's own snapshot still runs** whenever the agent or the person uses
  jj. So the codec keeps jj's view in line with the class map:
  - the exclude file is generated, and written before the first snapshot;
  - kept outputs are tracked with `--include-ignored`;
  - anything reclassified is untracked;
  - `max-new-file-size` is 0.
- **Every turn checks itself for free.** jj's tree and the state's name are
  both git tree ids. A turn whose jj tree is not its state's name is a
  codec bug, caught the moment it happens.
- **Where a file of a gigabyte goes** when a project publishes to a git
  remote is still open. One blob is possible, but slow, and stored whole
  for every version. A pointer, as git LFS does it, is the alternative.
  Hosts also limit file sizes: GitHub refuses files over 100 MB (from its
  documentation, not measured here). That choice belongs to publishing, not
  to the state.
