# `@pinetrie/lanehost`: technical notes

Everything the host asks of the machine its lanes' disks are on, outside a
lane (ADR-0129): one protocol, one server, one client, and a module per
responsibility. It declares `@pinetrie/core` and `@pinetrie/channel` only
(`workspace.test.ts`), and knows nothing of lanes or Docker: the runtime
(`@pinetrie/docker`) makes each role's container and opens its channel.

## Where things are

| file | owns |
|---|---|
| `protocol.ts` | `LanehostCall` and each call's result (`LanehostResults`) |
| `layout.ts` | where a project's disks are (`projectDisks`), and which names may stand for a project or a disk |
| `roles.ts` | `ROLES`, each role's grant; `callModule`, a call's module; `planRoles`, which role serves each module |
| `answer.ts` | one call answered by its module, refused when another role serves it |
| `server.ts` | a role's process: `answer` served over `@pinetrie/channel` |
| `once.ts` | one call answered and printed, for the suites |
| `serving.ts` | a server's arguments (`serverArgs`) and their reading (`servingFrom`) |
| `client.ts` | the host's side: one channel per role, each call routed and logged |
| `disks.ts` | subvolumes: each operation planned as `DiskStep`s, then executed; a file read from a snapshot |
| `folder.ts` | a folder project's merges: path facts, alike content, a merge's steps applied, a lane's states directory; a read of the project's folder into its line (`readIn`) |
| `projects.ts` | a project's root recorded, the listing, a project's removal |
| `grants.ts` | a project's grant of the Mac's ports in the lane VM's firewall |
| `diff.ts` | what differs between two snapshots: by `btrfs send`, or by a walk |
| `send-stream.ts` | btrfs's send stream read as one change per path, pure |
| `walk.ts` | two trees' entries compared, pure; and the walk that reads them; an entry's kind (`statKind`) |
| `lanehost.Containerfile` | a role's image: Alpine, `btrfs-progs`, `git`, `iptables` |
| `observer/` | the observer: its BPF program (`observe.bpf.c`), the kernel's structs it reads (`kernel.h`), the event both sides share (`observe.h`), the loader (`observe.c`), their Containerfile, and the suite's guest (`suite/`) |
| `observer.ts` | the machine role: the loader's lines and commands, and every decision of the role's, pure |
| `observer-server.ts` | the machine role's process: the loader held, each host's connection served |
| `observer-connect.ts` | one host's channel, joined to the role's socket |
| `observer-client.ts` | the host's side: one channel, a lane's runs folded as their notices arrive, for its `RunSource` |
| `gathered.ts` | what the host holds of a lane's runs between drains, and when a batch of notices is folded, pure |

## Roles

