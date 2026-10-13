# S131 — Share devices are apart: replacing one leaves bind mounts into the others working; a VM boots with 20 of them, and they cost almost nothing

- **Status:** Answered
- **Led to:** ADR-0103, ADR-0118, ADR-0130, ADR-0141

Follows S130.

**Question.** S130 found that replacing a virtiofs share while the VM runs
breaks every container's bind mount into it, while a bind of its root
survives. The plan's one VM per user would then give each host a **slot**:
a share device made empty at boot, filled with that host's directories
when it leases, and never replaced while that host runs. That holds only
if:
1. replacing one device's share leaves bind mounts into the others working;
2. a mount made after a slot is filled works until that slot is replaced;
3. a VM boots with enough devices: one per host running at once.

This run measures:
- the most share devices a VM boots with (32, then 28, 24, … 4);
- for 1 slot against that most: Docker's answer time, how long the guest
  takes to mount them all, memory on the Mac and in the guest, and the
  virtio devices the guest finds;
- with that many slots:
  - containers bound into slot 0 (one read-write, holding a file it
    writes every 0.1 s; one read-only; one on a directory inside an
    entry);
  - slot 1 filled, then emptied;
  - slot 2 filled;
  - then slot 0 itself replaced.

**Kill criterion.** Replacing one slot breaks bind mounts into another, or
a VM boots with fewer than 4 slots.

**Throw away.** The probe's folder (`s131-share-slots/` in the shared
plans folder): the launcher's variant, the kernel and first stage copied
from S128, the script and its results. The data disk and test folders,
which the script deletes.

## Sources

Kept for `PLAN-2026-10-07-lane-runtime`, whose launcher starts from them
(`docs/findings/S131-share-slots/`):
- **`launcher.swift`:** S128's launcher with slots:
  - boots the kernel and first stage, with the system image read-only and
    the data disk under `fsync`/`cached` (S129);
  - shares the working copy read-only on the Mac's side;
  - makes `LAUNCHER_SLOTS` empty share devices, and on `SIGUSR1` refills
    only the slots whose set changed in `slots.txt` (`setShare:`);
  - bridges `docker.sock` and `ctl.sock` to vsock 2375 and 2376 with
    half-closes.

  Build it with `swiftc -swift-version 5 -O`, and sign it with `codesign
  -s - --entitlements launcher.entitlements`.
- **`launcher.entitlements`:** `com.apple.security.virtualization`.

## How it ran

Duane ran it once on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI
29.8.1), with S128's trimmed image (`system-trim2-lz4hc`) under a variant
of S128's launcher, on a fresh data disk for each boot. The VM's devices
besides the slots: two disks, network, console, entropy, vsock and the
working copy's share. The guest mounted slots through the probe's root
shell, since the image's init knows nothing of them. The launcher's log
lines printed after each fill include the fills before it (the script
printed the last three).

## Answers

1. **A VM booted with 20 slots, and not with 24, 28 or 32.**
   - At 24 and above, `start` failed with "Internal Virtualization error.
     The virtual machine failed to start" (`VZErrorDomain` code 1).
   - 21–23 were not tried.
   - With 1 slot the guest found 8 virtio devices, and with 20 it found
     27. So the limit is near 30 devices of every kind, about what one
     PCI bus holds.
2. **Slots cost almost nothing:**

   | | 1 slot | 20 slots |
   |---|---|---|
   | Docker answered | 1,387 ms | 1,099 ms, then 1,092 ms |
   | the guest mounts every slot | 0 ms | 10 ms |
   | memory the VM holds on the Mac | 777 MB | 791 MB |
   | guest memory used | 145 MB | 146 MB |

   Replacing a slot's share took under 1 ms (the launcher's own timing).
3. **Each slot is apart from the others.** Three containers stayed bound
   into slot 0 while slot 1 was filled, slot 1 was emptied and slot 2 was
   filled:
   - one read-write on `k1`, holding a file open and writing it every
     0.1 s;
   - one read-only on `k1`;
   - one on `k1/sub`.

   After each change:
   - all three read, and the read-write one listed every new file;
   - its writes reached the Mac, and the Mac's reached it;
   - the held file grew (55 → 85, 140 → 170, 230 → 265 bytes in 0.6 s
     each time).

   A container on slot 1's `k2` read it, and its write was refused
   ("Operation not permitted": read-only on the Mac's side).
4. **A mount made after a slot is filled works until that slot is
   replaced:** slot 0's three containers, started after it was filled.
   Emptying slot 1 broke its own container's mount ("ls: /b: No such file
   or directory"), as S130 found. So did replacing slot 0 itself: all
   three of its containers lost their mounts, and the held file stopped at
   275 bytes. A container started after the replacement read `k1` again.
5. **The guest's kernel logged nothing** but the tags found at boot.

## What this means

- **Kill criterion:** not met. Slots are apart, and a VM has 20.
- **One slot per host works:**
  - a host's directories go in its own slot when it leases, as one
    multiple-directory share;
  - its slot is never replaced while it runs;
  - other hosts' leases fill and empty other slots under it, harmlessly.

  A host reads its directories at startup (ADR-0035), so its set is fixed
  while it runs.
- **About 20 hosts can run at once on one Mac's VM:**
  - the working copy's share apart from the slots is the probe's; in the
    plan it is in its host's slot, which leaves room for one more slot;
  - a host past the limit is refused at its lease.
- **A slot must be free of containers before it is filled again:** filling
  it would cut its old containers' mounts, or give a dead host's lanes
  the next host's directories.
