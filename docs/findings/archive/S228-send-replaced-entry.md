# S228 — `btrfs send -p` replaces an entry whose parent inode is the higher by moving it aside, renaming the new one into its path, then unlinking the old under its orphan name

- **Status:** Answered

Recorded on the Mac's lane VM (btrfs-progs 6.17.1), 2026-10-18, by
`docs/findings/archive/S228-send-replaced-entry/run.sh` in lanehost's roles. Its
output, the snapshots' inodes and each stream's `btrfs receive --dump`,
is `docs/findings/archive/S228-send-replaced-entry/results.txt`. The streams
are lanehost's fixtures `replaced.stream`, `replaced-from-newer.stream` and
`across-lines.stream` (`packages/lanehost/fixtures/`).

## Brief

**Question.** On the Mac, a folder project's restore preview (a review
from the newer state to the older) listed no files. A lane's catch-up
answered "nothing new" while its proposed changes still conflicted. The
same scenarios pass where Docker is rootless, which diffs by a walk. What
does `btrfs send --no-data -p` write for a path whose entry is replaced
(removed, then made again: a new inode), when the parent's inode is the
higher, and does the fold in `packages/lanehost/send-stream.ts` read it?

**Kill criterion.** If send writes the old entry's removal before the new
entry takes its path whichever snapshot is the parent, the fold reads it
already, and the cause lies elsewhere.

**Throw away.** The probe's subvolumes (deleted on exit).

## Answers

1. **Sent with the older snapshot as the parent** (`replaced`, the
   parent's inodes the lower), the old entry goes first: `unlink a.txt`,
   or for a directory `rename d → o258-…`, its entries unlinked and the
   orphan removed; then the new entry is made under an orphan name and
   renamed into place. The fold read it as a change.
2. **Sent with the newer snapshot as the parent** (`replaced-from-newer`,
   a restore's preview), send goes by increasing inode: the new entry is
   made under an orphan name, the path's entry (the parent's, inode 261)
   is renamed aside to `o261-…`, the new one renamed into the path, and
   only at the end is `o261-…` unlinked. The fold took that unlink as the
   new entry's deletion, cancelling its add: the path dropped out. So did
   a replaced directory and the entries in it.
3. **Two disks made from one snapshot, each on a line of its own**
   (`across-lines`: a lane's tip against a shown merge), send pairs
   entries by inode number alone: the lane's `b.txt` and the merge's
   `c.txt` are both inode 261, sent as `b.txt` unlinked and `c.txt` made
   new, its generation differing. Here every parent's inode was the lower
   and the fold read it rightly. The folder scenario's inodes were not
   recorded: there `f.txt` dropped out of what a catch-up brings, and the
   change in 4 mends it, so a parent's higher inode, as in 2, is the
   likely order.
4. **The stream never makes an entry and then deletes it.** A deletion at
   a path the stream added to is of the entry the new one replaced:
   `sendFold` now reads it as a change. With that, both scenarios pass on
   the Mac (the folder scenario's catch-up conflicts on `f.txt`; the
   restore's preview lists both files).
