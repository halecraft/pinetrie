# S179 — A `pnpm install` turn's diff takes 39 s and about 600 MB to fold, so lanehost's privileged role stalls every lane and is killed at its 256 MB limit; one path through a symlink fails a turn's `check-ignore`; and dropping a nested lane's disk fails on its read-only inner snapshots

- **Status:** Answered
- **Led to:** ADR-0129, ADR-0135, ADR-0145

**Question.** On 2026-10-13 the Mac's host showed two errors. One was
`classing the turn's writes failed: git check-ignore failed: fatal:
pathspec 'node_modules/.pnpm/@vitest+utils@3.2.4/node_modules/loupe/lib/package.json'
is beyond a symbolic link`. The other came after archiving a thread:
`a move-task command failed: EROFS: read-only file system, rmdir
'…/nested/t-01a133b7-…/projects/2ef274bf69a9f9cc/snapshots/base/.git'`.
A thread opened to study them could not finish. Its first `sed` after a
turn did not answer for minutes, until it was cancelled. What stalled the
lanes, and what causes each error?

**Kill criterion.** Every cause named here must be reproduced or measured,
not inferred. A cause no measurement shows is stated as open.

**Throw away.** The 43 MB recorded stream and the copies of the host's
database. Kept in `docs/findings/S179-lane-stall-oom/`:
- `fold.ts`: the fold of a recorded stream, timed, with its peak memory.
  It calls `readSendStream` and `foldSendStream`, the fold before this
  spike's fix, which replaced them;
- `unattributed.ts`: `unattributed` over a turn that wrote every path its diff names;
- `subvolumes.sh`: the nested-disk drop, run in a privileged Alpine container.

## Answers

Measured on 2026-10-13 from four sources: the lane VM's `dmesg` and its
btrfs subvolumes' birth times (`btrfs subvolume list -s`), the host's
database (`.pinetrie/pinetrie.db`, read from a copy), and runs on the Mac
(Apple M3 Max, Node 24.19). The VM's wall clock at each `dmesg` line is its
boot time plus the line's uptime. The boot time was taken from `date -u` and
`/proc/uptime` read together.

