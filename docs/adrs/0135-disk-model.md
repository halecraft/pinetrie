# ADR-0135 — A state is a turn's snapshot; `.gitignore` alone declares what is not source, and what a recorded run made is derived; recipes are learned from what each tool call read; jj, where a project has it, commits as it always does

- **Status:** Accepted (Duane, 2026-10-12)
- **Area:** `packages/lanes/TECHNICAL.md`, `docs/01-architecture.md`
- **Evidence:** S146, S147, S148, S155, S156, S157, S158, S159, S160, S161,
  S162, S169, S170, S171, S172, S173, S175
- **Supersedes:**
  - ADR-0131: derived state is learned from what each tool call's commands
    read and wrote, not declared (`lanes.install`, `installWhen` and
    `installCaches` go). pine·trie runs no recipe and builds no dependency
    layer: the base is the base before it, checked out at accepted work, and a
    disk made for a new state loses the outputs whose recipe's key broke. A
    turn's record classes what it wrote as derived and local.
- **Amends:**
  - ADR-0034: the base is the base before it, with accepted work checked out
    on it, and runs no command; no fork installs, and nothing installs for a
    lane: its agent does, as a developer would after a clone.
  - ADR-0130: a change to `pinetrie.json` that widens what a lane may do or
    share takes effect only from accepted work; a lane's own copy can only
    narrow it.
  - ADR-0035: a write to a shared directory is attributed to the tool call
    that made it, and given a version; a write based on a version that is no
    longer current is shown as concurrent. The directory stays live, with no
    history, and is never branched.
- **Revised:**
  - 2026-10-13 (S170, S171, S172, S173, S175): the eBPF observer replaces the
    supervisor: one per machine, in lanehost's machine role, stopping no call.
    EINTR, the cost and a listener's not nesting leave the risks. A lane's own
    lanes cannot be observed yet: under its rootless Docker an inner lane
    shares its outer lane's cgroup (S175).
  - 2026-10-12 (S172): a version two lanes' turns both claim is contested, and
    flagged concurrent.
  - 2026-10-12 (S172): an eBPF observer was measured, as an alternative to the
    supervisor.
  - 2026-10-12 (S171): a tracer supervisor was measured: it ends the EINTR but
    takes `strace` and `gdb` from lanes. A listener's not nesting is a known
    risk.
  - 2026-10-12 (S170): a known risk: any watched call can return EINTR to a
    program whose signal handler does not restart calls.
  - 2026-10-12 (S169): a shared file's version is its size and ctime, which
    the host and a lane read alike (on the Mac the inode differs, across
    virtiofs), and versions order by ctime, the host's clock for every write,
    on the Mac and on Linux; so the host's watcher puts your writes on a
    file's lineage as they are made. A lane's write is based on what that lane
    last read, across tool calls and turns, not on what its own call read.

**Context.** pine·trie leans on jj for what a project's state is, and on
jj's ignore rules for which files belong to it. Five problems follow:
- **No state without a VCS.** A project without jj or git, or with no files
  yet, has no state.
- **The boundaries leak.** Once a commit tracks a file under `.plans`,
  jj snapshots that shared directory's live edits, and a checkout deletes
  the file, as a probe in `/tmp` showed. Ignore rules are all that keep a
  shared directory out.
- **Derived files outlive what made them.** jj manages tracked files only,
  and pnpm does not prune an importer it no longer lists: a package deleted
  from accepted work left its `node_modules/` in the base, and in every
  lane forked from it.
- **Recipes are declared, and their inputs are incomplete.** ADR-0131's
  recipe is a command someone names (`lanes.install`), keyed by a lockfile
  (`installWhen`). Every lockfile-only key measured missed inputs: every
  `package.json`, `.npmrc`, `~/.npmrc` (S157).
- **Config is read once,** at the host's startup, from your working copy
  (`prepareLanes`). A lane whose own files hold another `pinetrie.json`
  still gets the startup one.
- **Shared directories lose writes silently.** Two lanes writing one plan
  file keep only the last write, and nothing says who wrote what.

The spikes behind this decision:
- **S146, S148:** a turn's btrfs snapshot and its diff, about 2 ms, with
  deletions.
- **S155:** "a command wrote it, after reading source" marked exactly what
  git ignores, on all 29,712 files the commands of three real repos wrote.
  What must stay local, and a lockfile's first write, needed someone's
  intent.
- **S156:** a whole state can be hashed as a git tree, and updated after a
  turn in under a millisecond. But a large file costs 0.6–0.9 s per GB to
  hash again after any change, unless it is split into chunks that no
  other tool can read.
