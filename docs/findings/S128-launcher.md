# S128 — A launcher of our own closes vfkit's two gaps: shares read-only on the Mac's side, and a half-close carried; the system image compresses to 113 MB at no cost to the boot

**Status:** Answered. Follows S126 and S127. Serves ADR-0103 (proposed). 
**Question.** S126 and S127 booted the lane VM with vfkit, which shares
every directory writable on the Mac's side and whose vsock bridge drops a
half-close. A launcher of pine·trie's own on Virtualization.framework
(`launcher.swift`, about 250 lines) boots the same kernel and first stage.
It shares the working copy with the read-only flag set, and bridges unix
sockets on the Mac to the guest's vsock ports, passing each direction's
end on as a `shutdown`. With it:
1. Does `docker run -i` see its input's end, and keep its output after it?
2. Does a lane with `CAP_SYS_ADMIN`, or root in the VM, still write to the
   Mac (S127: yes, under vfkit)?
3. Can a lane open a vsock connection to the VM's own ports: Docker's
   (2375) and the probe's root shell (2376)? It tries with the VM's
   `vsock_loopback` module as the VM has it, and then loaded.
4. What does a lane reach on the Mac: a server bound to the Mac's
   loopback, one bound to all addresses, and ssh? It tries at the VM's
   gateway and at the Mac's LAN address.
5. Can a share be replaced while the VM runs? Here, a single directory is
   replaced by two, one read-write and one read-only, so that a new grant
   or shared directory needs no restart.
6. How small can the system image be, and does that change the boot?
   - full: S127's, 322 MB;
   - trimmed: without `buildx`, the `docker` CLI and modules for hardware
     a VM lacks, 211 MB;
   - trimmed and compressed with lz4hc, 107 MB.

   Each boots on a fresh data disk, and Docker's answer time and memory
   are compared.

**Kill criterion.** The launcher cannot carry a half-close, or a share
with the read-only flag still lets a lane write to the Mac.

**Throw away.** The probe's folder (`s128-launcher/` in the shared plans
folder): the launcher's source and build, the three images, the kernel and
first stage copied from S126, the init, the script and its results. The
data disk, test folders and servers, which the script deletes.

## Sources

Kept for `PLAN-2026-10-07-lane-runtime`, which builds the VM's image on
them (`docs/findings/S128-launcher/`):
- **`lane-init`:** the system image's PID 1 as S129 last ran it. It
  includes the probe's root shell on vsock 2376, which the plan drops, and
  `socat -t 3600` on both bridges.
- **`stage1-init`:** the first-stage initramfs's script, from S126's probe:
  it mounts the erofs system image under a tmpfs overlay and switches to
  it.

The launcher this spike ran is S131's, with slots added
(`docs/findings/S131-share-slots/`).

## How it ran

Duane ran `run.sh` on the Mac (macOS 26.7.1, Apple Swift 6.4, docker CLI
29.8.1). The launcher built with `swiftc -swift-version 5 -O` in 32 s, and
was signed ad hoc with `com.apple.security.virtualization` (116 KB).

