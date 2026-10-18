# ADR-0169 — A nested lane's inner Docker starts as a clone of the one its fork came from, and a host that builds an image removes the older ones of its kind that nothing uses

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `packages/docker/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`
- **Evidence:** S232, S233
- **Amends:**
  - ADR-0130: a nested lane's inner Docker keeps its data root on a subvolume
    of its own, cloned from the one its fork came from, not made empty.

**Context.**

- **The lane VM's data disk filled on 2026-10-17,** and nothing could free
  it: dockerd could not start on a full disk, so no host got a lease, and
  no shell reaches the guest. Of its 256 GiB, about 107 GiB was the inner
  Docker of 79 nested lanes, 3.7 to 12.7 GiB each; about 32 GB was the VM's
  own Docker.
- **A nested lane's inner Docker is made empty and never pruned.** Its data
  root is `docker/` on the lane's nested subvolume, which `planNestedDisk`
  makes, beside the inner lanehost's `projects/`. Each new nested lane
  builds pine·trie's lane image from cold: about 3 minutes, and 3.2 GB on
  disk for a 1.93 GB image, since containerd's image store keeps the build
  cache as well (S232).
- **Images stack.** Every image pine·trie builds is tagged by a hash of its
  inputs (`planImages`, the lanehost image's Containerfile, the observer's
  version), and nothing removes an older tag. A change early in the lane
  image's Containerfile adds about 2.6 GB to every lane that builds it
  (S232). The VM's own Docker held 9 `pinetrie-lane` tags and 28
  `pinetrie-observer` tags, for the same reason.
- **A clone of an inner Docker's data root runs** (S233). On a btrfs
  snapshot of another lane's data root, rootless Docker starts with its
  images and build cache, runs and builds; the two share everything but
  what each then writes (under 1 MB each after a run and a cached build).
  A clone taken while the source's Docker ran a container also started,
  having removed the half-run container: one sample.
- **Only the host that builds an image knows which tag is current.** The
  tag is computed from what that host's checkout holds; another host on
  the same Docker (a slot of the lane VM, a suite's throwaway host) may
  hold another.

**Decision.**

- **A host that builds an image removes the older ones of its kind that no
  container uses.** After a build that made a new tag, the host removes
  every other tag of that image's repository (`pinetrie-lane`,
  `pinetrie-lanehost`, `pinetrie-observer`, a project's own lane image)
  that no container, running or stopped, was made from. Docker refuses to
  remove an image a container uses, and that refusal is what spares
  another host's: a host on the same Docker with lanes made has
  containers holding its tag. The rule is the same code wherever a host
  runs, so a nested lane's own host prunes its inner Docker by it.
- **A daemon pine·trie runs bounds its own build cache.** The lane VM's
  dockerd and a nested lane's rootless dockerd are configured with
  BuildKit's garbage collection kept to about one cold build of the lane
  image, least recently used dropped first. The cache is what makes a late
  change to a Containerfile cheap (S232), so it is bounded, not removed.
  How the daemon's setting behaves under Docker 29 is not yet measured. A
  person's own Docker, on Linux, keeps its own policy: pine·trie removes
  only its tags there.
- **A nested lane's inner Docker data root is a subvolume of its own,**
  at the same path inside the lane (`/var/lib/pinetrie-lanes/docker`), so
  it can be cloned without the inner lanehost's projects beside it.
- **A fork clones it** from the lane whose disk the fork clones, as it is
  when the fork runs. A fork from the base snapshot (a new root's lane)
  clones the project's nested lane whose run ended last, so a new root
  starts warm too; a project with none starts empty. The data root is a
  cache of content-addressed images, not history: the clone is of the
  source's current state, not of the fork's point, and a lane's turns
  never snapshot it.
- **A lane's delete drops it,** with the nested subvolume, as now.

**Consequences.**

- **Each lane holds about one version of each image,** and a new lane or
  branch costs only what it then builds. Lanes cloned from one source share
  its blocks until each rebuilds: after a change to the lane image, every
  lane that builds it holds its own copy of the new version (about 2.6 GB
  for an early change), until a fork clones from one that has it. How much
  that comes to across many lanes was not measured.
- **A host may find its tag gone** when another host on the same Docker
  removed it before it made a container from it. Making a lane's container
  therefore ensures its image first (`ensureImage`), building it again if
  missing, not only at setup.
- **A clone carries the source's inner containers,** whose binds name the
  source's inner projects, which are not cloned. The host's sweep of
  projects whose root is gone is expected to remove them at the inner
  host's start, as it does a suite's throwaway projects; that it runs in a
  nested lane is not measured.
- **The lanehost's disks role gains a clone of a nested data root,** and
  the fork's steps one more disk operation; a fork that stops part way
  runs again from the top, as every fork does (ADR-0167).
- **A late change after a cache eviction costs a cold build,** about 3
  minutes of steps for the lane image (S232).

**Alternatives rejected.**

- **Prune everything when a run ends.** Bounded, but every run would
  rebuild the lane image from cold, about 3 minutes, and a nested lane
  runs many times.
- **A size limit on the nested subvolume** (a btrfs qgroup). Quotas are
  slow on a filesystem holding tens of thousands of subvolumes, as the
  lane VM's did, and a build that hits the limit fails with ENOSPC, which
  an agent must make sense of. It bounds the waste without removing it.
- **Give nested lanes the outer Docker.** One copy of everything, but a
  lane would reach the daemon every other lane runs on, which rootless
  nested Docker exists to prevent.
- **Clone the whole nested subvolume.** A branch would inherit its
  parent's inner test projects, their disks and snapshots, which the
  folder scenarios had left by the thousand in two lanes (2026-10-17).
- **A warm data root the host keeps per project.** It would have to build
  images into an inner Docker for a version of pine·trie the host may not
  be running: what a lane builds is its own checkout's.
- **Remove older tags at the host's start, not after a build.** A host
  that starts without building has nothing newer to keep, and may share
  the Docker with a host of the older version still running.
