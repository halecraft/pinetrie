# S314 — A data disk with all its space allocated fails every write when its metadata fills, though `df` shows free space; growing the file is the way back, but the lane VM's own resize failed once, and its reason was thrown away

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** On 2026-10-21 every lane's write failed with `ENOSPC`
(snapshots, `chown`, overlay mounts, `jj`'s locks) while `df` showed
37 GB free of 288. `packages/vm/TECHNICAL.md` names the way back from a
full data disk: with the launcher stopped, `truncate -s` a bigger
`data.img`, and `init` grows the filesystem at the next boot. That boot
logged `data disk not resized`, and Docker never answered. So:

1. What was full?
2. Why did `init`'s `btrfs filesystem resize max` fail? Does a filesystem
   in that state refuse to grow?
3. What brought it back?

**Kill criterion.** The resize's failure is explained if one of the
states tried reproduces it; otherwise it is open, and the spike says what
it ruled out.

**Throw away.** The spike VM and its loop devices. Kept in
`docs/findings/S314-a-full-data-disk/`:
- `full-metadata.sh`, `pending-deletes.sh`: a 1 GiB btrfs on a loop
  device, its data chunks allocated and half empty, its metadata filled
  with inline files, or with subvolumes half of them just deleted; then
  the file grown and `resize max` run right after mount, as `init` does;
  `full-metadata.txt` and `pending-deletes.txt`, their output;
- `recovery-init`: the `/init` of the boot that recovered the disk.

## Answers

1. **Metadata, with nothing left to allocate it from.** `btrfs filesystem
   usage`: device 288 GiB, all allocated, 1 MiB unallocated; data 229 GiB
   allocated, 191.7 GiB used; metadata (DUP) 29.48 GiB allocated, 28.98
   used. btrfs allocates space in chunks, a chunk holds data or metadata,
   and new metadata needs a new metadata chunk: the 37 GiB free inside data
   chunks could not hold it. `df` reports that 37 GiB. A balance, which
   repacks data chunks to free whole ones, refused for the same reason
   (`btrfs balance start -dusage=5`: `No space left on device`), as did
   Docker creating a container (its metadata database is on the same disk).
   S313 says what filled the metadata.
2. **Not reproduced.** In the spike VM, on the lane VM's kernel:
   - a filesystem fully allocated, data chunks half empty, metadata at
     `ENOSPC` from inline files: grown from 1 to 2 GiB, `resize max` right
     after mount succeeded;
   - the same, filled with 2,462 subvolumes, 1,231 deleted just before
     unmount, so the cleaner had work pending at mount: succeeded;
   - the real path, `data.img` grown from 24 to 32 GiB with the launcher
     stopped, then a boot: the filesystem was 32 GiB, no line logged.

   `init` sends the command's output and errors to `/dev/null`, so the
   lane VM's reason is lost. What was not tried: a filesystem of 36,000
   subvolumes, its metadata 29 GiB.
3. **A boot of our own.** No shell reaches the lane VM, and its Docker
   could not start, so nothing could be run in it. With the launcher
   stopped, the image builder's machine (`builder.swift`: a kernel, an
   initrd, one disk) booted the pinned kernel with Alpine's minirootfs and
   `recovery-init` as its `/init`, with `data.img` as its disk. Its
   modules are the builder's, plus `crc32c-cryptoapi`, `xor-neon`, `xor`,
   `raid6_pq`, `btrfs` and `loop`; without `crc32c-cryptoapi` the mount
   fails (`error allocating crc32c hash for checksum`). It installed
   `btrfs-progs`, mounted the disk and ran `resize max`: **it succeeded
   (400 GiB)**. Then `balance -dusage=` 0, 5, 10, 20, 40 relocated 27 data
   chunks in about 270 s: unallocated 135 GiB, data 202.0 GiB allocated,
   metadata 31.48 GiB allocated and free to grow. The lane VM then booted,
   its Docker answered in 4 s, and nothing was lost.

So a recovery that needs no shell exists, and is a boot pine·trie could
make itself; `init` should say why a resize failed; and `df` is the wrong
measure of the room left: btrfs's unallocated space and its metadata's
use are.
