# `@pinetrie/folder`: technical notes

A folder project's history, decided as values (ADR-0142): its graph of
states and their merge bases (`graph.ts`), the path merge's plan
(`merge.ts`), the snapshots kept (`live.ts`), a write into the project's
folder, an accept's or a restore's (`accept.ts`, ADR-0159, ADR-0165), a
conflict closed by a choice (`resolve.ts`), and a review of two states
(`review.ts`, ADR-0165). It declares only
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
    snapshot; a read's line state `line-<uuidv7>` (`lineStateId`), a
    restore's `restore-<uuidv7>` (`restoreStateId`), a resolution's
    `resolve-<uuidv7>` (`resolveStateId`); each from an id its caller
    mints; a virtual base `bases-<hash>`.
  - **Its parents' number follows how it was made** (`StateMade`): a read
    has one, or none when the graph is empty (the first read of the project's folder); a
    start, a turn, a restore, a resolve and a concurrent save one; getting the latest and an
    accept two; a merge of bases two or more; none repeats. A concurrent
    save's one parent is a line state (an accept's, or the read a put-back
    accept was built on), and it is never on accepted work's line itself,
    so `folderNewest` never answers one. A start's parent is the state its
    disk was restored from, and it is a state of its own. A restore's is
    accepted work's newest state, never the state restored, so accepted
    work's line stays a line and its newest states are reached by first
    parents (core's `lineStates`, which the live set and the history page
    both walk). A resolve's is its own lane's newest state (refused
    `resolve-off-lane` otherwise), so a conflict closed is a state of the
    lane's line, which `laneNewest` and `stateLane` answer.
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
- **A shown merge is named by its two states:** `shown-` and a hash of
  accepted work's newest and the lane's tip (`shownMergeId`). No record
  holds the id: every reader derives it from the proposed changes' `start`
  and `tip`, so a record cannot name another merge than its own. It has no
  `STATE` record until it is accepted, and then it is the accept's state,
  a pair being accepted at most once.
- **A virtual base becomes a state only when a conflict names it**
  (`virtualBaseRecord`, made `bases-merged`), so a conflict's base is
  always a state of the graph. Its parents are its bases.

## The graph's laws

Each is one test in `graph.test.ts` titled by its sentence
(`scripts/laws.test.ts` holds each law to exactly one): the first three as
properties over graphs from a seeded walk of a line, lanes, getting the latest,
accepts and stale accepts, for every pair of states; the last over S182's
flows, merged by `git merge-file` as lanehost merges.

- **A state and its descendant have that state as their one base.**
- **Merge bases are lowest common ancestors, none below another.**
- **Every common ancestor is at or below a merge base.**
- **Bases merged first give the right file or a conflict, never a wrong one.**
  Over S182's criss-crosses, E conflicts and E2 and E3 merge right; a
  fourth, F, whose two sides resolved one conflict two ways, conflicts,
  where either base alone takes one side's resolution silently.

- **Accepted work's newest state** (`folderNewest`) is the one line state (a
  read, an accept or a restore) no other has as its first parent: your
  folder's line is made one state at a time, so it has one head.

## An accept (`accept.ts`)

- **An accept is of what was shown:** refused `NOT_AS_SHOWN` unless
  accepted work's newest and the lane's tip, after the accept's own read
  of the project's folder, are the two the page showed, with no conflict
  it was not shown (`planAccept`). Any save since the review refuses,
  whatever path it touched: the page has not shown the review rebuilt. A
  conflicted shown merge has no destination, a folder having no WIP.
- **What it writes is a value:** each source path between accepted work's
  newest and the shown merge, with the stamp the accept's own read took
  there and what the shown merge holds (`pathWrites`), never a scan of
  its own. `planWriteSteps` makes each one step, every delete first, so a
  file that becomes a directory frees its name before anything is made.
- **What the folder cannot hold is refused before anything is written**
  (`planNames`): a name another folds to (NFC, and case-folded on a disk
  that folds case, every directory on the way compared too), one read with
  U+FFFD, a symlink absolute or climbing out, a path under a reserved name.
- **The staging directory holds exactly what was planned** (`checkStage`):
  a lane controls the names in its state, and a symlink there would let a
  link write around the checks.
- **A journal path's fields are each written before the step they name,**
  so recovery (`planRecovery`) finds everything it may undo. All linked
  finishes. Else every path is put back, all or nothing: a target is
  unlinked only while it is still pine·trie's (the staged file's inode,
  size and mtime, or a symlink's target), and an aside is linked back only
  where nothing stands. An aside whose path holds a save since is dropped
  when it holds what was moved, and kept on accepted work's newest when it
  was written through.
