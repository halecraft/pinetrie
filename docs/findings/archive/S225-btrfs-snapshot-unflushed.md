# S225 — A btrfs snapshot holds what was written on its kernel and not flushed

- **Status:** Answered

**Question.** Must a folder lane's disk be `sync`ed before it is
snapshotted when the writes are not the lane's container's, but lanehost's
disks role's, on the same kernel, with the lane's container stopped? The
lanes' rule (`packages/lanes/TECHNICAL.md`, "`sync` comes before every
snapshot") rests on S41, which cloned ext4 disk images from outside their
guest, where unflushed writes came out empty.

**Kill criterion.** Any snapshot, of 30, missing or truncating a file
written just before it with no `fsync` and no `sync`.

**Throw away.** The probe script.

**Answers.**

1. **A btrfs snapshot holds every write made on its kernel before it,
   flushed or not:** 30 of 30. Each round made a subvolume, wrote a 4 MB
   file and a small one with Node's `writeFileSync` (no `fsync`), took
   `btrfs subvolume snapshot -r` at once, and compared both files' bytes in
   the snapshot. Linux 6.18.56, a lane's btrfs. btrfs flushes a
   subvolume's delayed allocation when it snapshots it; S41's empties were
   ext4's delayed allocation, seen from outside the guest's kernel.
2. **So a snapshot taken by the disks role needs no `sync` in the lane's
   container** when nothing runs there: a person's choice of a conflict's
   version, made only while the thread is idle, snapshots the lane's disk
   from the disks role, and never starts its container for a `sync`. The
   agent's own resolution, inside its run, keeps `planSnapshot`'s `sync`, as
   every turn does: this spike does not reopen the lanes' rule.
