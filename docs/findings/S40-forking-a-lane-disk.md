# S40 — forking a lane's whole disk, copy-on-write

- **Status:** Answered
- **Led to:** ADR-0034

S39 item 8 found that a VM's disk image clones with APFS `clonefile` in 50 ms.
The design that follows: a lane's whole working directory (tracked files,
dependencies, caches, build output) lives on its own disk image, and a fork
clones its parent's image. Nothing knows about pnpm, `.vite` or any language.
This probe asks whether that holds while lanes are running and writing, and
under load.

Machine and versions as S39. Every container was memory-capped (2 GiB for
lanes, 512 MiB–1 GiB for checks), at most three ran at once, and the host's
free memory stayed at 70–74% throughout.

**Answers.**

1. **A fork at a turn boundary is exact.** Lane A held this repo on its disk
   image: 19,107 files, 364 MB of `node_modules` in pnpm's normal layout, and
   a `.vite/vitest` cache; its suite ran in 3.6 s. At a turn boundary A
   hashed every file, ran `sync`, and its image was cloned while it kept
   running (489 ms, 1 MiB of disk). A then changed its cache, deleted a
   package and wrote a new file. Fork B, from the clone: all 20,194 files and
   links byte-identical to the turn boundary, none of A's later changes, and
   the suite passed on the inherited `node_modules` in 3.7 s.
2. **`container`'s volumes have no journal, and a clone taken mid-write is
   corrupt.** `dumpe2fs` on a volume: no `has_journal`, no `metadata_csum`;
   the guest mounts it "without journal". Eight clones taken at random moments
   while a writer ran, with no `sync` and no pause:
   - every record the writer had `fsync`ed before the clone was present and
     intact: what the guest flushes reaches the image file;
   - unsynced work (a renamed `state.json`, a re-extracted package tree) was
     absent from all eight;
   - `e2fsck -fn` failed on all eight: 308 blocks claimed by both the live
     log and a package binary deleted earlier, whose deletion never reached
     the disk. A fork would read log data as that binary.
3. **A journaled image makes every mid-write clone consistent.** The same
   eight-clone run on an image made with `mke2fs -t ext4` (journal and
   metadata checksums; 78 ms, 5 MB, cloned into a volume): each clone
   replayed its journal on mount ("recovery complete"), `e2fsck -fn` found
   nothing, every `fsync`ed record was present, `state.json` was always a
   whole version with a valid checksum, and the package tree was always
   complete. So a turn boundary needs no `sync` or freeze for consistency;
   `sync` only decides how recent the fork is.
4. **Snapshots are cheap to take and slow to delete.** 212 clones of an active
   lane's image in 60 s while the writer ran: median 266 ms, p95 540 ms, max
   589 ms. They added almost nothing beyond the lane's own growth. Deleting
   the 212 took 60 s, about 280 ms each.
5. **Depth costs nothing.** A chain of 20 forks, each cloning the last and
   writing about 5 MB: clone times flat from 526 to 586 ms, 170 MiB of disk for
   all 20, and the suite at depth 20 in 3.43 s against 3.49 s at depth 0.
   APFS clones are not chains: each shares blocks directly.
6. **Concurrent forks run near full speed.** Three lanes forked from one image
   ran the suite at once in 4.2 s each (3.4 s alone); host memory stayed at
   70% free; the three VMs then held 3.5 GiB.
7. **Only what a fork rewrites costs space.** A fork is 0 MiB; a fork that
   deleted and reinstalled all its dependencies added 401 MiB.
8. **A guest's deletes free host space only when trimmed.** Deleting 215 MB in
   the guest left the image at 1,098 MiB; `fstrim` is refused without
   `CAP_SYS_ADMIN`. With it, in a separate container on the stopped lane's
   volume, `fstrim` trimmed and the image fell to 869 MiB: the virtual disk
   passes discards to the host file.

## What this means for the design

- A lane is a disk image plus a container. A fork is a clone of the image at
  the fork point; nothing else is copied, installed or rewritten, whatever
  the project's language.
- Lane images must be journaled. `container volume create --opt
  journal=ordered` (or `writeback`, `journal`, with `:size`) makes one; the
  option is in `VolumesService.swift` at 1.4.1 but not in `--help`. The
  probe's own `mke2fs` template was not needed.
- Revision records can name an image snapshot beside the commit: "the files at
  entry E" becomes everything in the directory at E. A snapshot per turn is
  affordable (hundreds of milliseconds, shared blocks); deleting them is slow
  and belongs in the background.
- Trim a lane's image when it stops, in a separate short-lived container with
  `CAP_SYS_ADMIN`, so the agent's container never has it.
- Memory, not disk, bounds how many lanes run: about 1.2 GiB per busy lane
  here, freed when a lane stops (S39).

## Not measured

- Replacing a volume's `volume.img` is not an API of `container`; it worked
  for every clone here. At 1.4.1 a volume is `entity.json` (name, `source`
  path, format, size, options) and an image the create path formats once; the
  create and attach paths read no more of it than its path. The API's
  `Filesystem.block(format:source:…)` attaches any image file, but the CLI
  does not expose it. Volumes attach with the host cache on and `sync:
  .fsync`: a guest flush is an `fsync` of the image file.
- The source living on the image rather than as a jj workspace on the host:
  `jj` inside the guest (S39 item 5) would be the only snapshotter, and people
  would see a lane's files through revisions.
- A snapshot per turn over a long session: tens of thousands of clones, and
  APFS behaviour with them.
- Other languages' toolchains, by name; nothing here depended on Node except
  the suite used to check the fork worked.

## Method

`sandbox/s40/` in lane `t-01a0e616-…`'s workspace (ignored): `lib.sh`
(helpers, and a memory guard that stops at under 40% free), `writer.js` (an
`fsync`ed checksummed log, package-tree churn, rename-replaced `state.json`),
`verify.js`, `stress.sh <base volume> <lane> <label> [clones] [seconds]`
(clones at random 0.5–2 s intervals, then mounts and verifies each and runs
`e2fsck -fn` on its image), `journaled.img` (the template). The source was the
S39 workspace's files at `default@` (`962465c4`); dependencies from the S39
host-directory store. All volumes and containers were removed after.
