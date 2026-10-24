# ADR-0207 — a project's base is made in a scratch lane named by the project's key

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `packages/lanes/TECHNICAL.md`, `packages/docker/TECHNICAL.md`
- **Evidence:** S305
- **Amends:**
  - ADR-0205: the runtime's containers part names its project's base lane
    (`baseLane`), from the project's key.
- **Revised:**
  - 2026-10-23 (ADR-0210): the Mac's slot sweep stops what it finds and
    removes nothing, so an old `pinetrie-base-scratch` there is stopped, and
    removed with its project's folder or by hand, as on Linux.

**Context.** The base snapshot is made in a scratch lane that is no
thread's. Its name was the constant `base-scratch`, so its container was
`pinetrie-base-scratch` on every host sharing a Docker engine. A build
begins by removing whatever holds its scratch lane's name, in case a
stopped host left one. With two projects on one engine, a second host's
build therefore deleted the first's container mid-build, and two builds
at once collided: S305 ran ten `e2e:lanes` scenarios as processes, and
each that built a base failed with "the container name
/pinetrie-base-scratch is already in use". A thread's lane never collided,
since its id is unique everywhere. Disks and snapshots never collided
either: lanehost keeps them under the project's own directory
(`projects/<key>/`).

**Decision.**

- **A base's scratch lane is named by its project's key**:
  `baseLane(key)` is `base-scratch-<key>` (`packages/lanes/spec.ts`), the
  key being the runtime's (Docker's `projectKey`, a hash of the project's
  root). So its container is `pinetrie-base-scratch-<key>`, and its disk is
  named the same, under the project's directory.
- **The runtime gives it** (`LaneRuntime.baseLane`): the runtime is what
  knows the project's key and the machine its names are shared on. The
  base's build uses the runtime's base lane for its removal, its disk, its
  container and its snapshot, so no caller can name another project's.
- **A host that dies mid-build leaves its own scratch lane**, which its
  project's next build removes first, as before. A project has one host
  at a time (the session store's lock), so nothing else uses that name.

**Consequences.**

- Hosts of different projects build bases on one engine at once, and a
  suite's scenarios can each build theirs in a process of their own.
- **What an older install leaves.** The old `pinetrie-base-scratch`
  container, and a disk named `base-scratch` in a project's directory, are
  left only by a host that stopped mid-build: the build removed both in
  every other case. No code names them now (no backwards compatibility).
  On the Mac, the slot's sweep at the next lease stops the container, as
  every container bound under the slot. On either machine, the startup
  sweep removes it, and the disk, once its project's folder is gone; until
  then `docker rm -f pinetrie-base-scratch` removes the container. A leftover
  disk is a copy-on-write subvolume, and is removed with its project.
  `pinetrie tidy` tidies your repo and touches neither.

**Alternatives rejected.**

- **Prefix every lane container with the project's key.** A thread's id
  is already unique on any machine. Renaming every container would orphan
  each running lane's container at the update, for no collision fixed.
- **Leave the base lane's name constant, and name only its container
  from the key.** `laneContainer` takes a lane owner alone, and the disk,
  container and snapshot of a lane are named by one value everywhere
  else. One owner per project keeps that rule.
- **A sweep that removes the old name.** It would be code beside the new
  for a leftover only a crash makes, and the sweeps above remove it.
