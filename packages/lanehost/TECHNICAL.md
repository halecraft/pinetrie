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
- `walk.test.ts`: `compareTrees`. `disks.test.ts` walks S148's turn
  between two real snapshots, and checks it says what the stream says.