Its first two trimmed images loaded no drivers: no network, vsock,
virtiofs or btrfs. The module index was empty, because the `depmod` that
rebuilt it in a lane (Debian's kmod 34.2, `-ZLIB`) skipped Alpine's
`.ko.gz` modules. So `run.sh` fell back to the full image for every test.
Item 6 is measured again by `boot.sh`, on trimmed images that keep
Alpine's own index (`system-trim2*`).

While Docker did not answer, the launcher logged each refused connection
("vsock 2375: … Connection reset by peer", 4,493 lines): the script asked
every 20 ms.

## Answers

1. **The launcher carries a half-close.**
   - `echo hi | docker run --rm -i alpine:3 cat` returned `hi` in 800 ms.
   - Output written 2 s after stdin's end arrived (`hi after`, 2,844 ms).
   - The repo, streamed with `tar` through `docker run -i` into a btrfs
     subvolume, arrived whole: 29,901 files in 3,586 ms.
   - Under vfkit's bridge, stdin's end never came (S126).
2. **A share with the read-only flag holds on the Mac's side.** In each
   case the remount succeeded (`virtiofs rw`), and the write failed with
   "Operation not permitted":
   - a lane with `CAP_SYS_ADMIN`, the working copy bound `:ro`;
   - the same, bound without `:ro`;
   - root in the VM, with `mount -o remount,rw`.

   Nothing reached the Mac. Under vfkit, the first two wrote to it (S127).
3. **A lane cannot open a vsock socket at all** under Docker's default
   seccomp profile: `socket(AF_VSOCK)` failed with "Operation not
   permitted", with the VM's `vsock_loopback` unloaded and again loaded.
   The default profile allows `socket` only for families it lists, and
   AF_VSOCK (40) is not among them (`moby/profiles`
   `seccomp/default.json`, read). S125's narrow profile keeps that rule, so
   a lane that runs lanes cannot either.

   From the VM itself, to port 2375:
   - CID 1 (local), without `vsock_loopback`: reset;
   - CID 2 (the Mac, where the launcher listens on nothing): reset;
   - CID 3: "No such device".
4. **A lane reaches the Mac's services bound to all addresses, and not
   those bound to its loopback.**

   | target | Mac server on `127.0.0.1:18081` | Mac server on `0.0.0.0:18082` | port 22 |
   |---|---|---|---|
   | the VM's gateway, 192.168.65.1 | refused | **answered** | refused |
   | the Mac's LAN address, 192.168.5.26 | timed out | **answered** | timed out |

   So the network is as ADR-0034 describes for `container`: the internet,
   and every service on the Mac bound to all interfaces.
5. **A share can be replaced while the VM runs.**
   - The running device tagged `extra` answers `setShare:`. Replacing its
     single directory with a multiple-directory share (`a/` read-write,
     `b/` read-only) showed at once in the mounted `/mnt/extra`, with no
     remount.
   - A write to `a/` reached the Mac.
   - A write to `b/` failed: "Operation not permitted".
6. **The system image's size makes no difference to the boot** (`boot.sh`,
   each image twice on a fresh data disk):

   | image | size (`du`) | Docker answered on the Mac | guest's "docker ready" | held on the Mac |
   |---|---|---|---|---|
   | full | 307 MB | 1,806, 1,500 ms | T+1.28, 1.31 s | 769, 776 MB |
   | trimmed (`system-trim2`) | 203 MB | 1,460, 1,443 ms | T+1.28, 1.27 s | 778, 772 MB |
   | trimmed, lz4hc | **113 MB** | 1,505, 1,495 ms | T+1.33, 1.31 s | 772, 803 MB |

   The trimmed images drop `buildx` (71 MB) and the `docker` CLI (29 MB),
   which the VM does not need, and the modules for hardware a VM lacks.
   Every module the init loads, and their dependencies, remain.

   On every boot the data disk was fresh, so formatting it is included.
   From the disks being mounted (T+0.74 s) to Docker's answer took 0.55 s.
   In S126, under vfkit with S126's init, it took 0.10–0.15 s, and Docker
   was ready at T+0.83 s on a first boot. The difference is not explained.
   The guest's clock and the Mac's differ by the launcher's own start and
   the first ping: 0.15–0.5 s.

   **Slower `docker run -d` and `rm -f`: 505 and 370 ms,** against 77 and
   70 ms under vfkit (S126), while `docker exec` took 26 ms as before. They
   were measured right after the 830 MB repo was streamed into btrfs, where
   S126 measured them before its copy. Writeback in the VM is one possible
   cause, not tested.

## What this means

- **Kill criterion:** not met. The launcher carries a half-close, and a
  share with the read-only flag held against `CAP_SYS_ADMIN` and against
  root in the VM.
- **The working copy is held on the Mac's side,** so it no longer rests on
  lanes never getting `CAP_SYS_ADMIN`.
- **The VM's Docker is out of a lane's reach over vsock,** under Docker's
  default profile and the narrow one alike.
- **Grants and shared directories need no restart:** one multiple-directory
  share, replaced while the VM runs.
- **The image ships at 113 MB,** trimmed and compressed, and boots like the
  full one.
- **Lanes reach the Mac's services bound to all interfaces,** as under
  `container`. The network is still not a grant.
- **Both slow results come from the launcher's disks** (S129): it took
  Apple's synchronization mode, `full`. With `fsync`, as vfkit uses,
  `docker run -d` takes 82–103 ms, and Docker answers in about 1 s.
