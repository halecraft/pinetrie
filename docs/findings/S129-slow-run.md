# S129 — `docker run -d` took 500 ms under the launcher because its disks used synchronization `full`; with `fsync`, it takes 82–103 ms, and the VM is ready 0.5 s sooner

**Status:** Answered. Follows S128. Serves ADR-0103 (proposed), whose lane start
(74–113 ms) it depends on.

**Question.** Under the launcher, `docker run -d` took 505 ms and `rm -f`
370 ms, while `docker exec` took 26 ms (S128). Under vfkit they took 77 and
70 ms (S126). S128 measured them right after streaming 830 MB into btrfs;
S126 measured them before its copy. Four causes predict four patterns:
- **A. Writeback of a large write:** slow at once after it, normal before
  it and after `sync`.
- **B. The launcher's bridge, per connection:** slow from the Mac, normal
  from inside the VM, and an empty `curl /_ping` costly.
- **C. The new init or image:** slow under vfkit as well, before any write.
- **D. Something in the launcher's VM:** slow after a write under the
  launcher, normal after the same write under vfkit.

`slow.sh` takes the same steps under the launcher and then under vfkit, on
the same full system image:
- 20 bare connections;
- 10 `run -d` and 10 `rm -f`, from the Mac and from inside the VM;
- a write made inside the VM: the repo copied from the share into btrfs
  with `tar`;
- the same timings again at once, after `sync`, and 30 s later, with the
  VM's dirty and writeback memory each time.

**Kill criterion.** None: a measurement. It decides whether ADR-0103's lane
start holds under the launcher.

**Throw away.** `slow.sh` and its results, in the probe's folder
(`s128-launcher/` in the shared plans folder).

## Run 1 (`slow.sh`)

Duane ran it on the Mac (macOS 26.7.1, vfkit 0.6.4, docker CLI 29.8.1), on
the full system image:

| | launcher, from the Mac | vfkit, from the Mac | vfkit, inside the VM |
|---|---|---|---|
| bare connection (`curl /_ping`) | 6 ms | 6 ms | — |
| `run -d` / `rm -f`, before the write | **495 / 329 ms** | 78 / 71 ms | 67 / 60 ms |
| at once after the write | 540 / 336 ms | 97 / 71 ms | 71 / 60 ms |
| after `sync` | 519 / 332 ms | 76 / 71 ms | 69 / 62 ms |
| 30 s later | 479 / 310 ms | 76 / 70 ms | 67 / 60 ms |

- The VM's dirty memory stayed under 350 kB throughout.
- Under vfkit, the write took 7.6 s: 29,901 files, 805.9 MB.

So the cause is not:
- **A, the write:** the launcher was as slow before it;
- **B, a connection through the bridge:** 6 ms under both;
- **C, the image or init:** vfkit with the same image was fast.

It is **D, the launcher's VM.**

Under the launcher, every timing taken inside the VM came out empty or
failed with name conflicts. The probe's root shell (`socat` on vsock 2376)
kept socat's default `-t 0.5`. The launcher carries the client's end, so
socat closed each command 0.5 s after `nc` finished sending, and left its
containers behind. Under vfkit, the end never arrived, so commands ran to
the end. Run 2's images give that socat `-t 3600`.

**Read from source:** vfkit 0.6.4 attaches a disk image with
`vz.DiskImageCachingModeCached` and `vz.DiskImageSynchronizationModeFsync`
(`pkg/vf/virtio.go`, `DiskStorageConfig.toVz`). The launcher used
`VZDiskImageStorageDeviceAttachment(url:readOnly:)`, which takes Apple's
defaults: caching `automatic`, synchronization `full`. Under `full`, a
guest's flush is an `F_FULLFSYNC` on the Mac. `docker run` and `rm` flush
several times, and `exec` does not.

Run 2 (`sync.sh`) boots the launcher under four modes:
- `full`, `automatic`;
- `full`, `cached`;
- `fsync`, `cached` (vfkit's);
- `none`, `cached`.

Each runs `slow.sh`'s steps.

## Run 2 (`sync.sh`)

Duane ran it on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI 29.8.1), on
the full system image, whose root shell now had `socat -t 3600`. Each mode
booted the launcher on a fresh data disk:

| sync, cache | Docker answered | `run -d` / `rm -f`, Mac, before the write | inside the VM, before | Mac, at once after | Mac, after `sync` | Mac, 30 s later | the write (29,901 files, 805.9 MB) |
|---|---|---|---|---|---|---|---|
| full, automatic (Apple's default) | 1,856 ms | **493 / 345** | 485 / 345 | 494 / 337 | 503 / 330 | 461 / 305 | 7,360 ms |
| full, cached | 1,479 ms | **484 / 322** | 477 / 312 | 513 / 338 | 479 / 344 | 471 / 327 | 7,630 ms |
| **fsync, cached** (vfkit's) | **1,007 ms** | **84 / 72** | 69 / 60 | 103 / 71 | 82 / 72 | 89 / 78 | 7,740 ms |
| none, cached | 1,076 ms | 86 / 75 | 79 / 67 | 87 / 75 | 82 / 75 | 87 / 73 | 8,090 ms |

- A bare connection took 7–9 ms in every mode.
- The VM's dirty memory stayed under 250 kB, and `sync` took 0–20 ms.

## Answers

1. **The cause is the data disk's synchronization mode, `full`.** Inside
   the VM, with no bridge, `run -d` and `rm -f` took as long as from the
   Mac (485 / 345 ms). The caching mode made no difference: `full` was
   slow with `automatic` and with `cached` alike.
2. **`fsync` brings them to vfkit's times:** `run -d` 82–103 ms and `rm -f`
   71–78 ms from the Mac, and 69–75 / 60–66 ms inside the VM. Under vfkit
   (run 1) they were 76–97 / 70–71.
3. **`none` is no faster than `fsync`,** for `run`, `rm` or the write (8.1 s
   against 7.7 s), and drops the guest's flushes altogether.
4. **The large write costs the same in every mode** (7.4–8.1 s), since it
   does not flush.
5. **The VM is ready sooner under `fsync`:** Docker answered in 1,007 ms,
   against 1,479–1,856 ms under `full`. So S128's 0.55 s from the disks
   being mounted to Docker's answer, against S126's 0.10–0.15 s, was also
   `full`: formatting the data disk and Docker's start flush.

## What this means

- **The launcher attaches its disk images with synchronization `fsync`
  and caching `cached`,** as vfkit does. A lane then starts in 82–103 ms,
  and the VM is ready in about 1 s.
- **What `fsync` gives up:** a guest's flush reaches the Mac's drive with
  `fsync`, not `F_FULLFSYNC`, so the drive's own cache is not emptied, and
  a power loss can lose the last writes. A lane's disk is rebuilt from its
  snapshots and its commits, which the host holds in the project's repo.
- **`none` is not worth taking:** it is no faster, and it ignores flushes.