- **A kept aside is checked at a quiet read** (`planAsides`): dropped when
  its inode, size and mtime are as moved, else a concurrent save of its
  path on the line state its journal kept it on (`keptOn`).

- **A restore is an accept of an earlier state** (`planRestore`, ADR-0165):
  refused `NOT_AS_SHOWN` unless accepted work's newest after the restore's
  own read is the `seen` its preview was drawn from; `STATE_NOT_KEPT` for
  a state accepted work's record does not keep, or whose snapshot is gone;
  `NOTHING_TO_RESTORE` when no source path differs. Every refusal is
  decided before anything is made. Its state is a line state on the newest,
  made `restore` with `of`.
- **A write's content is derived, never stored** (core's `writeContent`):
  an accept writes its own state's snapshot, a restore `of`'s. The journal
  (`WriteJournal`) names only its record, so it cannot name one snapshot
  while its record names another. A restore's own snapshot is made only
  at its commit, so a refusal or a put back has made nothing, and
  `planRecovery` is the accept's.

## A resolution (`resolve.ts`)

- **A conflict closed is a state of the lane's** (`planResolve`): the
  chosen side's file taken, or deleted where that side holds none, and
  none for `ours`, which the disk holds; then a `resolve` state on the
  lane's newest. The agent's tool and a person's choice on the page both
  take it, so the next proposed changes, and the next turn's paths, read
  the resolution as a state.

## A review (`review.ts`)

- **Each changed path is one row, shown by what its sides hold**
  (`planFolderReview`): lines where every side is absent, a symlink or a
  text file (`PathFact`'s `content`, from its bytes); media otherwise, each
  side's content and size.
- **A move is found from bytes, never guessed** (`renameCandidates`, then
  `pairRenames`): each path gone is paired with each path added of its
  size, the host's `sameContent` reads only those pairs, and a pair is a
  move only when each of its two paths has exactly that one equal partner.
  Two copies of one file pair with nothing. A move's row is `{old => new}`
  (`renameShown`, as jj writes one), its lines 0 and 0.

## The write's laws

Each is one test in `apps/pinetrie/host/folder/writes.test.ts` titled by
its sentence, over a plain temp directory, with the host's executor
(`write.ts`), run for both writers: an accept's record and a restore's,
so a law cannot hold for one and drift for the other. A save races the accept at every journal write, which is
every boundary between its sub-steps (S192's protocol, its interleavings
run as values rather than by a clock).

- **A write never replaces a file it has not checked.**
- **A save made by name during a write survives it.**
- **A save through a file held across a write is kept as a concurrent save.**
- **A write changes exactly the paths whose content changed.**
- **A host that stops during a write finishes or puts it back at its next start.**

## A read of the project's folder (`read.ts`)

- **A read copies what moved since the last one** (`planRead`): the paths
  whose stamp (kind, size, ctime, executable bit, a link's target) differs
  from the last read's, and those gone; nothing when nothing did, and then
  no state is made. The host walks the project's folder (`apps/pinetrie/host/folder/`)
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
  file with no NUL in its first 8,000 bytes, core's `fileContent`, which
  names an image by its magic bytes too); anything else changed on both (a
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

- **The snapshots kept:** each folder lane's tip, start, and merge bases
  with accepted work's newest state and with its parent lane's newest,
  foreign lanes included (ADR-0150); every conflict's three states; each
  proposed changes' start, tip and shown merge; every state an accept's
  journal pins (an open one's own and its content's, each kept aside's
  `keptOn`); accepted work's newest `keep` line states (`lineStates`), its
  newest always;
  and each concurrent save whose line state is kept.
- **A lane's parent is read from the graph** (`parentLane`): the lane whose
  state its start state's parent is. So the sweep keeps a parent base only
  where the graph records the branch. A branch whose fork's files were lost
  began on accepted work's newest instead, and needs none: its base with
  its parent is a line state one of the two lanes holds as its start,
  which is kept. The sweep keeps every base a live lane can reach.
- **A merge whose base's snapshot is missing refuses** rather than
  restoring from nothing (the host's folder history, `baseMissing`): a
  guard against a snapshot gone some other way, deleted from outside or
  its lane no longer among the sweep's lanes.
- **A virtual base no conflict names is not kept:** the merge that made
  it deletes it after, on the project's queue, so two merges over the same
  bases never delete it under each other. One a conflict names is
  recorded (`virtualBaseRecord`) and is the sweep's from then on; a clean
  merge that found it recorded leaves it. It is made again when needed.
- **Only snapshots are swept, never records:** merge bases walk parents
  through every state, kept or not.
- **Kept by count, not by size:** a snapshot's own bytes need btrfs quota
  groups, which the disks role cannot enable (S184).