- **S157:** the inputs a recipe really reads, against the lockfile it
  declares. A replay at the same path differs only in timestamps, and every
  lane is at `/workspace`.
- **S158:** a seccomp user-notification listener per tool call attributes
  every write and read to the call that made it, with no privilege: daemons,
  static binaries, `env -i` and parallel calls included. It costs about
  26 µs per watched call. It also sees lookups of files that do not exist.
- **S159:** jj's snapshot equals the source files' tree once ignores match.
  jj leaves new files over 1 MiB untracked with only a warning.
- **S160:** a path-by-path merge agreed with jj on 99.8% of the paths both
  sides changed, in 313 real merges.
- **S161:** a lane's writes into a shared directory are all seen, and
  concurrent writes are flagged exactly. The Mac's watcher saw every write,
  from lanes and from the Mac.
- **S162:** a file's stamp (inode, size, ctime) changed on every change of
  its content, mtimes restored by `touch -r` or `cp -p` included, and
  decided S161's races as content hashes did.

**Decision.**
- **A state is a turn's snapshot.**
  - Each turn's btrfs snapshot is the state it leaves. What a turn changed is
    the diff of two snapshots (S146).
  - Whether two states hold the same files is whether their diff is empty.
  - Nothing hashes a whole state. A file is hashed only when something
    needs its content: a recipe that read it (below), or jj committing it.
- **Every path is source, derived or local.**
  - **Source:** what the project is made of. It travels with its state, to
    forks, to offers, and to commits where the project has a VCS.
  - **Derived:** what a recorded run made from source. It may be dropped
    and made again.
  - **Local:** neither. It stays on the disk it is on, and is never sent,
    offered or committed.
- **`.gitignore` is the only declaration, with or without git.**
  - A path `.gitignore` does not ignore is source. A path it ignores is not
    source.
  - Among ignored paths, derived or local is observed, not declared:
    - **derived** if a recorded run made it: a tool call's command that
      read source, and did not edit the file in place;
    - **local** otherwise: `.env`, `scratch/`, anything a tool wrote, or a
      command wrote from nothing.

    A derived path a later run rewrites stays derived. A tool's write inside
    a derived path is local, so a hand edit there is never dropped.
  - `.gitignore` is the one ignore format git, jj, ripgrep, fd and editors
    all read, so they all see the same project pine·trie sees.
- **Origin advises; it never decides silently.**
  - Origin is what a tool call wrote, and what its commands read (S155).
  - When a run makes files that `.gitignore` does not ignore (thousands of
    files under `node_modules/`, a `dist/`), the turn's record says so. The
    agent then proposes a `.gitignore` edit, which is reviewed with the
    offer like any change.
  - A folder without a `.gitignore` treats everything as source until one
    is written.
- **Every tool call is a run, which one observer per machine sees.**
  - An eBPF program, loaded by lanehost's machine role outside every lane,
    tags a run where its first process execs with its number in its
    environment, in a cgroup a host registered; every task it starts
    inherits the tag, and keeps it, whatever it execs or wherever it moves
    (S172). It reports each open, rename, unlink, mkdir, link and symlink,
    and each written file's last release, and stops none of them.
  - A write is attributed to the call whose process tree made it, however
    and whenever that process runs. A write nothing attributes is treated
    as a tool's write: source, or local where `.gitignore` ignores it.
  - Stat and access calls are not watched, for their cost (up to 2.7×,
    S158). Directory listings on the path to each input stand in for them.
  - An event the observer had no room for is counted against its run, and
    a run with a loss is no recipe (S172). Its container holds `CAP_BPF`,
    `CAP_PERFMON` and `CAP_SYS_PTRACE`, under Docker's own seccomp
    profile (S173); where none can load it (rootless Docker, a kernel
    before 5.17 or without BTF), the host refuses lanes and says why.
