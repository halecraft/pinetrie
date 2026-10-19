# S264 — btrfs is already behind lanehost's calls; three of its properties leak past them: a walk's diff trusts kept inodes, a merge's take needs a reflink, and a disk is a directory the runtime binds

- **Status:** Answered
- **Led to:** ADR-0202

**Question.** Lanes' disks are btrfs subvolumes (ADR-0130). Which other
store could keep them (APFS clones, ZFS, overlayfs, plain copies, cloud
volumes), and what would a port for the store look like, measured against
what lanehost's disks role does (`packages/lanehost/disks.ts`, `diff.ts`,
`folder.ts`, `answer.ts`)?

1. Where is btrfs named outside lanehost? The coupling survey of
   2026-10-19 counted 16 mentions in the host's own code.
2. Which of lanehost's calls hold for a store whose snapshots are not
   btrfs's, and which assume btrfs's semantics?
3. For each store named, which of those assumptions does it break?

**Kill criterion.** If btrfs's semantics are spread through the host and
the runtime's callers, a port inside lanehost is not enough, and the port
is `LaneRuntime`'s disk calls themselves (S288).

**Throw away.** The probe (`/tmp/probe/snapshots.ts`, `fields.ts`) and the
subvolumes it made under `/var/lib/pinetrie-lanes/probe`, deleted after.

## Answers

1. **btrfs is named nowhere outside lanehost, docker and the VM's image.**
   The survey's 16 came from a search whose later `--glob '*.ts'`
   overrode its `--glob '!*.test.ts'`, so it counted
   `host/folder/history.test.ts` (15). The host's code has one comment
   (`host/folder/history.ts`). Outside lanehost, btrfs is in
   `packages/docker/plan.ts` (the startup check of the lanes directory,
   `planDockerHost`: btrfs, with `user_subvol_rm_allowed`), the VM's init
   and manifest (`packages/vm/image/`), and the lane image's rootless
   Docker (`btrfs-progs`). The kill criterion does not hold.
2. **lanehost's calls name lanes and snapshots, never subvolumes**
   (`protocol.ts`: `create`, `restore`, `snapshot`, `delete`,
   `delete-snapshots`, `disk-exists`, `snapshot-exists`, `snapshots`,
   `diff`, `read`). Its disks are planned as `DiskStep`s (`parent`,
   `create`, `snapshot`, `drop`, `move`, `ensure`), and btrfs is in what
   carries them out:
   - `executeDiskSteps`, `drop`, `deleteSubvolume`, `subvolumesUnder`
     (`disks.ts`): `btrfs subvolume create|snapshot|delete`, `btrfs
     property set ro false`;
   - `isSubvolume` (inode 256), which answers `disk-exists`,
     `snapshot-exists` and the listing (`answer.ts`, `snapshotsIn`);
   - `diffBySend` and `send-stream.ts` (`btrfs send --no-data -p`);
   - `cloneTree` (`folder.ts`), a merge's take, by
     `COPYFILE_FICLONE_FORCE`.

   Three properties reach past those calls:
   - **A walk's diff trusts kept inodes and ctimes** (`compareTrees`,
     `walk.ts`): an unchanged entry has the same inode and times in both
     snapshots, as a CoW snapshot keeps them.
   - **A merge's take needs a reflink within one filesystem**
     (`FICLONE_FORCE`, no fallback).
   - **A disk is a directory on the runtime's machine,** which the runtime
     binds into the container: `packages/docker/plan.ts` builds the lane's,
     the nested disk's and the states directory's bind sources from
     lanehost's `projectDisks`. That is a contract between the store and
     the runtime, and nothing states it.

   A fourth is btrfs's alone, and contained: a nested lane's disk holds
   subvolumes (its inner Docker's data root, an inner lanehost's disks),
   so `drop` deletes them deepest first (S179).

**Measured** in this lane, whose `/workspace` and
`/var/lib/pinetrie-lanes` are the VM's btrfs (Linux 6.18.57, coreutils
9.7). A tree of 20,000 files in 200 directories, in a subvolume; for each
store, a snapshot of it, a lane made from the snapshot, one file of the
lane rewritten, a second snapshot, then `compareTrees(walkTree(s1),
walkTree(s2))`, lanehost's own walk:

| store | snapshot | lane made from it | walk's diff after one write |
|---|---|---|---|
| btrfs snapshot | 116 ms | 22 ms | 1 change |
| `cp -a --reflink=always` | 1,153 ms | 1,067 ms | 20,000 changes |
| `cp -a --reflink=never` | 1,505 ms | 1,572 ms | 20,000 changes |

Under both copies every file's inode and ctime differed (20,000 each);
its mode, size and mtime differed only for the one file written. Compared
by mode, size and mtime alone, both copies reported the 1 change.

`COPYFILE_FICLONE_FORCE` from the btrfs: into the same btrfs, done; into
tmpfs (`/dev/shm`) and into the container's overlay root, `EXDEV`.

3. **What each store breaks**, from the measurements, earlier spikes and
   source:

| store | snapshot and restore | walk's diff | merge's take | a directory the runtime binds |
|---|---|---|---|---|
| plain copies (any filesystem) | holds, in time linear in the tree: about 1.1–1.6 s for 20,000 files, and a lane with `node_modules` holds 44,566 entries (S146) | breaks: compare mode, size and mtime instead | breaks: copy instead | holds |
| reflink copies (XFS, btrfs without subvolumes) | as plain copies, with shared extents | breaks, as plain copies | holds within one filesystem | holds |
| ZFS | a dataset's snapshot is read-only and lives under it (`ds@snap`); a restore is `zfs clone`, which pins its snapshot until promoted, so `delete-snapshots` of a snapshot a lane came from fails | holds (CoW), or `zfs diff` with privilege | holds with block cloning (OpenZFS 2.2) | holds: a dataset mounts at a path |
| overlayfs | failed as lane disks: lower directories cannot be renamed, and a write copies a whole file up (S132) | — | — | a disk is a mount, not a directory |
| APFS clones | the Mac's alone; ADR-0034's lanes were ext4 volumes cloned with APFS, in a VM per lane, and the VM's kernel had no btrfs (S132) | — | — | a disk is a volume, not a directory |
| cloud volumes (EBS, a Kubernetes `VolumeSnapshot`) | a snapshot is asynchronous, a restore a new volume | changed blocks, not paths: a walk of both mounted | — | breaks: the runtime attaches a volume |

So **a port inside lanehost holds the stores that are directories on the
runtime's machine** (copies, reflinks, ZFS). It has to own three things
beside the steps: the diff (send, or a walk with the fields its snapshots
keep), a file's clone (reflink or copy), and whether a path is a disk.
**A store that is not a directory** (overlayfs, a volume per lane, cloud
volumes) moves a disk's mount into the runtime: a different port,
`LaneRuntime`'s, which no store we can foresee needs today.
