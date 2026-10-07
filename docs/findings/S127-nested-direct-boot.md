# S127 — Lanes inside lanes work on the directly booted VM; a lane with CAP_SYS_ADMIN writes to the Mac through vfkit's share, which only the guest holds read-only

**Status:** Answered. No ADR yet. Follows S125 (lanes inside lanes, on Lima's Alpine) and
S126 (the VM booted directly by vfkit).

**Question.** S125 ran lanes inside an unprivileged lane on Lima's Alpine
ISO. S126 boots a smaller VM directly with vfkit: Docker answers in under a
second. That VM differs in three ways:
- its own init, in place of OpenRC;
- a btrfs data disk mounted without `user_subvol_rm_allowed`;
- a share of the working copy that vfkit cannot make read-only, so that
  only the guest's `ro` mount holds it.

On S126's kernel and first stage, with a system image whose init mounts the
data disk with `user_subvol_rm_allowed` and loads `tun`:
- Does S125's outer lane work here, under the narrow seccomp profile and
  with seccomp off? The outer lane is rootless Docker, btrfs subvolumes
  made without privilege, and inner lanes on snapshots, serving `:5173` and
  reaching npm.
- Can any lane make the working copy writable and write to the Mac? It
  tries:
  - an ordinary lane, with Docker's defaults and with `CAP_SYS_ADMIN`;
  - an outer lane, from a user namespace of its own;
  - an inner lane with `CAP_SYS_ADMIN`.

  Each tries `mount -o remount,rw` and `mount -o remount,bind,rw`, then a
  write.

**Kill criterion.** The outer lane cannot run inner lanes here, or a lane
that pine·trie would start (no `CAP_SYS_ADMIN`; the narrow profile for a
lane that runs lanes) writes to the Mac.

**Throw away.** The data disk, which the script deletes, and the probe's
folder (`s127-nested/` in the shared plans folder): the kernel and first
stage copied from S126, the rebuilt system image, the init, the seccomp
profile, the script and its results.

## How it ran

Duane ran the script on the Mac twice (macOS 26.7.1, vfkit 0.6.4, docker CLI
29.8.1). The VM was S126's kernel (6.18.55-0-virt) and first stage, with a
system image rebuilt in a lane from S126's. Its init mounted the data disk
with `user_subvol_rm_allowed` and loaded `tun`. The VM had 4 CPUs and
8 GiB, and the working copy shared by virtio-fs and mounted `ro` by the
guest. The outer lane's image was S125's (`docker:dind-rootless` with
`btrfs-progs`, and runc's `NoNewKeyring` by default), with `util-linux`
added for `unshare`. The seccomp profile was rebuilt from Docker's current
default as in S125.

- **Run 1:** rootless Docker did not start in either outer lane.
  slirp4netns failed to add its tap device, after "open: Permission denied"
  on `/dev/net/tun`. Without udev, the kernel makes `/dev/net/tun` mode
  0600, and the outer lane runs as uid 1000; on Lima's Alpine, udev made it
  0666. Run 1's working-copy check with `CAP_SYS_ADMIN` printed a mount of
  the VM's own root (`lowerdir=/ro,upperdir=/rw/upper`) in place of the
  share's, so it is not counted.
- **Run 2:** the init also ran `chmod 666 /dev/net/tun`. Each working-copy
  check printed the lane's mount and files before and after each attempt,
  and the VM's own mount after. The numbers below are run 2's.

## Answers

1. **Boot:** Docker answered on the Mac 1,034 ms after vfkit started.
2. **Lanes inside lanes work here,** under both the narrow profile and
   seccomp off, each with `systempaths=unconfined` and `/dev/net/tun`:

   | | narrow profile | seccomp off |
   |---|---|---|
   | rootless Docker up in the outer lane | 16.2 s | 16.5 s |
   | btrfs as uid 1000: create, snapshot, delete; snapshots are subvolumes (inode 256) | yes | yes |
   | inner lane's write in its own snapshot only | yes | yes |
   | inner lane sees no `/var/run/docker.sock`, `/lanes` or `/var/lib/lanehost` | yes | yes |
   | two inner lanes each serving `:5173` and reaching npm | yes | yes |
   | first inner `docker run` / later ones | 106 / 99 ms | 94 / 88 ms |
   | `exec` into the outer lane / into an inner lane through it | 30 / 51 ms | 20 / 41 ms |

3. **Can a lane make the working copy writable?** Each lane bound it at
   `/mnt/host-working-copy`, tried `mount -o remount,rw` and then
   `mount -o remount,bind,rw`, then wrote a file:

   | lane | remount | write | reached the Mac |
   |---|---|---|---|
   | ordinary, Docker's defaults, `:ro` | refused ("permission denied") | "Read-only file system" | no |
   | ordinary, `--cap-add SYS_ADMIN`, `:ro` | **succeeded: the lane's mount became `rw`** | succeeded | **yes** |
   | ordinary, `--cap-add SYS_ADMIN`, bound without `:ro` | succeeded | succeeded | **yes** |
   | outer lane, from its own user namespace (both profiles) | refused | "Read-only file system" | no |
   | inner lane with `--cap-add SYS_ADMIN` (rootless Docker's) | refused | "Read-only file system" | no |

   After every check, the VM's own mount still read `virtiofs ro`. A lane
   with `CAP_SYS_ADMIN` in the VM's Docker reaches the Mac without changing
   it. Neither an outer lane, from its own user namespace, nor an inner
   lane, whose `CAP_SYS_ADMIN` is only in rootless Docker's user namespace,
   could remount: a mount inherited into a user namespace stays locked
   (S132 item 5).
4. **vfkit cannot share a directory read-only.** Its virtio-fs device calls
   `vz.NewSharedDirectory(dev.SharedDir, false)` (`crc-org/vfkit`,
   `pkg/vf/virtio.go`, read from source): the second argument is
   Virtualization.framework's read-only flag, always false. Its virtio-blk
   and USB storage devices take `readonly`. Under Lima, the same remount in
   S123 left the write failing ("Operation not permitted"), which fits a
   share made read-only on the Mac's side. Lima's source was not read.

## What this means

- **Kill criterion:** not met for the lanes pine·trie would start. Lanes
  inside lanes work here, and no lane without `CAP_SYS_ADMIN` in the VM's
  Docker wrote to the Mac.
- **With vfkit, the guest's `ro` mount is the only thing between a lane and
  the working copy.** A lane given `CAP_SYS_ADMIN`, or `--privileged`, by
  the VM's Docker writes to the Mac. A share that the Mac makes read-only
  (`readOnly: true` on the shared directory) would hold even then: a launcher
  of our own on Virtualization.framework, or vfkit with that one argument
  exposed.
- **An init without udev must set what udev did:** `/dev/net/tun` 0666, for
  rootless Docker in a lane.
- **Rootless Docker takes about 16 s to start in a lane,** here as on Lima
  (S125). That is a cost each time `e2e:lanes` starts its outer lane. Where
  the time goes was not measured.
