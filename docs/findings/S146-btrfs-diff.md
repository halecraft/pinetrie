# S146 — `btrfs send --no-data` diffs two snapshots of a lane in about 2 ms for a turn's change and reports deletions; `find-new` does not report them; a whole-disk stat walk costs about 100 ms at any size

- **Status:** Answered
- **Led to:** ADR-0129, ADR-0131

**Question.** Lanes kept a deleted package's `node_modules`, because the base
snapshot carries ignored files from refresh to refresh while jj manages only
tracked files. Should a lane's disk be identified by its content rather than by
a VCS's view of it? If so, what does it cost to learn what changed between two
snapshots of a lane, ignored files included?
1. How long do `btrfs send --no-data -p` and `btrfs subvolume find-new` take
   on a lane's disk, for no change, for a turn's change, and for a large one?
2. Does each one report a deletion?
3. What does the same diff cost in user space, without `CAP_SYS_ADMIN`?

**Kill criterion.** btrfs's own diff not reporting deletions, or costing more
than a user-space walk for a turn's change.

**Throw away.** The probe, `docs/findings/S146-btrfs-diff/run.sh`. It
is kept, with its output (`results.txt`), as the record of what ran. It runs
on the Mac against the lane VM's Docker, in one throwaway container from the
`pinetrie-disks` image, with `--cap-add SYS_ADMIN` and no network. Its changes
go into writable copies of read-only snapshots of a lane, never into the lane
itself.

## Answers

Measured on the lane VM: kernel 6.18.55, btrfs-progs 6.17.1. The disk was a
lane of pine·trie's own repo: 44,566 entries and 711 MB, `node_modules` and
the pnpm store included. Each time is a mean over repeated runs lasting 2 s,
from `/proc/uptime`. Busybox's `date +%N` gave no nanoseconds in the
container, so the first run read 0 everywhere.

1. **Times.**

   | diff | `send --no-data -p` | parsed by `receive --dump` | `find-new` |
   |---|---|---|---|
   | no change | 0.73 ms | 0.76 ms | — |
   | a turn's change: a package deleted, a file and a directory added (55 ops) | 2.3 ms | 2.7 ms | 0.71 ms |
   | `node_modules` removed (25,639 ops) | 618 ms | 650 ms | 2.9 ms |
   | the whole disk, no parent (278,193 ops) | 7.5 s | 7.3 s | — |

   A read-only snapshot of the lane plus its delete took 2.4 ms.

   `send` costs about 24 µs for each operation in the stream, so it grows
   with the size of the change, not of the disk. It is no way to list a
   whole disk.
2. **Deletions.** `send` reports them, and `find-new` does not. For the
   deleted `packages/vm`, the stream had 24 `unlink`s and 5 `rmdir`s.
   `find-new` listed only the two new files, and no line named
   `packages/vm`. `find-new` lists the inodes written after a generation,
   and a deleted path leaves none.

   The stream names a deleted path only through a rename. A deleted
   directory is first renamed to an orphan name
   (`rename ./b/packages/vm dest=./b/o2179-951-0`), and its files are
   unlinked under that name. A new file is made under an orphan name and
   then renamed into place. A reader has to resolve orphans to recover the
   paths.
3. **User space.** Measured in a lane on the same VM, with no added
   capability, by a Python walk of two snapshots of `/workspace`
   (`os.scandir`, comparing mode, size, mtime, ctime and inode). The walk
   took about 80 ms per tree warm and 200 ms cold, and the compare 7 ms. It
   found exactly the files changed. Walking only the new tree, against a
   manifest kept from the last walk, takes about 80 ms. The cost is the same
   whatever changed. sha256 of every file took 335 ms on 16 cores; of the
   tracked source alone, 11 ms. A snapshot from inside the lane took 16 to
   43 ms.

**What this means.** A turn's change costs 2 to 3 ms with `send` and about 80
ms with a user-space walk. `send` is the faster below about 3,000 operations,
and the walk is the faster above that: a `pnpm install` that rewrites
`node_modules` is above, where `send` took 618 ms against the walk's flat 80
ms. `send` needs `CAP_SYS_ADMIN` on the VM, and ADR-0103 gives a lane no added
capability: the search and send ioctls can read every subvolume on the
filesystem. So it would be a runtime disk operation (a `DiskOp`), run in a
throwaway container like the firewall's, and never in a lane. The walk needs
no capability and no btrfs. It runs in any lane, and under any runtime.
