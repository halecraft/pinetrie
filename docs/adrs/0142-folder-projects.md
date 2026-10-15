# ADR-0142 — A project without jj is a folder, and the folder is its accepted work: a thread starts from it as it is, and an accept writes into it; pine·trie keeps the graph of states, and jj becomes one adapter behind the ports both kinds share

- **Status:** Accepted (Duane, 2026-10-13)
- **Area:** `docs/01-architecture.md`, `docs/glossary.md`,
  `packages/lanes/TECHNICAL.md`, `packages/jj/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S149, S150, S155, S159, S160, S162, S169, S180, S181, S182,
  S183, S184, S185, S186, S192
- **Amends:**
  - ADR-0135: settles its second step. A folder project's accepted work is the
    folder, merge bases come from a graph of states pine·trie keeps, and
    conflicts are records whose versions a lane reads read-only.
  - ADR-0102: the host no longer refuses a folder with no jj or git repo. It
    serves the folder as a folder project.
  - ADR-0118: a folder no repo tracks may be branched too, as a folder
    project. Live and read-only remain the modes for a folder that is not the
    project.
  - ADR-0086: a folder project's session, snapshots' records and runtime are
    kept outside it, in ADR-0118's session directory. Nothing of pine·trie's
    is written into the folder.
  - ADR-0104: in a folder project, accepted work is the folder, and a thread
    starts from it as it is at the thread's first message. Such a project has
    no setup and no WIPs.
  - ADR-0076: a folder project has no publish. An accept writes into the
    folder, which is where publishing would have put the work.
  - ADR-0105: in a folder project, an offer is a pair of states, not a commit.
    It is reviewed as files, and it has no bookmark, no evolog and no stack.
- **Revised:**
  - 2026-10-15: `@pinetrie/folder` decides and does no I/O; the host's
    `apps/pinetrie/host/folder/` is the only code that touches your folder
    (its scan, its watcher, and the accept's writes), carrying out what the
    package decides.
- **Amended by:**
  - ADR-0149: a folder project's data is in its session's directory,
    `$XDG_DATA_HOME/pinetrie/sessions/<name>/`.
  - ADR-0150: a lane's history has one kind, on its record, and a project's
    change of kind refuses the lanes of the other kind, as whole lanes, until
    a conversion that is still left open.

**Context.**

- **A folder with no jj repo is refused** (`planRoot`,
  `packages/lanes/plan.ts`). ADR-0135 made a state a snapshot and
  `.gitignore` the only declaration, so the disk model already works
  without a VCS. It left six points open for the second step: your folder,
  what accepted work and an offer are without commits, the merge base,
  text against binary, conflict records, and history.
- **The people this is for** keep their work in a folder: a designer's
  PSDs, `.blend` files, exports and notes; a developer's prototype or
  scratch project. They want three things. An agent works on its own copy.
  They see what it changed. They take that into their folder and never
  lose an edit of their own. They do not want the words commit, bookmark,
  rebase or `.gitignore`.
- **jj does five jobs for a jj project today:**
  - it isolates threads from your uncommitted edits;
  - it keeps history and a way back;
  - it finds the merge base;
  - it names what a review reads;
  - it shows offers in `jj log`.

  A folder project needs the first four from somewhere else. It does not
  need the fifth.
- **Much of the code for your repo exists because you and pine·trie both
  write it:** the evolog read that finds your edits to an offer, a
  divergent offer's repair, the ledger trailers, untraced accepted-offer
  commits and their joins (ADR-0079), `--ignore-working-copy`, and setup's
  `immutable_heads()`. In a folder project pine·trie is the only writer of
  states, so none of that applies. What both kinds share is narrower than
  what the code shares now: about 32 modules name jj, and the generic
  records (`OfferRecord`, `AcceptedRecord`) carry jj's bookmarks and change
  ids.
- **What S149 and S150 found about writing into a person's folder:**
  - never overwrite what was not seen;
  - stage a write, then rename it into place;
  - wait for quiet before taking a state;
  - FSEvents is a hint, and a full scan is the record;
  - APFS treats two names differing only in case or Unicode form as one
    name;
  - only content, the executable bit and portable symlinks cross the
    boundary.

**Decision.**

*A project is a jj project or a folder project, decided once.*

- **`planProjectDir` decides the kind at the host's start:** a folder in a
  jj workspace is a jj project; any other folder is a folder project. That
  includes a git repo without jj: its `.git` is outside every state, as it
  is outside git's own tree, and the host's start says that
  `jj git init --colocate` would give it commits.
- **The kind is wired once, at the composition root,** as the lane runtime
  is (`host/work/runtime.ts`). No other module asks which kind it serves.

*Your folder is accepted work.*

- **A folder project's accepted work is its folder.** There is no
  bookmark, no setup, no publish and no WIP. In a jj project, accepted
  work, your `@` and `main` are three places; in a folder project they are
  one.
- **The folder is read into a state** at four moments:
  - a thread's first message;
  - each catch-up with the folder;
  - each accept;
  - once the folder has been quiet for 10 s after a change the watcher saw
    (S149 rule 6, S150).

  A read is the host's scan of stamps against the last read's: on the
  Mac, a stat walk on APFS (S150). The disks role then copies the paths
  the scan names, and only those, into a new snapshot of the folder's
  previous state. The lane VM never walks the folder itself: over the
  virtiofs share its walk is about ten times the Mac's (S185). A file
  whose stamp moved while it was copied fails the read, and the read is
  tried again (S149 rule 4). A read that finds nothing changed makes no
  state.
- **Each state on the folder's line says who made it:** you (a read that
  found your edits), an accept (the thread, and its offer's description),
  or a restore.
- **Threads hear of your edits as they hear of new accepted work today:**
  the quiet-window read is the folder moving, and its news reaches threads
  as base news does (`apps/pinetrie/host/base-news.ts`).

*A thread starts from the folder as it is.*

- **A thread's lane starts from the state its first message read.** A
  catch-up merges the folder as it is when the catch-up runs.
- **This differs from a jj project on purpose.** There a thread sees only
  commits. Here a save is the only commit a person makes, and a step to
  share edits with threads would be a commit by another name. What a
  thread took is still exact: the state is recorded, and the thread's
  header can say "started from your folder at 14:02".

*An accept writes the offer into your folder, and never over what pine·trie
has not seen.*

- **An offer is the lane's tip and the folder's state it is merged
  against.** Its files are the source paths whose content differs. It is
  computed against the folder's newest state, as a jj project's offer sits
  on accepted work, and a conflict refuses an accept, as now.
- **An accept never destroys a save that reached the folder through its
  name,** whenever it was made: a save by rename, or a write that opened
  the path. A write through a file an app held open across the accept is
  kept as yours, unless it comes after the folder's next quiet read (S185,
  S192). The steps hold that by construction, with no timing constant.
- **An accept is one step, in this order:**
  1. write a journal of the accept to the session's store, so a host that
     stops part way puts back or finishes what it moved;
  2. read the folder;
  3. merge the offer onto that state. The result is a new state on the
     folder's line, with the lane's tip as its second parent;
  4. stage each path the merge changed beside its target, under a
     reserved prefix;
  5. for each path that exists, rename the target aside, under the same
     prefix. Check it against step 2's read: its stamp (size and ctime,
     S162, S169) before the move, and its inode, size and mtime after it,
     which a rename keeps. A file that changed is put back;
  6. link each staged file into place. A link fails if anything is at the
     target, so a file saved there since the move is never replaced;
  7. if any check or link fails, put back what was moved aside, remove
     what was linked, and refuse the accept, naming the file you are
     editing. The thread catches up and offers again. Otherwise remove the
     staged names; the new state is the folder's;
  8. keep each aside until the folder's next read, which comes once the
     folder, asides included, has been quiet. An aside as step 5 left it is
     deleted. One that changed is a write through a file held across the
     accept: its content is kept as a state of yours, concurrent with the
     accept, and shown as a concurrent write to a shared file is shown
     (ADR-0135).

  Mutagen and Syncthing check, then rename over, and both document that
  no file system call closes the race between the two (S149 rule 8). That
  race is real: a save landing between check and rename is replaced, and
  since no read saw it, no state holds it. On APFS the window is 79–179
  µs, and checking then renaming lost 1 of 3,000 saves by rename and 300
  of 3,000 writes in place (S185). With these steps, no trial lost a save
  of any kind they cover, on APFS or btrfs, a slow write in place through
  a held file included (S192). A pause before deleting the aside, tried first, lost
  every write that came later than the pause, whatever its length.
- **Scans see asides.** They are never your files, but every read checks
  each aside until it is deleted or kept. An aside that keeps changing (a
  log written through a held file) does not hold the folder's read back:
  it is kept as a state of yours at each read, and watched until it is
  quiet.
- **No `fsync` before the links.** It costs 5.8 ms a file on the Mac
  (`F_FULLFSYNC`), and what an accept writes is also in its state, so a
  write a crash loses is restored from there (S185).
- **The watcher knows the accept's writes by their stamps** (S185): the
  staging names by their prefix, and each written path by the stamp its
  link left. A save of yours a moment later has a stamp of its
  own, and is a state of yours.
- **Anyone admitted may accept,** as anyone may publish with its catch-up
  of your files (ADR-0099). Every accept can be undone by a restore.
- **What the folder cannot hold refuses the offer, naming the path:**
  - two paths that differ only in case or Unicode form, on a disk that
    treats them as one (S149 rules 1 and 2, S150);
  - a name that is not UTF-8 (rule 3);
  - a symlink whose target leaves the folder (rule 11).

  Each one is a problem in the offer for the thread to fix. None is a
  partial write.
- **Only content, the executable bit and symlinks inside the folder cross
  into it** (S149 rule 11). Owners, other mode bits, extended attributes
  and times stay on the side that made them.

*Your folder has a history, and any state of it can be restored.*

- **A restore is a new state** with an earlier state's content, written
  as an accept is, with the same checks. Nothing is rewritten, so a
  restore is undone by restoring the state before it.
- **The history is a list of the line's states:** who made each, when,
  and what it changed. The page designs it. A designer gets undo across
  every save and every accept, with nothing to set up.

*pine·trie keeps the graph of states.*

- **Each state has parents, recorded when it is made:**

  | state | parents |
  |---|---|
  | a read of your folder | the folder's previous state |
  | a lane's start | the folder's state it read |
  | a turn | the lane's previous state |
  | a catch-up | the lane's previous state, and the state merged in |
  | an accept | the folder's previous state, and the offer's tip |
  | a restore | the folder's previous state |

- **A merge base is a lowest common ancestor in that graph.** Since an
  accept has the lane's tip as a parent, the lane's next catch-up merges
  against that tip. The lane's accepted work is not merged twice, so
  ADR-0079's joins and untraced starts never arise in a folder project
  (S182).
- **Several bases are merged into one first, never chosen between**
  (S182). Which single base merges right depends on the content. Merged
  first, with a conflict among them kept as markers in the virtual base,
  as git's recursive strategy keeps it, the result is right or a
  conflict, never a wrong file. Several bases need an accept of an offer
  older than its lane, which the `offer_changed` refusal (ADR-0065)
  already prevents.
- **The graph is in the session's store; the content is in snapshots.** A
  state's id is its snapshot's name, which never changes and names
  content that never changes.
- **A snapshot is kept while a record names it, and one sweep deletes the
  rest.** The live set is a pure function of the records:
  - the folder's newest state;
  - every lane's tip, and its turns' snapshots, kept until its thread is
    archived, for branching, as now;
  - each live lane's merge base with the folder, and with its parent;
  - every open offer's states, and open conflicts' three versions;
  - the folder's history, within a budget of the lane VM's disk, the
    oldest states no other record names going first. A kept state costs
    about 2 ms and 35 KB beyond what its save wrote, so the budget is
    spent by rewritten content, such as a document saved whole, not by
    the number of states (S184).

  A merge base only moves forward as a lane catches up or is accepted, so
  keeping the current ones keeps every base a future merge can need. No
  act deletes a snapshot because it made one obsolete: that is the sweep's
  job, and only the sweep's.

*Merging is path by path (ADR-0135, S160), and lanehost runs it.*

- **The disks role merges,** with the three snapshots in reach: a path
  changed on one side takes that side, as a clone of its file; the same
  change on both sides is taken once; text is merged three ways by `git
  merge-file`; anything else conflicts. The mode is a field of its own.
  The result is checked as a tree, and a rename inferred from the two
  diffs is offered, never applied.
- **`git merge-file`, not a merge in TypeScript** (S181). `node-diff3`
  reported a real conflict clean, taking one side, and took 15 times as
  long. The disks role's image carries git.
- **A merge writes only the paths whose result differs from the
  receiving side's** (S183). A diff counts every written file as changed,
  equal content included, since a clone gets new times. A path changed
  only on the receiving side, or alike on both, is left as it is, and a
  text merge's result is compared with the receiving side's bytes before
  it is written. Where states are compared otherwise, shared extents
  prove equal content without a read, and anything else is read.
- **A file is text when it holds no NUL byte,** git's rule (S181). It
  merges legacy-encoded text, such as an Excel CSV in Windows-1252, line
  by line, where a rule of "valid UTF-8" would conflict. UTF-16 text is
  binary under either rule.
- **A clean merge of text is not proof of a working file.** The run that
  follows a catch-up checks it, as every catch-up's run does (ADR-0033).

*A conflict is a record, and the agent reads its versions read-only.*

- **A conflict names one path and three states:** the base, ours and
  theirs. The receiving side keeps its own file (ADR-0135). In a folder
  project, conflicts arise only in lanes: an accept takes only a clean
  offer, so none reaches the folder.
- **The agent reads the three versions at
  `/pinetrie-states/conflicts/<path>/{base,ours,theirs}`,** read-only and
  outside `/workspace`. Open conflicts are listed in its context.
- **A lane's states reach its running container by one directory of its
  own** (S186): beside its disk, bind-mounted read-only at
  `/pinetrie-states` when its container is made. What the disks role
  makes in it later (a snapshot, a conflict's versions) appears at once,
  and `start` is a symlink that a rename moves. The lane can write
  nothing there. `/pinetrie` itself is pine·trie's install.
- **Resolving is choosing a version** (ADR-0135): base, theirs, or the
  lane's file as the agent or you left it. The agent chooses through a
  tool, which every lane is given and which refuses where there is no
  conflict (S85). You can choose on the page.

*A folder project's lane.*

- **`/workspace` holds the state, with no repo.** A turn is its snapshot,
  diff and classes, as now, and makes no commit: its revision record has
  a snapshot and no commit, and a branch at it works as now.
- **These paths are never part of a state:** `.git`, `.jj`,
  `.pinetrie-lane`, `lost+found`, and each shared directory. They are
  listed in one place, and scans, diffs, merges and offers all read that
  list. An agent's own `git init` makes a repo local to its lane, which is
  never offered.
- **The agent sees its work as a diff:** the state its offer is computed
  against is at `/pinetrie-states/start`, read-only, so
  `diff -r /pinetrie-states/start /workspace` shows its work. The lane's
  note (`packages/pi/lane.md`) is worded by the project's kind, and a
  folder project's names no jj.
- **`.gitignore` is read without a repo** (S180). The oracle is pure: a
  matcher per `.gitignore` of the state, in `@pinetrie/rules`, which
  agreed with git on every path of three corpora. Its agreement with git
  is a test. No `GIT_CONFIG*` variable, global excludes or system
  config reaches it: a lane's own `core.excludesFile` hid all of
  `.pinetrie-lane/` from S180's first run.
- **The search tools read `.gitignore` without a repo too:** rg and fd
  get `--no-require-git`, `--no-ignore-global` and `--no-ignore-parent`
  (S180). Without them, in a folder project, the agent's grep and find
  search all of `node_modules`. With them they agree with git on every
  path, and also honour `.ignore`, which hides only more from search.
- **No WIP and no split.** `split_offer` refuses with why. A catch-up
  with the thread a thread branched from works, with its base from the
  graph.

*pine·trie keeps nothing in a folder project's folder.*

- **The session, the lanes' runtime, the ignore file and the snapshots'
  records are in ADR-0118's session directory**
  (`$XDG_DATA_HOME/pinetrie/<session>/`). That decision is built first for
  folder projects.
- **Shared directories stay outside every state because of where they are
  mounted** (ADR-0135). The folder's scan skips them.

*The review shows files as files.*

- **A review is named by two states and a path.** States never change, so
  each answer is served as immutable, as a commit-named one is
  (ADR-0047).
- **Text gets the unified diff; an image gets before and after, side by
  side; any other file gets its sizes, and both versions to open.**

*In the code, both kinds share one surface, and each kind is an adapter.*

- **The ports** carry only what both kinds do. jj implements each through
  your repo and a lane's repo, and a folder project through states:

  | port | does | jj project | folder project |
  |---|---|---|---|
  | **states** | snapshot, restore, diff, read one file, clone a file into a disk, delete | lanehost (as now) | same |
  | **ignores** | which paths `.gitignore` ignores, in a state | `git check-ignore` in the lane's repo, or the pure matcher | the pure matcher over the state's `.gitignore` files (S180) |
  | **turn** | record a turn | commit with jj, then snapshot | snapshot |
  | **merge** | catch up a lane with a base or a parent | jj's merge | the path merge, on the graph's base |
  | **destination** | read accepted work, accept, watch it move | your repo, through its owner | the folder, through its writer |
  | **review** | files and one file's diff, between two points | `jj diff` by commit | files compared by state |

- **`apps/pinetrie/host/folder/` is the only code that reads or writes a
  folder project's folder** (revised: this said `@pinetrie/folder`): its
  scan, its staged and checked writes, and its watcher, which the shared
  directories' watcher becomes a use of. `@pinetrie/folder` decides for it,
  with no I/O, and declares only `@pinetrie/core`. `@pinetrie/repo` stays the only writer
  of a jj repo. The jj code in a lane (`revisions.ts`, `merge.ts`,
  `bookmarks.ts`) moves out of `@pinetrie/lanes`, which keeps containers,
  disks, the queue and the ports.
- **Every decision is a value in `@pinetrie/rules`:** the graph's merge
  base, the path merge's plan, the live set of snapshots, an accept's
  steps, a folder's name collisions.
- **Made correct by construction:**
  - `StateId` and `CommitId` are separate brands. A folder project's
    records are their own variants, so none can carry a commit, a
    bookmark or a change id. The jj-only fields leave the generic records
    (`OfferRecord.bookmark`, `edited`, `acceptedAs`; `AcceptedRecord`'s
    `heads`, `log` and `wips`) for the jj variant.
  - An accept takes a clean offer, a type only the conflict check returns.
    An offer with an open conflict cannot be passed to it.
  - A folder write is a step that carries what it expects to find (the
    stamp it replaces, or nothing there). No write step lacks one, so the
    writer only compares. It moves a file aside and links its new one in,
    and never renames over a target, so no file it has not checked is
    ever replaced; an aside is deleted only by a read that found it as
    the accept left it (S185, S192).
  - A project path is relative, in NFC, with no `.` or `..`, from one
    constructor at the edge. A folder project's tree is also keyed by its
    folded name, so a collision is found when the tree is checked, never
    as an `EEXIST` halfway through a write.
  - A merge's output is a tree that cannot hold a file and a directory at
    one path. A clash is a conflict.
  - A merge's plan holds a write only for a path whose result differs
    from the receiving side's, so its diff names exactly what it changed
    (S183).
  - The merge base is a set of states, merged into one when it has more
    than one. No function picks one base (S182).
- **One conformance suite runs both adapters:** the same start, turn,
  catch-up, conflict and accept, checked against each, as
  `apps/conformance` runs pi's own Storage suite against ours.

**Consequences.**

- **Built in two steps.** First, the ports with jj's adapters alone, with
  no change in behaviour: today's suites are the proof. Then the folder's
  adapters, `@pinetrie/folder`, the conformance suite, and the page's
  history and media review.
- **For a person with a folder:**
  - `pnpm host <folder>` works on any folder that is not your home
    directory or `/`, with nothing to set up;
  - an agent's work arrives as files in the folder, and every save and
    accept can be undone;
  - the folder holds nothing of pine·trie's;
  - the first output of a run in a folder without a `.gitignore` is
    named in the turn's record, and the agent proposes one, as ADR-0135
    says. For a designer it names the clutter too (`.DS_Store`,
    `*.blend1`).
- **For the code:** the jj-only machinery (evologs, divergent offers,
  ledger trailers, joins, untraced starts, setup) is confined to the jj
  adapter, and the generic records no longer name it.
- **What it costs:**
  - a folder read at each start, catch-up and accept: a stat walk of
    about 0.3 s per 100,000 files on the Mac (S150), plus about 0.45 ms a
    changed file to copy it into the lane VM (S185). A first read of a
    folder copies all of it: 7.7 GB of 49,801 files took 33 s;
  - the snapshots kept for merge bases and history: about 2 ms and 35 KB
    each, plus whatever rewritten content they keep from being freed
    (S184);
  - a text merge: about 3 ms a path, a `git merge-file` process (S181);
  - an accept refused when a save of yours lands while it runs. On APFS
    its steps take a few hundred µs a file, so a save within that time of
    it refuses it far more often than on btrfs (S192). The thread catches
    up and offers again.
- **What a folder project lacks:** WIPs, stacks, publish, jjui, and
  remotes.
- **Risks:**
  - an app that holds a file open across an accept (S149). If it saves
    by rename, its stale content replaces the accepted file: the accept's
    state keeps the accepted content, and the history shows both. If it
    writes through the open file, the write is kept as yours, unless the
    file sat idle past the folder's next quiet read first: then the write
    goes to an aside already deleted, and is lost (S192);
  - large media copied into the lane VM costs its size on the VM's disk,
    once per change.
- **Left open:**
  - changing a project's kind. "Start version control" could write the
    folder's line as commits (S159's codec) and continue as a jj project;
  - bundles (`.app`, `.logicx`, `.photoslibrary`): directories an app
    treats as one document, which should merge as one value;
  - conflict records for jj projects, which keep jj's markers until a
    decision of their own;
  - the history page's design.

**Alternatives rejected.**

- **Accepted work as a line of states, with the folder catching up by a
  publish.** A designer would accept, then see an unchanged folder until a
  second step. It is the jj model with its least useful step kept.
- **A hidden jj repo backing the folder.** ADR-0135 rejected jj as the
  record of the state, and the people this is for do not want a repo in
  their folder. jj also leaves new files over 1 MiB untracked, and needs
  about four times a file's size in memory to take one (S159): media is
  the common case here.
- **Threads seeing only states you share explicitly.** That step is a
  commit by another name, and the moment it records (your save) already
  exists. It can come later as an option.
- **Syncing the folder with a thread both ways, continuously** (S149,
  S150). The folder would change under you as threads work. An accept is
  the one moment the folder is written, and you choose it.
- **Mounting the folder live in lanes** (ADR-0118's live mode): no copy of
  its own, so no offer, no review and no undo. It stays available as a
  live source.
- **Checking, then renaming over** (Mutagen's and Syncthing's way): a
  save that lands between the two is lost unseen (S185).
- **A pause before deleting what was moved aside.** Nothing chooses its
  length, and a write that comes later than it is lost (S192).
- **A text merge in TypeScript** (`node-diff3`). On pine·trie's own merges
  it reported a real conflict clean, and took 15 times as long as `git
  merge-file` (S181).
- **Choosing one merge base when there are several.** Which one merges
  right depends on the content (S182).
- **Joins, as in a jj project** (ADR-0079). Recording an accept as a merge
  in the graph removes the need for them.
- **Markers or conflicted copies in the folder.** ADR-0135 rejected both.
  In a folder project no conflict reaches the folder.
- **Keeping every state forever.** A sweep over a live set keeps what a
  merge or a history can need, and nothing that only an act's memory says
  is safe to drop.