- **A recipe is a recorded run, not a declaration.**
  - Any tool call whose commands made derived files is one.
  - **Its key** is a hash of:
    - its command and its image;
    - the content of each source file it read;
    - the files it looked for and did not find;
    - each file it read under `$HOME`, outside a cache. `$HOME` is on the
      lane's disk.

    Those files are small (manifests, lockfiles, config), and their hashes
    are cached while a file's stamp is unchanged (S162).
  - **A cache is a derived directory that runs only ever add files to,** or
    one holding a `CACHEDIR.TAG`. Examples are pnpm's store, uv's and
    cargo's caches. Tools address what is in them by content, and check it
    themselves. A cache is never dropped for a key that broke, and travels
    with its disk.
  - pine·trie never schedules a run. The agent, or you, run commands as a
    developer would.
  - **A disk for a new state is always a copy of a disk that exists,** then
    a subtraction:
    - a fork clones its parent's snapshot;
    - the base clones the previous base and checks out accepted work. It
      says what it holds inside itself (`.pinetrie-lane/base.json`), not
      in a file beside it, and runs no command, so it holds nothing
      derived;
    - a catch up merges in the lane itself.

    pine·trie then deletes each derived output whose recipe's key no longer
    holds on the new state, and leaves the rest: source, local files, caches
    and outputs still good. Whoever works there makes again what was
    deleted, as a developer would after a pull. A deleted package's
    `node_modules` goes, because pine·trie knows every output it recorded,
    and caches stay warm.
  - **pnpm's store stays where pnpm keeps it,** at the root of the file
    system it installs on, which in a lane is the disk's
    (`/workspace/.pnpm-store`). pnpm refuses a `node_modules` made with
    another store path (S148). No repo in a lane tracks it, whatever the
    project ignores.
- **What pine·trie knows about a project's files is a fact of a state.**
  - A fact is a pure function of some files, keyed by their content, and
    computed again on each new state where they changed. `pinetrie.json`,
    the lane config, is one.
  - No change pine·trie acts on reaches it except as a state, or as a
    write to a shared directory (below).
  - **Authority follows the direction of a change.** A lane can always
    narrow what it may do or share. Only accepted work widens it: a grant,
    or any setting whose values have no order. The reply to the tool call
    that changed the file says which applies, and an offer's review lists
    the widenings it would make.
    - A lane narrows by what its own copy dropped from the copy it started
      on: a grant accepted after it started reaches it, and one its copy
      adds never does.
    - Your repo's names (`accepted`, `wip`, `publish`) are not a fact of a
      state. They are how accepted work is found, so they come from your
      config and your working copy's `pinetrie.json`, at startup. Before
      any project file exists, pine·trie runs on its defaults and your
      config: a project grants nothing until accepted work's
      `pinetrie.json` does.
    - Host ports and mount sources reach the lane VM when the host starts,
      so a widening of either applies at the next start, after acceptance.
- **A shared directory stays live, with every write attributed and
  versioned.**
  - **It is outside every state by where it is mounted,** never by ignore
    rules. A snapshot's diff, and jj, never see it.
  - **Each write is numbered** by the host as it is made, and attributed to
    the tool call that made it, or to the Mac.
  - **A lane's write carries the version its lane last read:** what the
    agent knew of the file, by any tool, in this turn or an earlier one;
    with no read, the version current when the file was opened. An append
    is based on the version it appended to: it loses nothing. The
    observer sees the open and the last release, whoever lets the file go
    (S172), and the read and write tools are stamped alike.
  - **A version is the file's stamp: its size and ctime,** read with one
    `stat`, so no file is read or hashed (S162). No program can set ctime,
    so a tool that restores an mtime still changes the stamp, and so does a
    save by rename. The inode is left out: on the Mac a lane and the host
    see different inodes for one file, and the same size and ctime (S169).
  - **A write based on a version that is no longer current is shown as
    concurrent,** not silently lost. A write from the Mac carries no
    version read, so it cannot be checked.
  - **Two writes that overlap,** each opened before the other was
    released, are flagged, but which one's content survived is not known
    (S162).
  - **A version two lanes' turns both claim is contested.** A release's
    stamp is read after the call has returned, tens of µs later on the Mac
    (S172), so another writer's version can land first and be read as this
    write's; the watcher, which stats 11–68 ms after its event (S169),
    never sees the one it replaced. Both writes, and any write based on
    the contested version, are flagged concurrent, and the version keeps
    its first writer. A program outside pine·trie that writes in that
    window is not caught: it claims no version. A release whose size or
    inode, read then, is not the kernel's at the release is raced, and its
    version contested as a claimed one is.
  - **A turn's record names the versions it read and wrote.**
  - **Versions order by their ctime, not by when they are learnt.** ctime
    is the host's clock for a lane's write and for yours alike, on the Mac
    and on Linux (S169); a step back of that clock would misorder the
    writes either side of it. A
    turn is recorded at its end, so a write may be recorded before an
    earlier rival; it is found concurrent once the rival is, and its record
    says so then.
  - **Your writes on the Mac** are seen by the host's watcher as they are
    made, each with the stamp a lane would read. A version the watcher saw
    that a lane's turn later reports is that lane's; one no lane reports is
    yours. A stamp no lineage has seen, when a lane reads or writes the file,
    is yours too.
  - **No fact that grants authority reads a shared file.** A recipe that
    read one is carried only while that file's version is unchanged.
