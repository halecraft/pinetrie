# S322 — A full data disk need not silence Docker: it answers and fails every write, so the host must watch the room, which btrfs's counters give any container; a repair boot with `btrfs-progs` in its initrd grows the disk offline

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** ADR-0210 recovers a lane VM whose data disk is full with a
boot of the builder's machine on `data.img`, as S314 did by hand. S314's
boot fetched `btrfs-progs` from the network at boot, and was started by a
person who had read `ENOSPC` in the host's log. So:

1. How does a full disk show itself to a host: does Docker stop answering?
2. Can the host read the disk's room without root or the `btrfs` command?
3. Does a repair boot with `btrfs-progs` and its libraries in its initrd,
   no network, grow a full disk and bring Docker back?

**Kill criterion.** The repair is not ready to automate if it needs the
network, or the lane VM's Docker cannot make a container after it.

**Throw away.** The spike VM's disks. Kept in
`docs/findings/S322-an-offline-repair/`:
- `packages.txt`, `apks.sha256`: `btrfs-progs` and what it needs on Alpine
  3.23, the version the image manifest pins (6.17.1-r0), with each apk's
  SHA-256;
- `repair-init`: the repair boot's `/init`, whose `[repair]` lines are for
  a host to read; its initrd was Alpine's minirootfs, then the builder's
  modules with `crc32c-cryptoapi`, `xor-neon`, `xor`, `raid6_pq`, `btrfs`
  and `loop` (S314), and the seven apks' files;
- `fill.sh`, `fill.txt`: a 2 GiB data disk filled as the lane VM's was;
- `repair.txt`: the repair's lines, and what the lane VM did after.

## Answers

Run on 2026-10-21 with the spike VM (S308's harness) and the builder's
machine (`builder.swift`), one after the other on the same `data.img`.

1. **Docker answered.** With every chunk allocated, data chunks half
   empty and metadata at `ENOSPC` (102 of 102 MiB), the lane VM booted and
   logged `docker ready`; `docker run` then failed: `failed to rename: …
   no space left on device`. On 2026-10-21 the lane VM's Docker did not
   answer at all. Whether it answers depends on what it writes at its
   start; a host cannot count on either.
2. **Any container reads the room.** `/sys/fs/btrfs/<fsid>/allocation/
   {data,metadata,system}/{total_bytes,bytes_used,disk_total}` are
   readable from an unprivileged container (read from one: data
   1,914,961,920 allocated, 963,874,816 used; metadata 107,347,968 and
   97,550,336). The device's size is the block device's
   (`/sys/block/vdb/size`, in 512-byte sectors), and unallocated is that
   size less each kind's `disk_total`. No `btrfs` command, no root.
3. **The offline repair works.** With the VM stopped, `data.img` grown
   from 2 to 3 GiB, the repair boot logged `found … unallocated=1048576`,
   `grown`, nothing to repack (no data chunk was under 40% used here), and
   `left … unallocated=1074790400`; the lane VM then booted and ran a
   container. No network was used.

So the host learns of a full disk from the room it samples, or from a
container's `no space left on device`, not from Docker falling silent; and
the repair can be a built artifact pinned as the builder's pins are.
