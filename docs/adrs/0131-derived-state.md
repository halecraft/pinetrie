# ADR-0131 — Derived state is rebuilt from its key, never carried: the base is a dependency layer and a checkout, a lane's recipe runs again when its inputs change, and a turn records the ignored files it wrote

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `packages/lanes/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`
- **Evidence:** S146, S147, S148
- **Amends:**
  - ADR-0034: the base is a dependency layer named by what made it, with
    accepted work checked out on it, never an older base; a fork from a WIP
    whose lockfile differs starts from a layer of its own; a lane runs the
    recipe again when its inputs change; `installWhen` is one lockfile or a
    list, and `installCaches` names what is carried.
- **Amended by:**
  - ADR-0135: a recipe is any recorded run of a command that made derived
    files, learned rather than declared (`lanes.install`, `installWhen` and
    `installCaches` go). pine·trie runs none itself; a disk made for a new
    state carries each output whose recipe's key still holds there.

**Context.** A package deleted from accepted work left its `node_modules/`
in the base, and in every lane forked from it. The base was refreshed by
restoring the previous base, running `jj new` and installing when the
lockfile's hash moved: "every earlier base plus a diff". jj manages tracked
files only, and pnpm does not prune an importer it no longer lists, so
ignored files outlived what made them. A lane that deleted a package had the
same leftovers on its own disk, and its branches inherited them. Nothing
recorded the ignored files a turn wrote.
- **S146:** `btrfs send --no-data -p` diffs two snapshots, deletions
  included, in about 2 ms for a turn's change; a walk of both trees, in
  about 80 ms.
- **S148:** a 329 MB pnpm store copies into a fresh subvolume by reflink in
  about 300 ms, every block shared, and a fresh checkout with it installs
  offline in 1.15 s, leaving no deleted package's `node_modules`. pnpm
  refuses a `node_modules` made with another store path.

**Decision.**
- **Ignored state is of two kinds.** Derived: what a recipe makes from
  tracked inputs, rebuilt from its key, never carried by a diff. Everything
  else ignored: recorded when a turn writes it.
- **A dependency layer** (`deps-<key>`) is a disk on which the recipe ran
  once, named by a hash of what made it: the recipe, its inputs' content at
  the commits, the lane image and the build's own version. It is built on a
  fresh disk, carrying in only the recipe's caches from the newest layer,
  so it holds nothing an older layer held.
- **The base is a layer and a checkout:** the layer for accepted work's key
  restored, built first if missing, and accepted work checked out on it. No
  refresh restores an older base. The base says what it holds inside itself,
  not in a file beside it.
- **A fork from a WIP whose recipe's inputs differ from accepted work's**
  starts from a layer of its own, made at the WIP's commit. No fork
  installs.
- **A recipe's run removes its last outputs first.** A disk records what its
  recipe made (`.pinetrie-lane/derived.json`): the topmost paths the run
  added, from a diff of the disk before and after it, never a cache. A lane
  runs the recipe again, before a turn's or an update's snapshot, when a
  path it reads changed and the disk's outputs were made from another key,
  and when its container is made anew. A failed run records its outputs
  with the key before it, so the next run removes them and runs again.
- **A recipe's caches stay where the tool keeps them** (pnpm's store at
  `/workspace/.pnpm-store`), and no repo in a lane tracks them.
- **Each turn's record names the ignored files it wrote:** its whole disk
  diffed against the snapshot before it, each path sorted into tracked,
  pine·trie's own, a recipe's output, a cache, or ignored; the topmost of
  the last, at most 100. The work's line counts them, and says when a
  recipe failed.

**Consequences.**
- A deleted package leaves nothing behind, in the base, in a lane, or in a
  branch from either.
- A turn that changes the lockfile waits for the recipe before its
  snapshot, so its next tool call waits too: about a second for pnpm with
  its store warm (S148). Other turns pay nothing for it.
- A turn's record waits for its diff, so a branch at it does: about 3 ms,
  up to about 600 ms after an install (S146).
- Each existing lane runs its recipe once, at its next start, since its
  disk records no key.
- Only the newest three layers, and the base's, are kept; one deleted is
  built again from its key when a fork needs it.

**Alternatives rejected.**
- **`git clean -fdX` in the base:** it deletes `.jj/` and the store.
- **Deleting directories that hold only ignored files:** a guess at what is
  stale, needing a rule for each kind of output.
- **Naming the base by its subvolume's id:** an id is the disk's identity,
  not its content.
- **The store on a volume of its own, mounted into lanes:** pnpm refuses a
  `node_modules` made with another store path, and a store lanes write is a
  channel between them.
- **A content hash of every changed file in each record:** no reader needs
  a disk's identity yet.
