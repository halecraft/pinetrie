# S123 — Alpine in Lima runs lanes on btrfs snapshots end to end, with a seventh of Ubuntu's disk and less memory, but boots no faster

- **Status:** Answered
- **Led to:** ADR-0102, ADR-0103, ADR-0130

Follows S122.

**Question.** S122 ran lanes in Colima's Ubuntu 24.04 VM (316 MB download,
20 s boot). Its AppArmor setting was one of the three layers that blocked
lanes inside lanes. Can Alpine, in Lima without Colima, do the same with
less? Lima's own Alpine ISO is 102 MB, and Docker adds about 55 MB of
packages. Read from the ISO before running:
- its kernel 6.18 `virt` has btrfs, overlayfs, virtiofs and vsock as
  modules;
- AppArmor is compiled in but not in `CONFIG_LSM`, so it is off.

The run answers:
- how fast it boots, the first time and again;
- how much memory it holds when idle, against Ubuntu's;
- whether Docker installs at first boot;
- whether the design works end to end: a btrfs volume in the VM, the repo in
  a base subvolume, a snapshot of it bind-mounted into an unprivileged lane
  as `/workspace`, and a branch taken while that lane runs;
- whether lanes inside lanes work without privilege once Docker's seccomp
  profile and masked paths are relaxed.

**Kill criterion.** Alpine boots no faster than Ubuntu and uses no less
memory, or a snapshot cannot be a lane's `/workspace`, or a lane can reach
another lane's disk or write the working copy.

**Throw away.** The VMs `pinetrie-alpine` (Lima) and `pinetrie-probe`
(Colima) with their disks, which the script deleted, and the script and its
results (`s123-probe/` in the shared plans folder).

## How it ran

Duane ran a script on the Mac (macOS 26.7.1, arm64) with Lima 2.2.0, Colima
0.10.3 and the docker CLI 29.8.1. Both VMs had the same configuration:
`vz`, virtiofs, 4 CPUs, 8 GiB memory, 40 GiB disk, and only the repo mounted,
read-only. The Lima VM used `template:_images/alpine-iso`, with a provision
script that installs `docker`, `btrfs-progs`, `bash` and `coreutils` with
`apk` on every boot. The repo copied in was the working copy without
`.pinetrie`, `.jj` and `.git`: 816 MB, 30,215 files. One run, all of it
completed.

## Answers

