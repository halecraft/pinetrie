# S312 — Space freed in the lane VM goes back to the Mac within seconds: the data disk takes discards, and btrfs sends them

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** `packages/vm/TECHNICAL.md` said nothing trims `data.img`, so
space freed in the guest is reused there and never returned to the Mac. If
so, the file only grows, and the Mac's free space is the true limit of what
lanes may ever have written. Is it so?

**Kill criterion.** The gotcha holds if deleting a file in the guest leaves
`data.img`'s allocated size on the Mac where it was.

**Throw away.** The spike VM. The commands are below.

## Answers

Run on 2026-10-21 in the spike VM (S308's harness), its data disk a sparse
file on APFS.

- The data disk takes discards: `/sys/block/vdb/queue/discard_max_bytes`
  is 32 GiB, granularity 512. The data disk is mounted
  `discard=async` (btrfs's default for a disk that takes discards).
- `data.img` on the Mac (`du`): 1.32 GB, then 2.43 GB after 2 GiB written
  and synced in the guest, then **0.33 GB 30 s after the file was
  deleted**, and 0.17 GB after an `fstrim` freed the rest.
- The lane VM agrees: on 2026-10-21 its `data.img` held 261 GB on the Mac
  for 250 GB used in the guest, after weeks of lanes made and deleted.

So the gotcha was wrong: the Mac's cost of the data disk follows what the
guest holds now, and freeing space in the guest (S313) frees it on the Mac.

Commands, in the VM's root (`docker run --rm --privileged --pid=host
alpine:3.23 nsenter -t 1 -m sh -c …`), with `du -k data.img` on the Mac
between each:

```sh
cat /sys/block/vdb/queue/discard_max_bytes
head -c 2147483648 /dev/urandom > /var/lib/lanehost/spike-discard/f && sync
rm -rf /var/lib/lanehost/spike-discard && sync   # then wait 30 s
fstrim -v /var/lib/lanehost
```
