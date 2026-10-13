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
| `roles.ts` | `ROLES`, each role's grant; `moduleOf`, a call's module; `planRoles`, which role serves each module |
| `answer.ts` | one call answered by its module, refused when another role serves it |
| `server.ts` | a role's process: `answer` served over `@pinetrie/channel` |
| `once.ts` | one call answered and printed, for the suites |
| `serving.ts` | a server's arguments (`serverArgs`) and their reading (`servingFrom`) |
| `client.ts` | the host's side: one channel per role, each call routed and logged |
| `disks.ts` | subvolumes: each operation planned as `DiskStep`s, then executed |
| `projects.ts` | a project's root recorded, the listing, a project's removal |
| `grants.ts` | a project's grant of the Mac's ports in the lane VM's firewall |
| `diff.ts` | what differs between two snapshots: by `btrfs send`, or by a walk |
| `send-stream.ts` | btrfs's send stream read as one change per path, pure |
| `walk.ts` | two trees' entries compared, pure; and the walk that reads them |
| `lanehost.Containerfile` | a role's image: Alpine, `btrfs-progs`, `iptables` |
| `observer/` | the observer: its BPF program (`observe.bpf.c`), the kernel's structs it reads (`kernel.h`), the event both sides share (`observe.h`), the loader (`observe.c`), their Containerfile, and the suite's guest (`suite/`) |
| `observer.ts` | the machine role: the loader's lines and commands, and every decision of the role's, pure |
| `observer-server.ts` | the machine role's process: the loader held, each host's connection served |
| `observer-connect.ts` | one host's channel, joined to the role's socket |
| `observer-client.ts` | the host's side: one channel, a lane's notices gathered for its `RunSource` |

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
  - A run begins where an untagged task, in a cgroup a host registered,
    execs with `PINETRIE_RUN=<n>` in its environment, read by a
    `bpf_loop` over the strings. Its tag is the run and that cgroup, its
    lane; every task it starts takes it (`task_newtask`, which io_uring's
    workers pass too), whatever it execs or wherever it moves, and a
    tagged task never takes another.
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
  <inodes> <core's event line>`, and answers `register`, `unregister` and
  `flush` on stdin. It reads a lane's cgroup from its first process, and
  `lstat`s a file under the lane's remote directories through that
  process's root as its event is read: over virtiofs only a fresh stat
  reads the Mac's stamp. A path cut short, or a release it cannot name, is
  a loss. A flush drains the ring itself, after any command before it.
- **The role's decisions are `observer.ts`'s, pure:** where a notice goes
  (`routeEvent`), what a lane with no host may hold (`planHeld`), what its
  next host is sent first (`heldNotices`), when the role exits
  (`planIdle`, 60 s after its last connection), whether a remote release
  was raced (`isRaced`: its size or inode, never its ctime), how a host's
  lanes are observed (`planObserver`), and the role's version
  (`observerVersion`, a hash of its sources: its image's tag and its
  container's name).
- **A host gone keeps its lanes' runs:** their notices are held until a
  connection registers the lane again, as a host does after it restarts.
- **Under rootless Docker nothing can load it,** and a lane's own lanes
  share its cgroup (S175), so a host there refuses lanes.

## Calls name names, never paths

- **A project is named by its key, a disk by its name** (`isProjectKey`,
  `isDiskName`), and the server builds every path from them
  (`projectDisks`). A disk's name is one path segment, never `.` or `..`,
  and never ends in `.tmp`, which a snapshot in the making holds.
- **A carried path stays inside its disk:** relative, with no `.` or `..`.
- **A file read from a snapshot is pine·trie's own** (`.pinetrie-lane/<file>`,
  `readLaneFile`), and its real path must stay inside the snapshot. A
  snapshot does not change, so what was checked is what is read.

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
  first, since a read-only one is refused until then (S148); anything else,
  or a subvolume btrfs refuses, by `rm -rf`. An inner Docker makes
  subvolumes inside a nested lane's disk, and `rmdir` of an empty subvolume
  is a delete with `user_subvol_rm_allowed`.
- **A subvolume is told by its root's inode, 256** (`isSubvolume`):
  `btrfs subvolume show` needs `CAP_SYS_ADMIN` (S125).
- **A snapshot's time is its birth time** (`statx`), which btrfs keeps.

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
- **What the stream says, folded per path:**
  - a deleted directory is renamed to an orphan (`o<ino>-<gen>-<idx>`),
    its subdirectories to orphans of their own, then each entry unlinked
    under those names: each orphan is resolved through the one it sits in;
  - a new entry is made under an orphan, then renamed into place;
  - a renamed file is a `link` and an `unlink`;
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

- `server.test.ts`: the names and their refusals, `planDisk`'s steps, the
  roles, `readLaneFile` against a symlink out of its snapshot.
- `disks.test.ts`: the disks role against real btrfs, without privilege.
  It runs in a pine·trie lane, whose `/workspace` is the VM's btrfs, and
  skips, saying why, where its directory is not on btrfs.
- `client.test.ts`: one channel per role, reopened after it ends.
- `grants.test.ts`: `planGrant`'s input, and its refusals.
- `send-stream.test.ts`: S148's recorded streams (`fixtures/`), each kind
  of change, names with a newline and a space.
- `observer.test.ts`: the loader's lines, every decision of the machine
  role's, and its server against a stand-in loader
  (`fixtures/stand-in-observe.mjs`).
- The observer's kernel side and loader are checked by `e2e:observer`, in
  a QEMU guest on the lane VM's own kernel
  (`apps/pinetrie/e2e/TECHNICAL.md`).
- `walk.test.ts`: `compareTrees`. `disks.test.ts` walks S148's turn
  between two real snapshots, and checks it says what the stream says.
