# S134 — The lane VM, its launcher and Docker's runtime work on the Mac: `docker run -d` in 79 ms, a snapshot in 28 ms, Docker answering 0.8 s into a boot, plus 1.35 s on its first

- **Status:** Answered
- **Led to:** ADR-0103, ADR-0130

**Question.** On the Mac, with the code as built in a lane (S133):
1. Does `pnpm vm:build` build the image under Apple's `container`?
2. Does the launcher build, boot the image, and keep its slots and its lease
   protocol: two hosts' slots apart, a slot filled once, the 17th lease
   refused, a closed lease's slot emptied, a half-close carried, the idle
   stop?
3. Does `dockerRuntime`, built by the app's `findProject`, do each disk
   operation, run a lane from its shape and carry stdin through `execArgv`,
   and at what cost?
4. Can an unprivileged container delete a read-only btrfs snapshot?

**Kill criterion.** A launcher that cannot keep one host's slot apart from
another's, or Docker's runtime unable to snapshot and restore a lane
without privilege.

**Throw away.** The script's state directory, VM, data disk and test
folders, which it deletes. The script is
`.plans/lane-runtime-mac/prove.ts`, in the shared plans folder.

## How it ran

Duane ran `node .plans/lane-runtime-mac/prove.ts ../pt-lanes` twice on the
Mac (macOS 26.7.1, 48 GiB, docker CLI 29.8.1, buildx 0.37.2), on a checkout
of the thread's work. The script ran a VM of its own, in a throwaway state
directory sharing the built images and launchers, with
`LAUNCHER_IDLE_SECONDS=5`. Its results are in
`.plans/lane-runtime-mac/results-2026-10-07T20-00-00-672Z.txt` and
`…T20-13-51-734Z.txt`.

The first run stopped at Phase 5: the host's check found no buildx. Duane's
`DOCKER_CONFIG` is `~/.config/docker`, so the CLI read its config there,
not in `~/.docker`, where the `cliPluginsExtraDirs` line was. With the line
in `$DOCKER_CONFIG/config.json`, the second run went through.

## Answers

1. **The image builds under `container` in 23.1 s:** `Image` 36.3 MB,
   `stage1.cpio` 1.7 MB, `system.erofs` 107.3 MB. `Image`'s hash is the one
   the lane's chroot build made (S133). A second `pnpm vm:build` finds it
   built (481 ms).
2. **The launcher works as planned.** It built and signed in 2.4 s.
   - Two leases took slots 0 and 1, the second in 76 ms.
   - Each slot showed its own directory. Slot A's, shared read-write, took
     a write that reached the Mac. Slot B's, read-only, refused one
     ("Operation not permitted").
   - A second `fill` on one lease was refused (`filled`).
   - With 16 slots held, the next lease was refused: `full`, `slots: 16`.
   - Once a lease closed, a bind of its slot's directory found nothing
     ("No such file or directory").
   - `echo hi | docker run -i … cat` returned `hi` in 139–143 ms.
   - With no lease for 5 s, the launcher logged "guest synced", stopped the
     VM and exited, 5.5 s after the last lease ended.
3. **Docker's runtime works, through `findProject`,** in slot 1, which the
   second lease had freed:

   | operation | ms |
   |---|---|
   | `create` | 25 |
   | `diskExists` | 26 |
   | `run` from a shape | 75 |
   | `snapshot`, and again over it | 29, 29 |
   | `restore` into another lane | 28 |
   | `stop`, `start`, `remove` | 316 together |
   | `delete` ×2 and `deleteSnapshots` | 126 together |
   | `runInImage`, stdout as bytes | 141 |

   - `execArgv` carried stdin's end into the lane. The lane read the
     working copy, and its write there failed ("Read-only file system").
   - The restored lane held the file written before the snapshot.
   - Ten runs and ten snapshots: `docker run -d` median 79 ms (73–84), a
     snapshot median 28 ms (27–29).
4. **No:** "ERROR: Could not destroy subvolume/snapshot: Read-only file
   system". A container with no added capability cannot delete a read-only
   subvolume.

**The cold start.** Docker answered 2,685 ms after the launcher started in
the first run and 2,157 ms in the second, each on a fresh data disk. The
second run's guest console (the guest's uptime):

| T+ | stage |
|---|---|
| 0.15 s | stage 1 mounted the system image; init started |
| 0.41 s | drivers loaded |
| 1.76 s | data disk formatted (first boot), and mounted |
| 1.77 s | 16 slots mounted |
| 1.87 s | network up |
| 1.98 s | Docker ready |

Formatting took 1.35 s. Without it Docker would be ready at about T+0.63 s,
and would answer the launcher about 0.8 s after the launcher started.

## The lanes suite under Docker

On the thread's later work, `PINETRIE_E2E_RUNTIME=docker pnpm run e2e:lanes`
passed 65 of 65 checks: every scenario of the suite, the contract's six
Docker checks among them. A first run had failed four, all fixed: two of
`main`'s read a lane's hostname, which Docker sets to the container's id
until `renderRun` passed `--hostname`; the vsock check matched `opened` in
the source line Python 3.13's traceback quotes; and the cold start included
a fresh disk's format. In the contract the costs were `docker run -d` 85 ms
and a snapshot 30 ms, with 15 files open in the launcher.

## What this means

- **Kill criterion:** not met.
- The costs the plan names hold: `docker run -d` under 150 ms and a
  snapshot under 50 ms.
- A VM answers under 2 s from a cold start except on its first boot, which
  formats its data disk. The `contract` scenario's VM keeps its data disk
  between runs (`contract-data.img`), and holds the 2 s only on a boot that
  did not format it.
- Snapshots stay writable (`planDiskCommand`).
- The buildx refusal names `$DOCKER_CONFIG`, where the CLI reads its
  config when it is set.
