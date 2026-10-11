# ADR-0135 — A project's state is its source files, named by their git tree: a path's class comes from what wrote it, unless a file in the project declares otherwise; recipes are learned from what commands read; and jj is a codec that pine·trie writes commits through

- **Status:** Proposed (2026-10-11)
- **Area:** `packages/lanes/TECHNICAL.md`, `docs/the-jujutsu-repo.md`,
  `docs/01-architecture.md`
- **Evidence:** S146, S148, S155, S156, S157, S158, S159, S160
- **Amends:**
  - ADR-0131: a recipe is any recorded run of a command that made derived
    files, learned rather than declared (`lanes.install`, `installWhen` and
    `installCaches` go). pine·trie runs none itself; a disk made for a new
    state carries each output whose recipe's key still holds there.
  - ADR-0130: a change to `pinetrie.json` that widens what a lane may do or
    share takes effect only from accepted work; a lane's own copy can only
    narrow it.

**Context.** pine·trie names a state by a jj commit, and lets jj's ignore
rules decide which files are part of it. Four problems follow:
- **No state without a VCS.** A project without jj or git, or with no
  files yet, has no state at all.
- **The boundaries leak.** The class boundaries rest on rules any commit
  can override. A tracked file under `.plans` defeats the ignore (lucky-
  falcon's probe).
- **Recipes are declared, and declared inputs are incomplete.** ADR-0131's
  recipe is declared (`lanes.install`, `installWhen`), and its key misses
  inputs: every `package.json`, `.npmrc`, `~/.npmrc`.
- **Config is read once.** `pinetrie.json` is read once, at the host's
  startup, from your working copy (`prepareLanes`). So a lane whose state
  holds another version still gets the startup one.

Six spikes measured what a model built on the disk itself would rest on:
- **S155: classes by origin.** "A command wrote it, after reading source"
  marked exactly what git ignores, on 29,712 files across pine·trie,
  ripgrep and flask. Without a VCS, only a lockfile's first write, and
  what must stay local, needed someone's intent.
- **S156: naming states.** A hasher of git's tree format gives git's tree
  id on four repos, and updates it after a turn in 0.3–0.5 ms. A large
  file has to be chunked: rehashing a 4 GB blob takes 3 s. With content-
  defined chunks and FIEMAP, an edit in place costs 2–7 ms, plus up to
  46 ms of FIEMAP.
- **S157: recipes.** Every lockfile-only key misses inputs. A replay at the
  same path differs only in timestamps, and every lane is at `/workspace`.
- **S158: attribution.** A seccomp user-notification listener per tool
  call, needing no privilege, attributed all 24 files of a scenario
  correctly:
  - daemons, static binaries, `env -i` and parallel tool calls among
    them;
  - at 1.0–1.25× for opens (milliseconds on small commands).

  It also sees lookups of files that don't exist. Attributing by time loses
  work, because pi runs tool calls in parallel, and fsatrace crashes
  background processes.
- **S159: jj as a codec.** jj's snapshot gives the state's name once the
  codec writes the exclude file first. pine·trie can write a turn's commit
  in 4–5 ms and `jj git import` it in 10–88 ms, against 17–189 ms for
  `jj commit`. jj drops new files over 1 MiB with only a warning, and
  cannot take a gigabyte in a lane.
- **S160: merge.** A path-by-path merge agreed with jj on 99.8% of the
  paths both sides changed in 313 real merges. It needs a tree-level
  check, the mode as its own field, and renames offered as a guess.

**Decision.**
- **A state is the tree of its source files, named by its git tree id.**
  - The name is updated every turn from the turn's changed paths (S156).
  - Derived and local files are not part of it.
  - A file above a size threshold is stored as content-defined chunks
    (about 1 MiB each), and its entry names the list of them. The
    threshold is a constant set from a turn's time budget, tens of MB, not
    a setting. Which chunks an edit touched comes from FIEMAP.
  - Naming a large file that an app rewrote runs in the background. The
    turn's name is pending until it finishes, and a branch at that turn
    waits for it.
- **Every path is source, derived or local.** The first of these that
  answers decides:
  1. the classification file;
  2. what a VCS says, at import: tracked means source;
  3. origin;
  4. source.

  **Origin:**
  - A tool's write is source.
  - A command's write is source if it edited the file in place, or read no
    source.
  - Otherwise it is derived.

  A derived file a later command rewrites stays derived.
- **The classification file is a file in the project, and it is the only
  interface.**
  - Its lines are `pattern class`, sorted, where the class is `keep`,
    `derived` or `local`.
  - There is no tool to declare a class. The agent, a command and you all
    edit the file, and the UI is a view of it and an editor for it.
  - It is checked wherever it can change: at the end of a turn, at an
    import, and at a catch up. When a tool writes it, the check's errors
    go into that tool's result.
  - A file that does not parse only tightens: every path the last valid
    version called `local` stays local.
  - A change that makes a path shareable or droppable is shown in the
    turn's record. A `local` declaration must precede the first send.
- **Every tool call runs under a supervisor.**
  - The supervisor is a child subreaper. It installs a seccomp filter that
    sends each open, rename, unlink, mkdir, link and symlink to it, and
    every process the call starts inherits the filter.
  - A write is attributed to the call whose process tree made it, however
    and whenever that process runs. A write nothing attributes is source.
  - Stat and access calls are not watched, for their cost (up to 2.7×,
    S158). Directory listings on the path to each input stand in for them.
  - The supervisor's listener must never stop. If it does, its call hangs,
    and if its descriptor closes, its processes' file calls fail (S158).
  - `$HOME` is on the lane's disk.
- **A recipe is a recorded run, not a declaration.**
  - Any tool call that made derived files is one. pine·trie keeps its
    command, its image, the blob ids of the source it read, the lookups it
    made that found nothing, and `$HOME`'s configuration as a whole. Their
    hash is its key.
  - pine·trie never schedules a run.
  - When it makes a disk for a new state (a fork, the base, a catch up),
    it carries, by reflink, each output whose recipe's key holds on that
    state. It leaves out the others, for whoever works there to rebuild.
    An output left out stays in the snapshot it was made in.
- **What pine·trie knows about files is a fact of a state.**
  - A fact is a pure function of some paths, keyed by their blob ids, and
    computed again on each new state. Examples: the class map, the lane
    config, and whether a recipe's key holds.
  - No change pine·trie acts on reaches it except as a state. Shared
    directories stay outside every state (ADR-0035).
  - **Authority follows the direction of a change.** A lane can always
    narrow what it may do or share. Only accepted work widens it:
    - grants;
    - a class that becomes shareable or droppable;
    - any key with no order.

    The check's reply tells the agent which applies, and an offer's review
    lists the widenings it would make.
- **jj is a codec, used only by projects that have it.**
  - pine·trie writes each turn's commit itself: the blobs that changed,
    the trees above them, and the commit. jj imports it. The commit's tree
    is the state's name by construction.
  - jj's own snapshot, which runs when the agent or you use jj, is kept in
    line:
    - `.git/info/exclude` is generated from the derived and local sets,
      written before jj's first snapshot;
    - kept files in ignored places are tracked with `--include-ignored`;
    - a reclassified path is untracked;
    - `snapshot.max-new-file-size` is 0.
  - Each turn checks that jj's tree is the state's name.
  - At an import, a commit that tracks a path the class map calls local is
    reported, never settled silently.
  - A project without a VCS has the same states, with no codec.
- **A merge is pine·trie's own, path by path.**
  - A path changed on one side takes that side, and the same change on
    both sides is taken once.
  - The mode is merged as a field of its own.
  - Text is merged three ways (`git merge-file` or jj). Anything else is a
    conflict, kept as a value.
  - The result is checked as a tree, so that a directory and a file never
    meet at one path.
  - A rename inferred from the two diffs is offered as a resolution, never
    applied on its own.

**Consequences.**
- **Projects:**
  - A project without jj or git works, from its first file.
  - Nothing has to be configured. The classification file is needed only
    where intent differs from origin: a lockfile at its first write,
    generated code people keep, secrets in a project without a VCS.
- **What it costs:**
  - About 26 µs per watched file call. That is a few milliseconds on an
    everyday command, +0.3 s on a `pnpm install`, +0.9 s on a test run, and
    nothing measurable on builds (S158).
  - Naming a turn takes under a millisecond. A large file costs 2–50 ms
    when edited in place, and about a second per GB when rewritten, off the
    critical path (S156).
  - The first lane after a merge that changed a recipe's inputs pays one
    run of it: about a second for pnpm with its store warm.
- **What goes:**
  - `lanes.install`, `installWhen` and `installCaches`;
  - dependency layers built by pine·trie;
  - the in-lane re-install;
  - `commitTurn`'s `jj commit`;
  - reading `pinetrie.json` once at startup.
- **Grants:** a grant in a lane's `pinetrie.json` that widens takes effect
  only when its offer is accepted.
- **Risks:**
  - The supervisor sits on every file call's path.
  - setuid programs cannot gain privilege inside a tool call
    (`no_new_privs`). Lanes run as root; an image that relies on `sudo`
    would notice.
  - io_uring's opens bypass seccomp. Whether Docker blocks them was not
    checked.
- **Left open:**
  - how a file of a gigabyte reaches a git remote, as one blob or a
    pointer;
  - syncing your folder on the Mac with your thread (S149, S150, put
    aside);
  - the chunking threshold's exact value.

**Alternatives rejected.**
- **jj as the record of the state.** A project without jj would need a
  second model. jj also drops large files without saying so, and holds
  four times a file in memory (S159).
- **Naming a disk by its btrfs subvolume.** That names the disk, not its
  content.
- **A name over the whole disk, derived files included.** It costs 1.2 s
  on every turn that installs (S156).
- **Large files as single blobs.** Each edit rehashes and stores the whole
  file (S156).
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
- **A tool to declare a class.** Direct edits to the file have to work
  anyway, so the file has to be the interface.
- **Splitting `pinetrie.json` by authority.** The direction of a change
  decides authority for every key, with no section to remember.
- **Following renames on every merge, as git does.** In 313 merges it
  invented a rename twice (S160).