- **A role is one process of the server, holding one grant,** in a
  container of its own (`ROLES`). A new capability is a module and a row,
  never another kind of container.
  - `disks`: the lanes directory read-write, Docker's default capabilities
    (it chowns a nested lane's inner disk to the rootless user, and deletes
    files of that user's), no network. It creates, snapshots and deletes
    subvolumes on a filesystem mounted with `user_subvol_rm_allowed`
    (S122, S125, S148).
  - `privileged`: the lanes directory read-only, every capability dropped
    but `NET_ADMIN`, `NET_RAW` and `SYS_ADMIN`, the host's network.
- **`planRoles(facts)` decides which role serves each module,** from what
  the machine grants: `facts.rootless` says Docker is rootless (a nested
  lane's), where no capability reaches the host's user namespace (S148).
- **A call of a module another role serves is refused** (`answer`), so a
  role's process never does another role's work, whatever it is sent.

## The machine role (`observer*.ts`, `observer/`)

The observer that attributes a lane's file calls to its runs (ADR-0135).
It belongs to the machine, not to a project: one container serves every
host, whatever their projects.

- **The kernel side decides only which task is in which run**
  (`observe.bpf.c`):
  - A run begins where an untagged task, in a PID namespace a host
    registered, execs with `PINETRIE_RUN=<n>` in its environment, read by
    a `bpf_loop` over the strings. Its tag is the run and that namespace,
    its lane; every task it starts takes it (`task_newtask`, which
    io_uring's workers pass too), whatever it execs, wherever it moves or
    whatever namespace it enters, and a tagged task never takes another.
  - A task's namespace is `thread_pid`'s `numbers[level].ns`, its inode
    the lane. `numbers` is a flexible array: its stride is the running
    kernel's `struct upid` (`bpf_core_type_size`), never `kernel.h`'s,
    which declares only the field it reads.
  - A path is walked from its dentry through each mount to the task's
    root, in a `bpf_loop` callback: as an inline loop its branches pass
    the verifier's limit.
  - What was at a path before is read in the kernel: an open's from
    `FMODE_CREATED`, a path call's from its dentry's inode. An open whose
    lookup finds nothing never reaches `security_file_open`: it is seen at
    `do_filp_open`'s return, its name joined to the caller's directory.
  - A run ends when its last task has exited and its last written file
    been let go of (`live` counts both): an exit releases its files after
    its tracepoint.
  - Nothing is lost silently: an event the ring has no room for, a task or
    a written file the maps cannot hold, is counted against its run. An
    end is never lost: `ended` keeps it for the next flush.
  - Its types are `kernel.h`'s, relocated by name from the running
    kernel's BTF (CO-RE), so it needs no `vmlinux.h`: Linux 5.17 or later
    (`bpf_loop`), with BTF and kprobes. No fentry: the VM's kernel has no
    `FUNCTION_TRACER`.
- **The loader holds no decision** (`observe.c`, static, the BPF object in
  its skeleton): it drains the ring to stdout as `ev <lane> <run>
  <inodes> <core's event line>`, gathers facts, and carries out commands.
  - `open` and `find` gather candidates: a process by its pid, or every
    process whose pid at a namespace level is the one given, each with its
    `NSpid` and its namespace's chain of parents by `NS_GET_PARENT` (which
    refuses above the loader's own namespace, so the chain ends there).
    Status and namespace are read through one `/proc/<pid>` directory, so
    a pid reused between them cannot mix two processes.
  - A candidate's namespace is held open from its lookup until `install`
    or `drop`, and a lane's until `unregister`: what was checked is what is
    registered, and its inode names no other namespace while held. Each
    holds a descriptor, so the loader raises its limit to the hard one.
  - `install` makes a lane of a candidate, or refreshes the lane its
    namespace is already: the kernel's map entry first, for a new lane,
    so a refusal leaves nothing behind. `unregister` deletes both.
  - It `lstat`s a file under the lane's remote directories through its
    first process's root as its event is read: over virtiofs only a fresh
    stat reads the Mac's stamp. A path cut short, or a release it cannot
    name, is a loss. A flush drains the ring itself, after any command
    before it.
- **The role's decisions are `observer.ts`'s, pure:** where a notice goes
  (`routeEvent`), what a lane with no host may hold (`planHeld`), what its
  next host is sent first (`heldNotices`), when the role exits
  (`planIdle`, 60 s after its last connection), whether a remote release
  was raced (`isRaced`: its size or inode, never its ctime), how a host's
  lanes are observed (`planObserver`), and the role's version
  (`observerVersion`, a hash of its sources: its image's tag and its
  container's name). Registration is gathered, planned, then executed:
  `planLookup` says which candidates to gather, `planRegister` which one
  to install, or why none.
- **A registration names its origin; a connection never implies one.**
  - Direct: the lane's first pid in the machine's namespace, from a host
    whose Docker is the machine's. The candidate must be below the
    observer's own namespace: a lane's container never shares it
    (`renderRun` sets no `PidMode`).
  - Forwarded: the pid as the `forwarding` lane sees it, and `within`, the
    lane whose host relayed it, which that host sets whatever the call
    said (`relayedCall`). Both must be registered, `forwarding` being
    `within` or below it. The one candidate in `forwarding`'s namespace at
    its level with that pid is taken (`translatedCandidate`), none or
    several refused, and only in a namespace strictly below `forwarding`
    (`isStrictDescendant`): never it, a sibling or an unrelated one.
- **A registration belongs to its connection** (`planOwnership`): one
  nobody holds is installed; its live owner refreshes its first pid and
  remote directories, by the same origin; one whose connection closed is
  reclaimed by whoever registers it next. Another live connection's is
  refused, whatever the origins. Only its owner unregisters it
  (`planUnregister`). Registrations are planned one at a time, so two
  cannot both install one namespace.
- **A host gone keeps its lanes' runs:** a connection's end leaves its
  lanes registered and pinned, their notices held until a connection
  reclaims them, as a host does after it restarts, one unregisters them,
  or the role exits idle. The held-notice bound turns excess into losses;
  it removes nothing. A connection's end is taken at its input's end,
  before the host sees its side close, and a host waits for its old
  channel to close before opening the next, so its reclaim never finds
  its own old connection live.
- **A host keeps notices that come before its registration's answer**
  (`observer-client.ts`): the role sends a reclaimed lane's held notices
  as it registers it, before the answer names the namespace, so a notice
  of a namespace no lane holds yet waits for the lane that registers it.
  - The lane then takes them **after** what it already holds: they are
    what the role held since the lane's last channel closed.
  - Each waiting notice is pushed onto its namespace's list in place, and
    each notice finds its lane by a map of namespaces. The role sends up
    to `HELD_PER_LANE` (100,000) on a reclaim, so a copy per notice would
    be quadratic.
- **A host holds a lane's runs folded, never its notices**
  (`observer-client.ts`, `gathered.ts`, ADR-0145).
  - The client is given a fold (`FoldNotices`, core), a step over a batch.
    The host supplies `@pinetrie/rules`' (`laneFold`), and lanehost
    imports no rules.
  - **What it holds per lane:** the traces, in `gathered.ts`'s state, a
    value; and one batch of notices not folded yet, which the client alone
    writes. Held notices grew the host's heap 4.66 MB/s under `pnpm
    mutate`, which killed it at 4 GB (S191).
  - **When a batch is folded:** once it holds `max(MIN_BATCH, size)`
    notices, `size` being what the traces hold. A fold copies the traces it
    touches, so each notice costs constant work on average. A fold per
    notice would be quadratic.
  - **A batch handed to the fold is replaced, never emptied in place:**
    the array is the fold's from then.
  - **A drain is the source's own** (`RunSource.drain`):
    1. it flushes, so every notice before it is folded into what the
       drain's callback is given;
    2. nothing is folded while the callback runs, and what arrives waits
       in the batch;
    3. after the callback, the client reads the lane's state afresh, since
       notices kept arriving, and folds that batch onto what the callback
       returned. A callback that threw leaves the traces it was given.

    Drains run one after another, in call order.
- **A connection waits up to 15 s for the role's socket** (`observer-connect.ts`):
  a role's container just made makes it once Node has started, some
  hundreds of ms after `docker run` returns.
- **A host inside a lane is served through the lane's helper**
  (`packages/pi/TECHNICAL.md`), relayed by the host outside it: each
  connection it opens is a connection of its own to the role (the lane
  observation's `relay`, `observer-client.ts`), so the role owns and
  routes the inner host's lanes by it. Its notices go only to it.
- **Under rootless Docker nothing can load it:** a host there is observed
  through its lane's helper when the socket is there (`planObserver`),
  and refuses lanes when it is not.

## Calls name names, never paths

- **A project is named by its key, a disk by its name** (`isProjectKey`,
  `isDiskName`), and the server builds every path from them
  (`projectDisks`). A disk's name is one path segment, never `.` or `..`,
  and never ends in `.tmp`, which a snapshot in the making holds.
- **A carried path stays inside its disk:** relative, with no `.` or `..`.
- **A file is read from a snapshot by its path** (`read`,
  `readSnapshotFile`): pine·trie's own (`.pinetrie-lane/base.json`, the
  runtime's `readLaneFile`) or any project file. Its real path must stay
  inside the snapshot, and it holds at most the call's `limit` bytes. A
  snapshot does not change, so what was checked is what is read.
- **A disk's name is core's** (`isDiskName`): a folder state's id is a
  snapshot's name, and core decides which ids may be one.

## Disks (`disks.ts`)

- **Each operation is planned, then executed:** `planDisk` returns
  `DiskStep`s, pure; `executeDiskSteps` carries them out, running `btrfs`
  with no shell (`runCommand`).
- **Snapshots are read-only,** as `btrfs send` needs (S146). A restore is a
  writable snapshot of one; a delete makes one writable first.
- **A snapshot is made at `<id>.tmp`, then moved into place,** after the
  old one is dropped, so a snapshot read is never half-made: the base's is
  replaced at each refresh. A move over an existing snapshot fails
  (ENOTEMPTY, S148), so the order is drop, then move.
- **A drop deletes whatever is there:** a subvolume by btrfs, made writable
  first, since a read-only one is refused until then (S148); anything else
  by `rm -rf`. A nested lane's disk holds subvolumes (its inner Docker's
  data root, an inner lanehost's lanes and snapshots), and `rmdir` of an
  empty subvolume is a delete with `user_subvol_rm_allowed`.
- **A subvolume that holds others is refused whole, and `rm -rf` stops at
  a read-only one** (EROFS, S179): an inner lanehost's snapshots in a
  nested disk, or a subvolume an agent made in its lane. So where the
  first delete fails, `drop` finds the subvolumes under the path, by inode
  256, through no symlink and across device changes (each subvolume is a
  device of its own), and deletes them deepest first
  (`subvolumesDeepestFirst`), each made writable, before the path itself.
  The search keeps only directories that are subvolumes: a nested disk
  holds an inner Docker's data root, and the role has 256 MB.
  `btrfs subvolume delete --recursive` would do it in one call, but needs
  `CAP_SYS_ADMIN` to search the tree (S179).
- **A subvolume inside a lane is an empty directory in that lane's
  snapshots:** a snapshot stops at a subvolume's edge, so a restore does not
  bring one back.
- **A subvolume is told by its root's inode, 256** (`isSubvolume`):
  `btrfs subvolume show` needs `CAP_SYS_ADMIN` (S125).
- **A nested lane's disk holds its inner Docker's data root as a subvolume
  of its own** (`INNER_DOCKER_DATA_ROOT_DIR`, `docker`), so it is cloned
  without the inner lanehost's `projects/` beside it (ADR-0169). The
  `nestedDisk` call makes the nested disk the rootless user's, then the
  data root (`planInnerDockerDataRootSteps`, from facts gathered first):
  - a lane named to clone from whose data root is a subvolume: the lane's
    own dropped, then a writable snapshot of that one, which keeps its
    owner (S233);
  - otherwise, a source gone included, the lane's own as it is, made a
    subvolume owned by the rootless user when it is not one: a plain
    `docker/` from before is dropped, its images with it.

  A lane is never its own source: its data root would be dropped first.

## A folder project's merges (`folder.ts`)

`@pinetrie/folder` decides a merge (ADR-0142); the disks role carries it
out, every call checked and planned into paths first (`planApply`,
`planStates`), then executed.

- **`pathFacts`** answers what a snapshot holds at each path: absent, a
  directory, a symlink and its target, a file with its executable bit
  (the owner's), its size, and what it holds (`content`, core's
  `fileContent` over the first 8,000 bytes: text where no NUL is among
  them, as git decides (S181), else an image by its magic bytes, else
  binary; an SVG is text); its kind from the `lstat` the walk reads
  (`statKind`). A path under a symlink is absent.
- **`sameContent`** answers the pairs of paths, one in each snapshot,
  whose files hold the same bytes: a path with itself for a merge, a path
  gone with a path added for a move. Sizes first, then a read of both.
  Shared extents (FIEMAP) would prove a clone alike without a read (S183),
  but Node has no ioctl and only pairs of one size are asked, so it reads.
- **`applyMerge`** applies a merge's steps to a disk: a lane's, or a
  virtual base's scratch disk (the host restores it, merges into it with
  `markers`, and snapshots it as the virtual base's name).
  - **A `take` clones** theirs' file by reflink (`COPYFILE_FICLONE_FORCE`),
    a symlink made again, a directory whole; staged under
    `.pinetrie-lane/merge/` on the disk, then renamed over what is there,
    so the disk never holds half a file. The staging directory goes after,
    and `.pinetrie-lane` too when the merge made it.
  - **A `text` step runs `git merge-file`** on a staged copy of ours, the
    base (empty when there is none) and theirs, labelled `ours`, `base`
    and `theirs`, and answers it clean or conflicted. A conflicted result
    is kept only with `markers` (a virtual base); otherwise ours stays.
  - **Nothing is written that the disk holds:** a text result is renamed
    into place only when its bytes differ from ours, so the disk's diff
    against ours names exactly what the merge changed (S183).
  - **Nothing is read or written under a symlink,** on the disk or in a
    snapshot: a lane controls both, and a symlinked directory could lead
    out of either. The check is made just before each write.
- **A lane's states directory,** `<project>/states/<lane>/`, which its
  container will see read-only (S186): `start`, a read-only snapshot
  `start-<state>` with a `start` symlink renamed over the last, so a
  running lane reads one or the other, and the copies it no longer names
  deleted; each conflict's versions cloned to
  `conflicts/<path>/{base,ours,theirs}` (an absent one has none);
  `resolved` removes a path's versions and its emptied directories. A
  lane's `delete` disk operation drops it, and a project's removal takes
  its whole directory.
- **A read of the project's folder into its line** (`readIn`, S185): the
  host scans the project's folder and names each path to copy with the stamp it read (size and
  ctime, which the lane VM reads alike, S169); the disks role makes the
  `folder-line` disk (`FOLDER_LINE`) from accepted work's newest state, or
  empty, removes the deleted paths and the directories they leave empty,
  copies each path from the project's root, mounted read-only in its
  container at `FOLDER_MOUNT` (a file by `copyFile`, which keeps its
  mode; a symlink made again; a file or link where a directory now stands
  replaced), and snapshots the disk as the new state. Each path's stamp is
  checked before and after its copy, and one that moved, or now under a
  symlink in the project's folder, makes no state: the call answers the moved paths
  and the host reads again (S149 rule 4). The disk is dropped either way.
  Where the root is mounted is a `Serving` fact (`servingFrom`'s
  `folder`), so a test serves a folder of its own (`fixtures.ts`'
  `disksInProcess`).
- **What a folder project reads of its states:** `filesUnder` (the files
  and links at or under each path: a diff names a directory made or
  renamed by its path alone), `fileDiff` (one file's unified diff, `git diff
  --no-index` of the two snapshots, its paths from the disk's root as jj's
  `--git` prints them, cut one byte past its limit) and `diffStats` (lines
  added and removed per path, a binary 0 and 0). `statesDir` makes a
  lane's states directory before its container mounts it; a project's
  removal drops each states directory, whose read-only copies a plain
  removal cannot delete.
- **git is in the image** for `git merge-file` (S181), so the image's tag,
  a hash of its Containerfile, moved with it. So is GNU tar, for an
  accept's stream.
- **An accept's files are a stream, never a call** (`tar-out.ts`): a
  command of the disks role's own, run by `docker exec` beside the server,
  its paths NUL-separated on stdin (a list can be longer than a command
  line holds), its stdout a pax tar of each path alone. Every path is
  checked first to be a regular file inside the snapshot with no symlink
  on its way, and a refused one exits before tar writes a byte: a lane
  controls the names in its state. Only regular files travel; an accept
  makes a symlink from its target.
- **A review's file is a stream too** (`file-out.ts`): one regular file of
  a snapshot, its path on stdin, its bytes on stdout, its path checked by
  the same `checkOutPaths` as `tar-out.ts`'s, never a copy of it.
- **One listing names every snapshot** (`snapshots`, `snapshotsIn`): each
  subvolume under the project's snapshots directory with a disk's name,
  so one in the making (`.tmp`) is none yet. What the host keeps is
  decided from it, never from a check of each state.
- **A read can copy from another path** (`ReadPath`'s `source`): a kept
  aside read into a concurrent save at its own path, `source` checked
  inside the project's folder as `path` is.

## Diffs (`diff.ts`)

- **A diff is `btrfs send --no-data -p`'s where the role's `SYS_ADMIN`
  reaches the host's user namespace:** about 2 ms for a turn's change, 618
  ms for `node_modules` removed, about 24 µs an operation (S146). It runs
  in the privileged role, from the lanes directory mounted read-only, and a
  killed one leaves nothing behind (S148).
- **Under rootless Docker, a walk of both trees** (`walk.ts`), in the
  disks role: `send` cannot run there (S148). About 80 ms for a lane of
  44,566 entries, whatever changed (S146). `planRoles` decides which, from
  `docker info`'s `name=rootless`.
- **The stream is read as bytes** (`send-stream.ts`), never as
  `receive --dump`'s text, which writes a newline in a name as `\n`: a
  lane controls its file names.
- **The stream is folded as it arrives, never held** (`diff.ts`,
  `streamCommand`): `sendReader` keeps only the command a chunk ends
  inside, and `sendFold` takes each command as it comes. A `pnpm install`
  of 42,631 entries is a 43 MB stream of 276k commands: held whole, with
  its command list, it is more than the privileged role's 256 MB, which the
  kernel then kills, and with it every lane's next diff (S179). The
  changes themselves are about 17 MB.
- **The fold is linear in the stream:** a new directory is filled under its
  orphan name and renamed into place, and what is under it moves with it.
  `sendFold` keeps the changed paths under each orphan name, so a rename
  moves only those. A scan of every change at each rename took 39 s on that
  stream, with the role's one thread blocked, and every lane's turn behind
  it (S179). A test counts its collection steps over 1,000 new directories
  (`collectionSteps`).
- **What the stream says, folded per path:**
  - a deleted directory is renamed to an orphan (`o<ino>-<gen>-<idx>`),
    its subdirectories to orphans of their own, then each entry unlinked
    under those names: each orphan is resolved through the one it sits in;
  - a new entry is made under an orphan, then renamed into place;
  - a renamed file is a `link` and an `unlink`;
  - an entry replaced by another is moved aside to an orphan when the
    parent's entry has the higher inode, as it does with the parent the
    newer snapshot (a restore's preview) or from another disk's line (a
    lane's tip against a shown merge): the new entry is renamed into its
    path, then the old unlinked under the orphan. An add then a delete at
    one path is so a change, never nothing: the stream never deletes an
    entry it made (S228);
  - a retargeted symlink is an `unlink` and a new `symlink` at one path,
    folded to one change;
  - a write, a truncate, a clone, a mode, an owner or an xattr is a
    change; times alone (`utimes`) are none, as a walk counts none for a
    directory.
- **A renamed directory is its old path deleted and its new one added,**
  the directory alone: what is under it moved with it, and the stream
  names none of it.
- **The walk compares mode, size, times and inode** (`compareTrees`): a
  snapshot keeps each unchanged entry's inode and times. A directory is
  changed only by its mode.
- **A timeout of 120 s** guards against a runaway lane; it is no switch to
  the walk.

## Grants (`grants.ts`, S136)

- **A project's grant is gathered, planned and applied at once:** the rules
  in `DOCKER-USER` now (`iptables -S`), one `iptables-restore --noflush`
  input from them (`planGrant`, pure), applied in one call. The chain is
  declared and flushed, the project's stale jumps deleted, each port
  accepted only from the project's network to the host's address over TCP,
  and one jump added; with no ports, the chain goes too.
- **Every value is checked before it is written into a rule:** the key,
  the subnet as a CIDR, the address, the ports.
- **The privileged role runs it,** on the VM's own network with
  `NET_ADMIN`. On Linux the grant applies to nothing, and the host never
  asks for one.

## The client (`client.ts`)

- **One channel per role, opened at its first call** (`open`, the
  runtime's): a message on a held channel, not a `docker exec` per call
  (S147). A channel that ends is opened again at the next call; a
  failed open is tried again then too. `reset` closes them all.
- **Each call is one line in the host's log:** its role, its kind, its time
  and whether it failed.

## Tests

- `server.test.ts`: the names and their refusals, `planDisk`'s steps,
  `subvolumesDeepestFirst`, the roles, `readSnapshotFile` against a
  symlink out of its snapshot and past its limit.
- `folder.test.ts`: a folder project's merges against real btrfs, as
  `disks.test.ts` runs: text merges clean, conflicted and with markers, a
  take, a delete and a mode, and the disk's diff naming exactly those; a
  virtual base for a criss-cross; path facts; alike content; a lane's
  states directory; a write through a symlinked directory refused.
- `disks.test.ts`: the disks role against real btrfs, without privilege,
  a delete of disks holding read-only subvolumes among it. It runs in a
  pine·trie lane, whose `/workspace` is the VM's btrfs, and skips, saying
  why, where its directory is not on btrfs.
- `client.test.ts`: one channel per role, reopened after it ends.
- `grants.test.ts`: `planGrant`'s input, and its refusals.
- `send-stream.test.ts`: S148's recorded streams (`fixtures/`), each kind
  of change, names with a newline and a space; the recorded stream fed in
  pieces, cut at every byte, folds as the whole; a stream cut short throws
  at its end; 1,000 new directories fold in a bounded number of steps per
  command.
- `observer.test.ts`: the loader's lines, every decision of the machine
  role's, and its server against a stand-in loader
  (`fixtures/stand-in-observe.mjs`).
- The observer's kernel side and loader are checked by `e2e:observer`, in
  a QEMU guest on the lane VM's own kernel
  (`apps/pinetrie/e2e/TECHNICAL.md`).
- `walk.test.ts`: `compareTrees`. `disks.test.ts` walks S148's turn
  between two real snapshots, and checks it says what the stream says.