- **jj, where a project has it, works as it always does.**
  - Each turn is committed with jj's own snapshot. pine·trie writes no
    objects of its own.
  - jj's refusal of a new file over its size limit (1 MiB by default)
    appears in the turn's record, with the file's name, rather than only on
    a stderr nobody reads (S159). The project then ignores it or tracks it.
  - A project without a VCS has the same states, the snapshots, with no
    commits.
- **Merging two states without a VCS is path by path** (S160).
  - A path changed on one side takes that side, and the same change on both
    sides is taken once.
  - The mode is merged as a field of its own.
  - Text is merged three ways. Anything else is a conflict.
  - The result is checked as a tree, so that a directory and a file never
    meet at one path.
  - A rename inferred from the two diffs is offered as a resolution, never
    applied on its own.

  In a jj project, jj merges, and S160 found that it decides as this does.
- **A conflict is a record, never a file.** This holds with or without a
  VCS; a jj project keeps jj's own conflicts as well.
  - **It names one path and three versions:** the base, ours and theirs.
    All three are already in snapshots pine·trie keeps.
  - **The folder holds one version:** the receiving side's. On a catch up,
    the thread keeps its own file, so work in progress is never
    overwritten. No markers, and no conflicted copies beside the file.
  - **Resolving is choosing a version.** A media file offers the three.
    Text also offers a three-way merge, and an agent may offer a merge of
    its own; each is a candidate, and you choose.
  - **An agent reads the three versions with ordinary tools,** read-only,
    outside the project. Open conflicts are listed in its context.
  - **An offer with an open conflict cannot be accepted,** so a conflict
    never reaches accepted work.

**Consequences.**
- **Built in two steps:** first for jj projects, which are every project
  pine·trie serves today; then for projects without a VCS, which need states
  without commits, the path-by-path merge and conflicts as records. Until
  that second step, a jj project's conflicts keep today's flow, with jj's
  markers in the files.
- **Projects:**
  - A project without jj or git works, from its first file.
  - Nothing is configured. `.gitignore` is the one file that says what a
    project is, and it is a file every developer already knows.
  - pine·trie, git, jj and your editor see the same project.
- **What it costs:**
  - About 26 µs per watched file call: a few milliseconds on an everyday
    command, +0.3 s on a `pnpm install`, +0.9 s on a test run, and nothing
    measurable on builds (S158).
  - Hashing a recipe's inputs, which are small and cached.
  - Large files cost nothing, unless a recipe reads them, or jj commits
    them as it would without pine·trie.
  - The first lane after a merge that changed a recipe's inputs runs it
    again, as a developer would after a pull: about a second for pnpm with
    its store warm.
  - A turn's record waits for its classes and its diff, and a branch at the
    turn waits for its record: a few milliseconds for the diff (S146). A
    turn's snapshot is off the critical path; a fork's is not (S147).
  - A project without a `.gitignore` has its first derived output treated
    as source, until the agent adds one in a visible edit.
- **What goes:**
  - `lanes.install`, `installWhen` and `installCaches`;
  - dependency layers built by pine·trie, and the in-lane re-install. The
    base is no longer built fresh: it is the previous base, with accepted
    work checked out and stale outputs deleted;
  - reading `pinetrie.json` once at startup.
- **Risks:**
  - Over virtiofs a shared file's stamp is the observer's own `lstat`,
    median 16.7 µs after the release or the open (S172): another writer's
    version can land in that window. One that changes the size or the
    inode is caught as raced; a program outside pine·trie that writes in
    it, with the same size, is not.
  - An open that finds nothing is seen at its lookup's return, a probe
    every open on the machine passes through; its cost outside a run is
    not yet measured on the Mac.
  - A lane's own lanes cannot be observed: under its rootless Docker an
    inner lane shares its outer lane's cgroup, so by cgroup its runs are
    the outer lane's (S175), and a host there refuses lanes. A lane's
    identity would have to be what sets them apart, its first process's
    pid namespace.
- **Left open:**
  - states moving between machines. Between lane VMs, `btrfs send` (S146,
    S148) is where to start; the boundary with the Mac is a separate
    problem;
  - syncing your folder on the Mac with your thread (S149, S150, put
    aside). The second step needs it (below).
