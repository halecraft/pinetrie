# S42 — a jj repo per lane disk, exchanging work by push and fetch

S41 forked a lane by cloning its disk, with one jj repo shared by every lane
over virtiofs and a workspace per lane. A clone then carried its parent's
workspace identity, and had to be re-registered before jj ran in it; and
several VMs wrote one jj operation log over a shared mount, which was never
examined. The alternative asked here: the whole repo lives on the lane's disk,
so a clone is a complete fork of the repo and the working copy, and lanes
exchange commits with the host's repo by git push and fetch, as separate
clones do.

**Answers.**

1. **A fork is a clone plus `jj new T`: about 100 ms of jj.** Lane A (a
   `jj git clone --colocate` of the host repo, on its own journaled volume)
   took a turn, pushed it, and its disk was cloned; then it took a second.
   Fork B, from the clone: `@` was A's working-copy change as it was at the
   snapshot (`oruwzmyt`, empty), the change A's second turn later filled.
   `jj new <A's turn 1>` in B took 93 ms; the inherited empty change was then
   gone from B's log, B's files and ignored state were A's at turn 1 (`.vite`
   A1, not A2), and B's turn reached the host with nothing divergent. Fork C,
   from B's clone, the same.
2. **The first `jj new` is required.** A control fork of A's turn 1 that
   edited and committed without it made its turn the inherited change
   `oruwzmyt`; on the host, that and A's second turn were both marked
   divergent.
3. **Change ids cross repos intact.** jj 0.44 writes a `change-id` header into
   git commits (`git.write-change-id-header`, true by default); the host and
   lanes showed the same change ids for the same commits, and fetching into a
   lane made nothing divergent.
4. **Inherited history can be locked in a fork.** With
   `immutable_heads() = builtin_immutable_heads() | ::<fork point>` in the
   lane's config, `jj describe` on an inherited commit was refused ("Commit …
   is immutable"). The config is a file on the lane's disk (`JJ_CONFIG`), so
   it forks with the disk; jj 0.44 keeps per-repo config beside the user's
   config, off the disk.
5. **Concurrent pushes into the host repo over virtiofs were sound.** Lanes
   A, B and C took 15 turns each at once, each turn a commit and a push of
   `pinetrie/<lane>` to the host repo mounted at `/host` (3 s in all): every
   bookmark on the host was its lane's latest commit, the host held all 45
   turns, nothing was divergent, and `git fsck` was clean.
6. **Landing and folding are ordinary jj.** The host merged `main` with
   `pinetrie/lane-c` and had lane C's tracked files; its ignored state stayed
   in the lane. Lane B fetched the others' bookmarks (same change ids) and
   merged lane A's tip: a content conflict in the file both edited, as
   ADR-0033's resolution expects.
7. **`git` in the lane image must be 2.41 or later.** jj's push and fetch
   run `git`; Debian bookworm's 2.39 failed ("Git does not recognize required
   option: porcelain"); trixie's 2.47 worked. `container build` made the
   image (git, jj) in 25–28 s; its builder VM holds 2 GiB until stopped.

## What this means for the design

- A lane's disk holds a whole repo: a `jj git clone` of your repo (or of the
  lane it forks from, by cloning the disk). No jj workspaces, no shared jj
  state between VMs, and no re-registering: a fork is a disk clone and `jj
  new T`.
- A turn: snapshot and commit, push `pinetrie/<lane>` to your repo, clone the
  disk. The host sees a lane's work at each push, once per turn, not live.
- A fork's lane config marks everything at or above its fork point immutable.
- Landing, folding and resolving conflicts run on commits in any repo that
  has fetched them.

## Not measured

- A large repository: the initial `jj git clone` into a lane's disk, and
  `git gc` on a disk that forks keep cloning.
- Pushing over a protocol instead of into a mounted repo, or from lanes on
  another machine.
- Your working copy as the push target while you use it; here the host repo
  was a throwaway with no one editing it.
- pine·trie's host code moved onto this layout (`turnDone`, landing, ADR-0033).

## Method

`sandbox/s42/` in lane `t-01a0e616-…`'s workspace (ignored): `img/` (the
`Containerfile`: `node:24-trixie-slim`, git, jj 0.44.0), `lib.sh` (`plane`
starts a lane with its disk at `/r/workspace/lane` and the host repo at
`/host`; `pturn` commits, sets and pushes `pinetrie/<lane>`; `snap` clones a
disk; `immutable` writes the fork's config). A throwaway colocated host repo
with a `base` commit and `main`. Image `s42-lane:2` remains; the containers,
volumes, clones and repo were removed.
