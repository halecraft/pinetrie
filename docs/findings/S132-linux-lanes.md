# S132 — A lane can run lanes of its own on Linux: namespaces, overlayfs and pasta work unprivileged; btrfs is not in the kernel `container` boots

Numbered S121 until 2026-10-07, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0102, ADR-0103

It serves the move to working only in containers, with Linux lanes beside the
Mac's.

**Question.** Can a host on Linux give each thread a lane of its own, with its
own files, ports and processes, and a disk a branch can clone cheaply? In
particular, can it do so inside a pine·trie lane, so that every suite runs
real lanes without Apple's `container`? Which copy-on-write disk can it use?

**Kill criterion.** A lane started inside a lane cannot get its own mounts
or ports, or a branch cannot clone a lane's disk in about a second.

**Throw away.** Every script under `/tmp` in the probe lane. Nothing reached
the repo.

## Where it ran

A pine·trie lane: Apple's `container` 6.18.35 kernel (aarch64), Debian 13,
root, with Docker's default capability set: no `CAP_SYS_ADMIN`, no
`/dev/kvm`, `/proc` with masked paths, cgroup v2 writable. The kernel config
(`/proc/config.gz`) has `CONFIG_USER_NS=y`, `CONFIG_OVERLAY_FS=y`,
`CONFIG_XFS_FS=y` and `CONFIG_FUSE_FS=y`, and `# CONFIG_BTRFS_FS is not set`.
It has no modules (`/lib/modules` is absent).

## Answers

1. **Own mounts:** yes. `unshare -Urm` (user and mount namespaces) mounts
   tmpfs and overlayfs. A lane's mounts are not seen outside it.
2. **Own ports:** yes. Each lane in its own network namespace, with
   `pasta --runas 0 --config-net -t none -u none -T none -U none <pid>`
   (package `passt`). Two lanes each served `:5173` at once, each reached
   `registry.npmjs.org` (200), and the outer machine saw neither port.
   Without `-t none …`, pasta publishes a lane's listening port on the outer
   machine and maps it into the next lane, so the second lane's `:5173`
   failed. Without `--runas 0`, pasta drops to `nobody` and cannot open the
   lane's user namespace. pasta forks into the background: stop it through
   `-P <pidfile>`. A lane's root needs a `resolv.conf`; the outer one
   (`nameserver 192.168.64.1`) works through pasta. slirp4netns also worked
   (200).
3. **Own processes:** not inside a lane. A pid namespace starts, but a fresh
   `/proc` is refused ("VFS: Mount too revealing"), because the outer
   `/proc` has paths masked over it. podman and crun fail on the same mount.
   The probe lane bound the outer `/proc` instead, so `ps` in it listed the
   outer machine's processes. On a Linux host whose `/proc` is not masked,
   this restriction does not apply (not run).
4. **Running a command in a lane:** a holder process in the lane's
   namespaces, joined with `nsenter -U -m -n -u -i --preserve-credentials`.
   This took 1 ms a command (20 runs) and 9 ms the first time. S39 measured
   `container exec` at 50–70 ms.
5. **A whole lane by hand** (`unshare -Urmnui`, then `pivot_root`):
   - an image's root as an overlay (Alpine, built by podman, below);
   - `/workspace` as an overlay over a copy of this repo;
   - the working copy bound read-only at `/mnt/host-working-copy`.

   A write there failed ("Read-only file system"), and so did
   `mount -o remount,rw`: a mount a user namespace inherits stays locked.
   The lane's edit to `package.json` reached only its upper layer.
6. **Images:** `podman build --isolation chroot` built a Containerfile with a
   `RUN apk add git` step (1 s), and `podman create` with `podman export`
   gave its root. `podman run` failed: netavark needs a writable
   `/proc/sys`, and crun a fresh `/proc` (item 3).
7. **Limits:** `mkdir` under `/sys/fs/cgroup` works, with the cpuset, cpu,
   io, memory and pids controllers.

### Disks

8. **btrfs:** not in the lane kernel, nor in `apple/containerization`'s
   `kernel/config-arm64` (read from source). An image cannot bring it: an
   image holds only user-space files, and every container on the Mac boots
   the one kernel `container` is set to, which loads no modules. This is a
   choice of kernel, not a limit of Linux: `container system kernel set
   --binary` takes another kernel (`apple/container`
   `docs/command-reference.md`), for every container on the Mac, but nobody
   here has built one. A Linux host's containers use its own kernel, and
   Debian's and Ubuntu's include btrfs (not run).
9. **xfs with reflink:** `mkfs.xfs -m reflink=1` and `losetup` work. Mounting
   is refused, both directly and from a user namespace, because disk
   filesystems need `CAP_SYS_ADMIN`. Read from source:
   - a volume's `format` in its `entity.json` is passed to the guest as the
     mount type (`apple/container`
     `Sources/Services/RuntimeLinux/Server/RuntimeService.swift`,
     `.volume(_, let format, …)` → `.block(format: …)`);
   - `container` itself formats only ext4 (`VolumesService.swift`).

   So a host that writes an xfs image into a volume, as `packages/lanes/disk.ts`
   already writes clones, would give a lane an xfs `/workspace`, where
   `cp --reflink` needs no privilege. Not run. `container run --cap-add
   CAP_SYS_ADMIN` exists (`trim` in `packages/lanes/disk.ts` uses it). In a
   lane it would allow mounting, but whether a read-only virtiofs mount then
   holds is unmeasured.
10. **overlayfs layers as a lane's disk** (this repo: 388 MB, 37,985 files):
    - 60 branch generations, each freezing the last upper layer under the
      next: the mount at depth 61 took under 1 ms. Every file read through
      61 layers took 249 ms, and a walk of every path took 60 ms (62 ms on
      plain ext4).
    - The layers must be passed one per `lowerdir+=` option. A single
      colon-separated `lowerdir=` refused more than 20 layers; with
      `lowerdir+=`, 201 layers mounted.
    - A user namespace's overlay needs `userxattr`. Without it, deleting a
      directory from a lower layer failed with EIO.
    - `rename(2)` of a directory from a lower layer fails with EXDEV
      (`redirect_dir` is not allowed unprivileged), so `mv` copies it:
      1,032 ms for `node_modules` (337 MB), all of it then in the upper
      layer. A file, or a directory the lane made itself, renames normally.
      A tool that renames a lower directory without a fallback fails.
    - Writing one byte into a 200 MB lower file copies the whole file up:
      198 ms, 201 MB in the upper layer.
    - Whiteouts are `0,0` character devices in the upper layer.
11. **Plain copies, for scale** (ext4, page cache warm): `cp -a` of the repo
    took 645 ms; `cp -al` (hard links, metadata only, the floor for a reflink
    copy of the tree) took 253 ms.

## What this means

- On Linux, a lane can be namespaces, a holder process and `nsenter`, with
  pasta for its network. Inside a pine·trie lane this works except for its
  own `/proc`.
- On Linux, podman can build a lane's image (`--isolation chroot`), but
  cannot run it inside a lane.
- None of these options is copy-on-write at the disk level inside a lane:
  - overlay layers work unprivileged now, at the costs in item 10;
  - xfs reflinks need the Mac host to hand the lane an xfs volume (item 9,
    unmeasured);
  - btrfs needs a kernel built with it in place of the one `container`
    boots now.
- For a repo of this size, a plain copy (0.65 s) takes about as long as
  S40's APFS clones into a volume (median 266 ms, max 589 ms), but shares no
  blocks: each lane pays its disk in full. Per-lane overlay layers may not
  be worth their costs.
