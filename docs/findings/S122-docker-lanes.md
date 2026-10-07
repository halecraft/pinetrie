# S122 — Docker in a Colima VM can run lanes on the Mac: btrfs snapshots branch a lane in 2 ms, `docker exec` takes 32 ms, but lanes share one kernel and the Mac reaches them only through published ports

**Status:** Answered. Follows S132. No ADR yet.

**Question.** Could Docker run lanes on the Mac, given that it already runs
on Linux, so that one lane runtime serves both? In a Colima VM:
- Does its kernel have btrfs?
- What does branching a lane cost: a btrfs snapshot, and `docker commit`
  (how long, and how many generations deep)?
- How fast is `docker exec`?
- Can two lanes serve `:5173` at once, and can the Mac reach a lane by its IP?
- Does a read-only mount of the working copy hold, even with
  `CAP_SYS_ADMIN`?
- Can a lane run lanes of its own?

**Kill criterion.** A branch takes more than about a second for this repo, or
a lane can write the working copy, or `docker exec` is much slower than
`container exec` (S39: 50–70 ms).

**Throw away.** The Colima VM `pinetrie-probe`, its data disk and images,
which the script deleted, and the script and its results (`s122-probe/` in
the shared plans folder). Nothing reached the repo.

## How it ran

Duane ran a script on the Mac (macOS 26.7.1, arm64), written by an agent in a
lane, which has no Docker. It used Colima 0.10.3 with the docker CLI 29.8.1,
and one VM: `--vm-type vz --mount-type virtiofs`, 4 CPUs, 8 GB. The VM saw
only the repo, mounted read-only. The script ran three times. The first two
failed partly, because of bugs in the script:
- run 1 copied `.pinetrie/`, the lane disk images (1.8 TB apparent), and
  filled the VM's disk;
- run 2 found containers left over from run 1, because `colima delete` keeps
  the VM's data disk unless it is given `--data`, and it used
  `docker commit -q`, a flag that does not exist.

The numbers below are from run 3 unless they say otherwise. The repo copied
in was the working copy without `.pinetrie`, `.jj` and `.git`: 816 MB,
30,212 files.

## Answers

1. **The VM:** Ubuntu 24.04.4, kernel 6.8.0-117-generic. Docker 29.5.2 on
   cgroup v2, storing container files with containerd's snapshotter on
   overlayfs. The VM started in 20 s (44 s the first time, which included
   downloading its image).
2. **btrfs and xfs** are modules: neither is in `/proc/filesystems` at boot,
   and `sudo modprobe` loads both. So, unlike under Apple's `container`
   (S132 item 8), no custom kernel is needed.
3. **Branching with btrfs.** This ran in a privileged helper container, on
   a btrfs filesystem in a loop-mounted 20 GB sparse file:

   | step | time |
   |---|---|
   | untar the repo into a subvolume | 1.01 s |
   | `sync` | 0.33 s |
   | snapshot it (a branch) | 2 ms |
   | snapshot it again | 2 ms |
   | 20 generations, each a write then a snapshot of the last | 44 ms in all |
   | walk every path at generation 21 | 39 ms |
   | delete a snapshot | 1 ms |

   The 21 snapshots share 741.55 MiB (`btrfs filesystem du`: 15.93 GiB
   total, 0 exclusive). In run 2, without the `sync`, the first snapshot
   took 0.34 s: it paid for writing out the copy.
4. **Branching with `docker commit`:**
   - 130 generations were reached with no failure. Each was a container run
     from the last image, a write, a commit and a removal: 1,333 ms each,
     173 s in all.
   - The image at generation 130 reported 302,238,298 bytes.
   - No layer limit was hit with the containerd snapshotter. Under overlay2,
     about 125 layers had been expected.
   - The commit's own share of the 1.3 s was not measured apart.
5. **Containers:**

   | step | time |
   |---|---|
   | `docker run -d` | 83 ms each (10 runs) |
   | `docker rm -f` | 83 ms each |
   | `docker exec` | **32 ms** each (20 runs) |
   | Apple's `container exec`, on the same Mac | 64 ms (run 3), 69 ms (run 2) |
   | stream the repo into a container with `tar` | 3.5 s (833 MB there) |

6. **Ports:**
   - Two containers each served `:5173` (Python's `http.server`), answered
     on `127.0.0.1:5173` inside, and reached `registry.npmjs.org`.
   - The Mac could not reach either by its bridge IP (172.17.0.3 and
     172.17.0.4 timed out).
   - Both answered when published on the Mac's loopback
     (`-p 127.0.0.1:1517n:5173`), with 200.
   - In run 2, `wget localhost` was refused, most likely because busybox
     tried `::1` while the server listens on IPv4.
7. **The working copy stays read-only, at two levels.** In the container,
   writing to the `:ro` bind mount failed ("Read-only file system"), and so
   did `mount -o remount,rw`, refused even with `--cap-add SYS_ADMIN`
   ("Permission denied": Docker's AppArmor profile). The VM's own mount is
   read-only too: Colima's `--mount` without `:w`. Nothing reached the Mac.
8. **Lanes inside a lane, unprivileged: no.** S132's way (`unshare -Urm`)
   failed at a different layer each time a layer was relaxed:
   - with Docker's default security: `unshare` → Operation not permitted
     (seccomp);
   - with `seccomp=unconfined`: "cannot change root filesystem propagation:
     Permission denied" (AppArmor);
   - with `apparmor=unconfined` as well: "write failed /proc/self/uid_map:
     Operation not permitted". The VM's
     `kernel.apparmor_restrict_unprivileged_userns` is 1, Ubuntu's default.

   Setting it to 0 in the VM was not tried.
9. **Docker inside Docker, privileged: yes.** A `docker:dind` container
   started, and a container inside it ran in 1.7 s, including pulling
   `alpine`.

## What this means

- Measured against the kill criterion:
  - a branch is far under a second (2 ms with btrfs; `docker commit` is
    slower, 1.3 s with a run and a removal);
  - no lane could write the working copy;
  - `docker exec` took half of `container exec`'s time.

  Docker in Colima passes all three.
- Branching would be btrfs snapshots that the host takes in the VM (through
  `colima ssh` or a privileged helper), each bind-mounted into its lane as
  `/workspace`. That mounting was not run. `docker commit` works, but is
  three orders slower than a snapshot and keeps the lane's whole root, not
  just its disk.
- What is given up compared with `container` (ADR-0034):
  - one VM per lane: here every lane shares the VM's kernel;
  - an IP per lane that the Mac can reach: here a port must be published
    to reach it;
  - memory per lane: here one VM with a fixed size.
- The same Docker and btrfs commands would run on a Linux host, with no VM.
- Lanes inside lanes need privilege, or the VM's user-namespace setting
  changed: as under `container`, they do not come for free.
