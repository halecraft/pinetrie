# `@pinetrie/folder`: technical notes

A folder project's history, decided as values (ADR-0142): its graph of
states and their merge bases (`graph.ts`), the path merge's plan
(`merge.ts`), and the snapshots kept (`live.ts`). It declares only
`@pinetrie/core` (`workspace.test.ts`) and does no I/O: lanehost's disks
role carries out what it decides, through the folder adapter, and the
host's `apps/pinetrie/host/folder/` is the only code that touches your
folder (ADR-0142). The stored shapes (`StateRecord`, `ConflictRecord`) and what
lanehost reads (`PathFact`, `MergeStep`, `BasePlan`) are core's, since
lanehost declares only core and channel.

## The graph (`graph.ts`)

- **A state is a snapshot with parents, recorded when it is made**
  (`StateRecord`, the session's `pinetrie.state`). `planState` decides
  whether a proposed state joins the graph:
  - **The graph only grows:** a recorded id keeps its parents. The same id
    proposed again with the same parents is already recorded, not refused:
    a virtual base is named by its bases, so it is proposed again each time
    it is made. With other parents, it is refused.
  - **Every edge stays in one id space:** each parent is a state of this
    graph, recorded before.
  - **A state's id is never a jj commit's** (`isFolderStateId`, core): it
    holds a dash and is a disk name. A turn's state is `turn-<uuidv7>`
    (`turnStateId`), never its entry's id, which names the entry's own
    snapshot; a line state `line-<uuidv7>` (`lineStateId`); each from an id
    its caller mints; a virtual base `bases-<hash>`.
  - **Its parents' number follows how it was made** (`StateMade`): a read
    has one, or none when the graph is empty (your folder's first read); a
    start, a turn and a restore one; a catch-up and an accept two; a merge
    of bases two or more; none repeats. A start's parent is the state its
    disk was restored from, and it is a state of its own. A restore's is
    your folder's newest state, never the state restored, so your folder's
    line stays a line and its newest states are reached by first parents.
- **Ancestry and merge bases are the adapter's**, never a rule's: rules
  test points for equality only (`packages/core/TECHNICAL.md`). A merge
  base is a lowest common ancestor (`mergeBases`); the common ancestors are
  closed under parents, so one is below another exactly when it is a parent
  of one.
- **Several bases are merged first, never one chosen** (S182: neither is
  always right). `planBase` plans them as git's recursive strategy does:
  the lowest id first, each other base merged into it over the base the
  two share, itself planned the same way. So every base a virtual base
  merges is a state; only an inner merge's base may be virtual. A conflict inside it is kept as
  git's markers, and a non-text path both sides changed keeps the first
  base's version.
- **A virtual base is named by what it merges:** `bases-` and a hash of
  its bases' sorted ids (`virtualBaseName`), so the same bases always name
  the same snapshot, which is found made rather than made again.
- **A virtual base becomes a state only when a conflict names it**
  (`virtualBaseRecord`, made `bases-merged`), so a conflict's base is
  always a state of the graph. Its parents are its bases.

## The graph's laws

Each is one test in `graph.test.ts` titled by its sentence
(`scripts/laws.test.ts` holds each law to exactly one): the first three as
properties over graphs from a seeded walk of a line, lanes, catch-ups,
accepts and stale accepts, for every pair of states; the last over S182's
flows, merged by `git merge-file` as lanehost merges.

- **A state and its descendant have that state as their one base.**
- **Merge bases are lowest common ancestors, none below another.**
- **Every common ancestor is at or below a merge base.**
- **Bases merged first give the right file or a conflict, never a wrong one.**
  Over S182's criss-crosses, E conflicts and E2 and E3 merge right; a
  fourth, F, whose two sides resolved one conflict two ways, conflicts,
  where either base alone takes one side's resolution silently.

- **Your folder's newest state** (`folderNewest`) is the one line state (a
  read, an accept or a restore) no other has as its first parent: your
  folder's line is made one state at a time, so it has one head.

## A read of your folder (`read.ts`)

- **A read copies what moved since the last one** (`planRead`): the paths
  whose stamp (kind, size, ctime, executable bit, a link's target) differs
  from the last read's, and those gone; nothing when nothing did, and then
  no state is made. The host walks your folder (`apps/pinetrie/host/folder/`)
  and keeps the stamps only once the state they made is recorded.

## The path merge (`merge.ts`)

- **The receiving disk holds `ours`;** `theirs` is merged in. A path only
  ours changed has no step: the disk holds it (S183).
- **Gathered in two rounds, then planned:** the diffs base→ours and
  base→theirs; the facts (`PathFact`) at every path theirs changed and
  every path ours changed at, above or under one (`pathsToGather`); whether
  ours and theirs hold alike content where both hold a file of one size
  (`pathsToCompare`, answered by lanehost's `sameContent`); then
  `planPathMerge`. Text steps are answered clean or conflicted when
  lanehost applies them, and those join the plan's conflicts.
- **S160's laws:** a path changed on one side takes that side; changed
  alike on both, nothing; text on both, `git merge-file` (S181: text is a
  file with no NUL in its first 8,000 bytes); anything else changed on both (a
  binary, two symlinks, a file against a directory, a deletion against a
  change) a conflict, ours kept.
- **The executable bit is its own field:** the side that changed it wins.
  It is one bit, so both sides changing it agree.
- **The tree check:** theirs changing under what ours made no longer a
  directory, or ours changing under what theirs made no longer one, is a
  conflict at the topmost path, and nothing under it is planned.
- **A directory theirs made is taken whole:** a diff names a renamed
  directory by its path alone, nothing under it. So two directories made
  at one path conflict, since theirs' content may not be listed.
- **Nothing is written that the disk holds:** a take whose content ours
  holds already is dropped (its mode still taken), and a text result equal
  to ours is not written (lanehost's `applyMerge`). So a merge's diff names
  only what it changed (S183).
- **Renames are not inferred:** ADR-0142 offers a guessed rename as a
  conflict's resolution, which is the page's.

## The live set (`live.ts`)

- **The snapshots kept:** each folder lane's tip, start and merge bases
  with your folder's newest state, foreign lanes included (ADR-0150);
  every conflict's three states; each offer's start and tip; your folder's
  newest `keep` line states, along first parents, its newest always.
- **A virtual base no conflict names is not kept:** it is made again when
  needed.
- **Only snapshots are swept, never records:** merge bases walk parents
  through every state, kept or not.
- **Kept by count, not by size:** a snapshot's own bytes need btrfs quota
  groups, which the disks role cannot enable (S184).