1. **The stall: one turn's diff blocked lanehost's privileged role, which
   every lane's diff goes through.**
   - jaunty-zephyr's lane went from 1,964 entries (snapshot at 18:17:11Z)
     to 44,595 (at 18:17:26Z): a `pnpm install` in one turn.
   - After 18:17:26 no lane made a snapshot until 18:19:53. That covers
     ideal-pond: its prompt came at 18:18:48, and its lane's disk was made
     at 18:19:53.
   - At 18:19:53 the kernel killed the privileged role's Node
     (`Memory cgroup out of memory: Killed process … (MainThread)`,
     anon-rss 257 MB, its container's limit 256 MB). In the same second,
     jaunty-zephyr's next snapshot, sweet-willow's, and ideal-pond's lane
     disk were made.
   - Each lane's turn is one queued step: its commit, classes, snapshot and
     diff. The next tool call waits for that step
     (`apps/pinetrie/host/TECHNICAL.md`, "A turn's end is one queued step").
     So a diff that takes minutes stops every lane's next tool call.
   - The same role was killed the same way earlier, at about 17:13:42Z, in
     its previous container. What diff it was serving then is not known.

2. **The fold slows down with the square of the number of new entries.**
   - The diff between the two jaunty-zephyr snapshots
     (`btrfs send -q --no-data -p`) took 1.5 s in the VM. Its stream is
     42,790,028 bytes and 275,946 commands, which fold to 42,631 changes.
   - On the Mac, `fold.ts` read the stream in 60 ms. **The fold took
     38.9 s, with a peak RSS of 615 MB.** The result is a 7.5 MB line.
   - The cost is `moveUnder` (`packages/lanehost/send-stream.ts`):
     - btrfs makes each new directory under an orphan name, then renames it
       into place;
     - each such rename copies and scans the whole map of changes found so
       far.
   - With that scan replaced by an index of the entries under each orphan
     name, the fold took 145 ms. Its output was byte-identical to the
     original's on this stream, and `send-stream.test.ts` passed.
   - A deleted `node_modules` does not hit this path: deletions go through
     orphans and unlinks, no rename of a made entry (S146 measured 618 ms
     for one).

3. **A fast fold alone still does not fit in 256 MB.**
   - Bytes in a Node script, with the fast fold and a 64 MB heap: the read
     stream took 125 MB of RSS, and the parsed command list 221 MB (79 MB
     of heap).
   - The changes alone, once the stream and the commands were collected,
     were 17 MB of heap.
   - `diffBySend` holds more than the script does. `runCommand` buffers all
     of stdout, `execFile` concatenates the chunks, and `new Uint8Array(…)`
     copies the result: three copies of 43 MB, before the command list is
     built.

4. **The host's own check of the diff is quadratic too, on the host's main
   thread.**
   - `unattributed` (`packages/rules/disk.ts`) scans every written path
     for every path in the diff.
   - With the 42,631 changes, all written by the turn's runs, as a
     `pnpm install` does: **44.4 s** (`unattributed.ts`).
   - With no writes: 7 ms.
   - In the stall, jaunty-zephyr's diff never reached it, because the role
     was killed first. Once the fold is fast, this becomes the next stall:
     the host's whole event loop, not one role.

5. **`git check-ignore` fails a whole batch on one path through a
   symlink.**
   - Probed in a fresh repo: `printf 'a.log\0link/x/p.json\0' |
     git check-ignore --no-index -z --stdin` prints `a.log`, then `fatal:
     pathspec 'link/x/p.json' is beyond a symbolic link`, and exits 128.
   - `checkIgnored` (`apps/pinetrie/host/work/disk.ts`) takes any code but
     0 or 1 as a failure, so the whole turn's classes are lost.
   - Under pnpm, `node_modules/.pnpm/<pkg>/node_modules/<dep>` is a
     symlink.
   - From source, not run: the observer reports a lookup that found
     nothing by the name the process gave, joined to its directory
     (`packages/lanehost/TECHNICAL.md`, the machine role). Such a path may
     run through a symlink. Which event named this path was not traced.

6. **Dropping a nested lane's disk fails on the read-only snapshots inside
   it.** Reproduced by `subvolumes.sh`:
   - Setup: btrfs-progs 6.14, kernel 6.8, a btrfs loop device mounted with
     `user_subvol_rm_allowed`, every command run as root with
     `CAP_SYS_ADMIN` dropped, as the disks role is.
   - A nested disk holding an inner lane's read-only snapshot, and an inner
     read-only subvolume, was dropped as `drop`
     (`packages/lanehost/disks.ts`) does it:
     - `btrfs subvolume delete` gave `Directory not empty`;
     - the fallback `rm -rf` gave `can't remove
       '…/snapshots/base/.git/HEAD': Read-only file system`.
   - Each inner subvolume found by inode 256, deepest first, made writable
     and deleted, then the disk: all deleted, without `CAP_SYS_ADMIN`.
   - `btrfs subvolume delete --recursive` fails without `CAP_SYS_ADMIN`
     (`Could not search B-tree: Operation not permitted`).
   - On the VM, bubbly-cactus's nested disk still holds its inner
     projects' snapshots (`nested/t-01a133b7-…/projects/*/snapshots/`).
   - The archive's teardown (`apps/pinetrie/host/work/archive.ts`) stops
     at the first lane whose removal throws. That lane's history is then
     not moved, and its snapshots are not deleted.

**After the fix** (the fold made linear and streamed), measured on the
lane VM on the same pair of jaunty-zephyr snapshots, in a container with
the privileged role's grant and its 256 MB limit:
- `diffBySend` took 2.5 s, with 42,631 changes, an RSS of 102 MB and the
  container's `memory.peak` at 67 MB.
- Of that, `btrfs send` alone took 1.7 s, in the kernel. Reading and
  folding the stream took 130 ms, and sorting the changes 28 ms.

The fixed `drop`, run on the VM with Docker's default capabilities as the
disks role is, deleted bubbly-cactus's leftover nested disk, its inner
projects' read-only snapshots with it, where today's had failed with EROFS.

**Open.**
- Why ideal-pond's next tool call still did not run after the role was
  killed. Its last snapshot was made at 18:19:57. The cancel was written
  at 18:21:26, and the host then died, leaving `pinetrie.db-journal`. The
  host's log, which would say, was not kept.
- The VM's kernel also printed `WARNING … at fs/btrfs/send.c:8297
  btrfs_ioctl_send` at 18:14:07Z. That is the second at which
  jaunty-zephyr's agent made two subvolumes in its own lane
  (`sandbox/p/s1`, `s2`). Its cause is not known.

**A note for whoever reads a lane by hand.** Once the host is gone, its
shared directories leave the lane's mounts, `/pinetrie-git/ignore` with
them. A `jj` command then snapshots `.pinetrie-lane/` into the working
copy. That happened in ideal-pond, sweet-willow and jaunty-zephyr during
this spike (2, 246 and 17,705 files). `jj file untrack .pinetrie-lane`, run
with the lane's ignore file in place, left each working copy empty again.