- **For the second step: projects without a VCS.** Its plan starts from
  these points, which this decision leaves unsettled:
  1. **Your folder on the Mac, a prerequisite needing a decision of its
     own.**
     - In a jj project, accepting work moves a bookmark in your repo.
     - Without a VCS, your project is a plain folder, so accepting or
       publishing writes files into it while you may be editing them.
     - That is the folder sync S149 and S150 began and this work put
       aside. It must be decided before the second step is planned.
  2. **What accepted work, an offer and a WIP are without commits.** The
     likely answer:
     - accepted work is a line of snapshots;
     - an offer is a lane's snapshot paired with the snapshot it started
       from.
  3. **The merge base.**
     - A three-way merge needs a common ancestor, which jj finds from
       commits.
     - Without it, pine·trie records which snapshot each lane, fork and
       catch up started from: a graph of states.
     - It also keeps each snapshot that can still be a merge base. How
       long, and which, is to be decided.
  4. **Text against binary, and modes.**
     - S160 called a file binary when it holds a NUL byte, and merged git's
       two modes.
     - Whether those rules hold for a project with no git is to be
       decided.
  5. **Conflict records:**
     - where they are stored (the session store, presumably);
     - how the page shows a conflict and its candidates;
     - where an agent reads its three versions, such as a read-only
       `/.pinetrie/conflicts/<path>/` outside the project.
  6. **History.** A branch at a turn already works from snapshots. What
     reads jj now for history (a turn's changed files, an offer's files,
     the review page) must read snapshot diffs (S146) instead.

**Alternatives rejected.**
- **A content hash for every state, as a git tree id** (S156). Nothing needs
  one: snapshots identify states and their diffs say what changed. A large
  file would cost 0.6–0.9 s per GB of hashing on every change, in CPU and
  battery, unless it were chunked.
- **Chunked large files, and pointers in commits.** They are formats no
  other tool reads: a clone from a remote would hold pointers, and jj would
  disagree with the files on disk.
- **Declaring classes in a file of pine·trie's own** (`[classes]` in a
  `pinetrie.toml`, or a list of patterns). It is a second source of truth
  beside `.gitignore`. Derived and local can be observed instead.
- **A generated `.git/info/exclude`.** Git, jj and editors would hide files
  no visible file ignores, and another clone would see a different project.
- **pine·trie writing commits for jj to import** (S159). jj's operation log
  would show imports where people expect snapshots, and a person using jj
  in a lane would race pine·trie's writes.
- **jj as the record of the state.** A project without jj would need a
  second model.
- **Conflicted copies in the folder,** as Dropbox and Syncthing write
  them. They sync, get edited, and multiply. A record outside the folder
  points at versions that already exist.
- **Content hashes as a shared file's version** (S161). Every open and
  release would read the whole file, and a stamp decides the same (S162).
- **A history of a shared directory's content.** It would hash and copy
  every version of every file written, 322 MB files included, with nothing
  that needs it beyond concurrency, which versions give.
- **strace for reads.** It is 20–73× on builds (S155, S157).
- **fsatrace.** It crashes processes that outlive their command, and does
  not see static binaries or `env -i` (S158).
- **inotify, attributing by time.** With pi's parallel tool calls, an
  authored file came out derived (S158).
- **fanotify from lanehost's privileged role.** It needs privilege, and a
  pid looked up after the event can be gone or reused. seccomp does the
  same job without either problem.
- **Declared recipes and lockfile-only keys.** Every one measured missed
  inputs (S157).
- **`git clean -fdX` in the base:** it deletes `.jj/` and pnpm's store.
- **Deleting directories that hold only ignored files:** a guess at what is
  stale, needing a rule for each kind of output. Recorded runs know.
- **pnpm's store on a volume of its own, mounted into lanes:** pnpm refuses
  a `node_modules` made with another store path, and a store lanes write is
  a channel between them.
- **Naming the base by its subvolume's id:** an id is the disk's identity,
  not its content.
- **Building the base fresh each time,** as ADR-0131 did. It loses every
  cache, so each change of a lockfile means a cold download. A copy of the
  previous base, minus the outputs whose keys broke, leaves nothing stale,
  because every output is recorded.
- **Declaring caches** (`installCaches`). Tools only add to their caches, so
  pine·trie can see which directories are caches.
- **Splitting `pinetrie.json` by authority.** The direction of a change
  decides authority for every setting, with no section to remember.
- **Following renames on every merge, as git does.** In 313 merges it
  invented a rename twice (S160).
