# S330 — When is the lane VM's btrfs metadata full, read from sysfs, at any disk size?

- **Status:** Open

**Why.** pine·trie judges the lane VM's data disk by two numbers from
btrfs's sysfs counters: unallocated space, and metadata's share used
(`bytes_used` of `total_bytes`, `/sys/fs/btrfs/<fsid>/allocation/metadata/`).
The share does not say full. S322's disk refused every write with its
metadata at 97,599,488 of 107,347,968 bytes, 91%, and the `vm-repair`
scenario read the same share after a repair that gained 37 GiB. So the
health value's `metadata-full` (over 95%) never fires on a disk out of
metadata. A repair is now `done` on unallocated room alone, and `init`
calls a disk full at boot when under 1 GiB is unallocated, whatever its
chunks hold. That last is too strict: every chunk allocated, with data and
metadata chunks still holding room, is how the 2026-10-21 disk looked
before it failed (S314), and writes still succeed then. A start on such a
disk repairs it. If the repair cannot regain 2 GiB, because growth is
capped by `lanes.store.max` or the Mac's free space, the failure is
recorded and every host's start is refused, on a disk that still writes.

btrfs refuses a metadata reservation when the space it holds is spoken
for: used, reserved, pinned, promised to transactions in flight
(`bytes_may_use`) and read-only, against `total_bytes`, with the global
reserve (`global_rsv_size`, in `allocation/`) kept back. It falls back to
a new chunk only while unallocated room holds one, twice its size for
DUP. On a healthy 24 GiB disk, read from an unprivileged container while
writing this brief: `global_rsv_size` 5,767,168; metadata `total_bytes`
268,435,456, `bytes_used` 35,799,040, `bytes_reserved` 262,144,
`bytes_pinned` 835,584, `bytes_may_use` 49,152,000, `chunk_size`
268,435,456, `disk_total` 536,870,912 (DUP).

**Question.**

1. When a btrfs disk on the lane VM's kernel refuses a metadata write,
   what do its sysfs counters read: does `total_bytes − bytes_used −
   bytes_reserved − bytes_pinned − bytes_may_use − bytes_readonly` fall to
   `global_rsv_size`, or near it, at the refusal, while unallocated room
   cannot hold a metadata chunk (`chunk_size` × 2 for DUP)?
2. Does the same reading hold on a small disk (2 GiB, 256 MiB metadata
   chunks) and a large one (at least 64 GiB, whose metadata chunk and
   global reserve are larger), so one rule serves every size?
3. With every chunk allocated but metadata's free space above that line,
   do writes succeed: a disk under 1 GiB unallocated that is not full, as
   S314's disk was before it failed?
4. Is the reading steady enough to read once at boot (`init`) and every
   few seconds while the host runs: does `bytes_may_use` swing by more
   than the margin between free and the reserve under a write load?

**Kill criterion.** No reading from sysfs separates a disk that refuses
metadata writes from one that does not, at both sizes: then "full" stays
unallocated room alone, and the start's refusal after a recorded failure
is softened instead, so a disk that may still write is not refused.

**Throw away.** The spike VM's disks, and the fill scripts. Kept in its
folder of sources if a plan builds on them: the fill, and each disk's
counters at the refusal and just before.

**How.** The spike VM (`sandbox/machine-spikes/vm.sh`), on the current
image (its `init` prints `data disk room` at boot). A 2 GiB data disk,
then a 64 GiB one, each filled as S322's `fill.sh` fills: 1 MiB files
until none fits, every other removed, then small files until a create
fails. A second container reads `allocation/` every second throughout,
and once more after the refusal; the counters at the first refusal are
the answer to 1 and 2. For 3, stop the fill at under 1 GiB unallocated
with metadata free well above the reserve, and write 10,000 small files.
For 4, the spread of `bytes_may_use` under the fill.
