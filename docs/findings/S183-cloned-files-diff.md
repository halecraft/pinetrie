# S183 — A diff sees every cloned file as changed, equal content included; so a merge writes only paths whose result differs from the receiving side, and a content check is shared extents (0.25 ms) before a read; a clone of a GiB costs 4 ms and no space

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** ADR-0142's merge writes into the receiving disk the files it
takes from the other side, as clones (`FICLONE`), and an accept builds
the folder's next state the same way. ADR-0135 says two states hold the
same files when their diff is empty.
1. Does the walk (`compareTrees`, `packages/lanehost/walk.ts`) report a
   file replaced by a clone of a file with equal content as changed? And
   one replaced by a clone of a file with other content?
2. Does `btrfs send -p` report a clone as a change (`diff.ts` folds a
   clone into one)?
3. What does a content comparison cost for the paths a diff calls
   changed: `FIDEDUPERANGE`'s check, or reading both files?
4. Does a clone cost space or time in proportion to its size?

**Kill criterion.** If a cloned equal file diffs as changed and nothing
cheap can tell, a merge must skip writing a path whose result equals the
receiving side, and say so as a rule of the merge.

**Throw away.** `docs/findings/S183-cloned-files-diff/probe.sh`, on this
lane's btrfs disk. `btrfs send` needs `CAP_SYS_ADMIN` in the host's user
namespace, which a lane lacks: question 2 runs on the lane VM's disks role,
or is read from the send stream's format.

Run on this lane's btrfs disk (the Mac's VM, kernel 6.18.56) by
`probe.sh`, with the real walk (`walk.mjs` runs `walkTree` and
`compareTrees` from `packages/lanehost/walk.ts`) and `extents.py`
(FIEMAP, then a read). The output is `results.txt`.

## Answers

1. **The walk reports every cloned file as changed,** whether its
   content is equal or not: `same.txt` cloned from another snapshot's
   equal file, `big.bin` cloned from its own earlier extent, and
   `diff.txt` and `mid.bin` with other content. A clone gives the file
   new times, and a new inode when it is a new file.
2. **`btrfs send` would report them too** (read from the code, not run:
   a lane lacks `CAP_SYS_ADMIN` in the VM's user namespace). The fold in
   `packages/lanehost/send-stream.ts` counts `CLONE`, `WRITE` and
   `UPDATE_EXTENT` as changes, and a clone sends one of them.
3. **Telling equal content:**
   - **Shared extents prove equal content, without reading:** FIEMAP on
     both files took 0.25 ms for the 1 GiB clone; reading both took 511
     ms.
   - **Inline files say nothing.** A file of a few bytes lives in
     btrfs's metadata, and FIEMAP flags its one extent
     `FIEMAP_EXTENT_DATA_INLINE`, whose address means nothing. A first
     run of this probe, which ignored the flag (and packed the request
     wrong), called two different small files equal. Such files are
     small, and reading both took 0.1 ms.
   - **Different extents prove nothing.** A file copied rather than
     cloned, such as one read in from your folder, has extents of its
     own, whatever its content. So: equal if the extents are shared and
     not inline, otherwise read both.
4. **A clone costs almost nothing.** Cloning the 1 GiB file to a new path
   took 4 ms and added no bytes to the disk's use.

**Kill criterion: met.** A merge must not write a path whose result is
already the receiving side's content. The path merge knows that without
looking: a path changed only on the receiving side, or changed alike on
both, is left as it is. A text merge's result is compared with the
receiving side's bytes, which it holds, before it is written. With that
rule, a merge's diff names only the paths it really changed. Where two
states are compared otherwise (a folder read after you `touch` a file),
a path the diff calls changed is compared by shared extents, then by
reading.