1. **The two VMs side by side:**

   | | Alpine 3.23 in Lima | Ubuntu 24.04 in Colima |
   |---|---|---|
   | kernel | 6.18.26-0-virt | 6.8.0-117-generic |
   | active security modules | lockdown, capability, landlock | lockdown, capability, landlock, yama, **apparmor** |
   | create and first boot, Docker ready | 26.5 s (the ISO's download included unless cached; Docker installed) | 20.3 s (image cached from S122) |
   | boot again | **16.0 s** | **14.8 s** |
   | guest memory used, idle with Docker | 152 MB, plus **329 MB** of root filesystem in RAM (tmpfs; shown as `shared`) | 335 MB |
   | memory the VM holds on the Mac (RSS of the `Virtualization.VirtualMachine` processes, before and after) | **1,293 MB** | **1,864 MB** |
   | space on the Mac | **157 MB** | **1.1 GB** (plus a 6.1 MB data disk) |
   | `docker run -d` / `rm -f` / `exec` | 74 / 58 / **27 ms** | 83 / 83 / 32 ms (S122) |

   - Alpine does **not** boot faster. A guess that its restart reinstalls
     Docker, since the ISO's root is in RAM, proved wrong: S124 found
     Docker still installed on the second boot, and the time spent before
     ssh answers.
   - `limactl shell` takes 27 ms a round trip.
   - Both have btrfs and xfs as modules that `modprobe` loads; both run
     Docker 29.5.2 on cgroup v2.
2. **The design works end to end.** The setup:
   - a 30 GB sparse file in the VM's `/var/lib`, formatted btrfs and
     mounted at `/lanes`;
   - the repo streamed into the base subvolume through `limactl shell`
     (4.0 s);
   - `sync` (0.40 s), then a snapshot of the base as `lane1` (3 ms);
   - an **unprivileged** container (`-m 2g`) with `-v
     /lanes/lane1:/workspace`.

   What it showed:
   - The lane's write reached `lane1`, and not the base.
   - A branch of `lane1`, taken while its lane ran, took 2 ms and had the
     lane's file.
   - A second lane on that branch wrote a file that `lane1` did not see.
   - In the lane, writes and **renaming a directory** worked. S132 found
     overlay's rename fails.
   - Deleting a snapshot took 1 ms.
   - All the lanes together shared 741.57 MiB.
3. **A lane cannot reach other lanes' disks.** `/lanes` does not exist in it,
   and mounting the btrfs device was refused. But `df` in a lane shows the
   whole volume (30 G, 816 M used), because btrfs subvolumes have no size of
   their own unless qgroups set one. Not tried.
4. **Ports:** two lanes each served `:5173` and reached npm, and both answered
   on the Mac through ports published on `127.0.0.1`, as in S122.
5. **The working copy stays read-only, but only at the VM level on Alpine.**
   - Without privileges, a write failed ("Read-only file system").
   - With `--cap-add SYS_ADMIN`, `mount -o remount,rw` **succeeded** in the
     container. Alpine runs no AppArmor, which refused this on Ubuntu (S122
     item 7).
   - The write then still failed ("Operation not permitted"), because
     Lima's own virtiofs mount is read-only (`writable: false`). Nothing
     reached the Mac.

   A lane must never get `CAP_SYS_ADMIN`, and the VM's mount must stay
   read-only.
6. **Lanes inside lanes, unprivileged:**

   | Docker's settings | `unshare -Urm` | overlay in a namespace | own `/proc` |
   |---|---|---|---|
   | default | refused (seccomp) | — | refused |
   | `seccomp=unconfined` | ok | refused: upper layer on the container's overlay root | refused (masked paths) |
   | `seccomp=unconfined`, `systempaths=unconfined` | ok | refused, the same | **ok** |

   Ubuntu's third block, the AppArmor user-namespace restriction (S122 item
   8), does not exist here. Overlay refused `/tmp` as an upper layer because
   the container's root is itself overlayfs. An upper layer on the lane's
   btrfs `/workspace`, or a tmpfs, was not tried. A seccomp profile that
   allows only `unshare` and `clone` with new namespaces was not tried
   either, in place of turning seccomp off.
7. **Docker inside Docker, privileged:** a nested container ran in 1.5 s.

## What this means

- **Kill criterion:** not met.
  - Alpine boots no faster (16.0 s against 14.8 s), but holds 571 MB less
    on the Mac and takes a seventh of the disk.
  - A snapshot works as a lane's `/workspace`, including a branch of a
    running lane.
  - No lane reached another's disk or wrote the working copy.
- **The design pine·trie would build on:** one VM, Docker, a btrfs volume of
  lane subvolumes, a snapshot per branch. It costs 2–3 ms a branch and 27 ms
  a command.
- **Alpine's ISO keeps its root in RAM** (329 MB). Alpine's cloud image
  (224 MB download, a root on disk) or our own image with Docker built in
  might boot faster and hold less. S124 measured both: each holds about
  120–150 MB less on the Mac, but boots in 27 s against the ISO's 15 s.
- **Without AppArmor, the read-only working copy rests on Lima's mount
  alone,** plus lanes never getting `CAP_SYS_ADMIN`. On Ubuntu, AppArmor
  was a second guard.
- **Lanes inside lanes without privilege** look possible on Alpine:
  `seccomp` relaxed for namespaces, `systempaths=unconfined`, and overlay
  upper layers off the container's root. Not shown end to end.
