# ADR-0135 — A state is a turn's snapshot; `.gitignore` alone declares what is not source, and what a recorded run made is derived; recipes are learned from what each tool call read; jj, where a project has it, commits as it always does

- **Status:** Proposed (2026-10-11)
- **Area:** `packages/lanes/TECHNICAL.md`, `docs/01-architecture.md`
- **Evidence:** S146, S148, S155, S156, S157, S158, S159, S160, S161, S162
- **Amends:**
  - ADR-0131: a recipe is any recorded run of a tool call that made derived
    files, learned rather than declared (`lanes.install`, `installWhen` and
    `installCaches` go). pine·trie runs none itself; a disk made for a new
    state carries each output whose recipe's key still holds there.
  - ADR-0130: a change to `pinetrie.json` that widens what a lane may do or
    share takes effect only from accepted work; a lane's own copy can only
    narrow it.
  - ADR-0035: a write to a shared directory is attributed to the tool call
    that made it, and given a version; a write based on a version that is no
    longer current is shown as concurrent. The directory stays live, with no
    history, and is never branched.

**Context.** pine·trie leans on jj for what a project's state is, and on
jj's ignore rules for which files belong to it. Five problems follow:
- **No state without a VCS.** A project without jj or git, or with no files
  yet, has no state.
- **The boundaries leak.** Once a commit tracks a file under `.plans`,
  jj snapshots that shared directory's live edits, and a checkout deletes
  the file, as a probe in `/tmp` showed. Ignore rules are all that keep a
  shared directory out.
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
- **Every tool call runs under a supervisor.**
  - The supervisor is a child subreaper. It installs a seccomp filter that
    sends each open, rename, unlink, mkdir, link and symlink to it, and
    every process the call starts inherits the filter (S158).
  - A write is attributed to the call whose process tree made it, however
    and whenever that process runs. A write nothing attributes is treated
    as a tool's write: source, or local where `.gitignore` ignores it.
  - Stat and access calls are not watched, for their cost (up to 2.7×,
    S158). Directory listings on the path to each input stand in for them.
  - The supervisor's listener must never stop. If it does, its call hangs,
    and if its descriptor closes, its processes' file calls fail (S158).
- **A recipe is a recorded run, not a declaration.**
  - Any tool call whose commands made derived files is one.
  - **Its key** is a hash of:
    - its command and its image;
    - the content of each source file it read;
    - the files it looked for and did not find;
    - `$HOME`'s configuration as a whole, since `$HOME` is on the lane's
      disk.

    Those files are small (manifests, lockfiles, config), and their hashes
    are cached while a file is unchanged.
  - pine·trie never schedules a run. The agent, or you, run commands as a
    developer would.
  - **When pine·trie makes a disk for a new state** (a fork, the base, a
    catch up), it carries, by reflink, each derived output whose recipe's
    key holds on that state, and leaves out the rest, for whoever works
    there to make again. The base is accepted work's files plus the outputs
    whose keys hold there.
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
- **A shared directory stays live, with every write attributed and
  versioned.**
  - **It is outside every state by where it is mounted,** never by ignore
    rules. A snapshot's diff, and jj, never see it.
  - **Each write is numbered** by the host as it is made, and attributed to
    the tool call that made it, or to the Mac.
  - **A lane's write carries the version its writer read:** the version
    current when the file was opened. The supervisor sees the open and the
    release (`close`, `dup3`, `exit_group` or `execve`; S161).
  - **A version is the file's stamp: its inode, size and ctime,** read with
    one `stat`, so no file is read or hashed (S162). No program can set
    ctime, so a tool that restores an mtime still changes the stamp, and a
    save by rename changes the inode.
  - **A write based on a version that is no longer current is shown as
    concurrent,** not silently lost. A write from the Mac carries no
    version read, so it cannot be checked.
  - **Two writes that overlap,** each opened before the other was
    released, are flagged, but which one's content survived is not known
    (S162).
  - **A turn's record names the versions it read and wrote.**
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
  - A project without a `.gitignore` has its first derived output treated
    as source, until the agent adds one in a visible edit.
- **What goes:**
  - `lanes.install`, `installWhen` and `installCaches`;
  - dependency layers built by pine·trie, and the in-lane re-install;
  - reading `pinetrie.json` once at startup.
- **Risks:**
  - The supervisor sits on every file call's path.
  - setuid programs cannot gain privilege inside a tool call
    (`no_new_privs`). Lanes run as root; an image that relies on `sudo`
    would notice.
  - io_uring's opens bypass seccomp. Whether Docker blocks them was not
    checked.
- **Left open:**
  - where an agent reads a conflict's three versions (a read-only path
    outside the project, such as `/.pinetrie/conflicts/<path>/`);
  - states moving between machines. Between lane VMs, `btrfs send` (S146,
    S148) is where to start; the boundary with the Mac is a separate
    problem;
  - syncing your folder on the Mac with your thread (S149, S150, put
    aside).

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
- **Splitting `pinetrie.json` by authority.** The direction of a change
  decides authority for every setting, with no section to remember.
- **Following renames on every merge, as git does.** In 313 merges it
  invented a rename twice (S160).
