# ADR-0169 — A nested lane's inner Docker is a clone of the one that ran last, taken at each fork and each run's start; a host that builds an image removes pine·trie's images it does not need that nothing uses, and the daemon caps the cache left beside them

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `packages/docker/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`, `apps/pinetrie/e2e/TECHNICAL.md`
- **Evidence:** S232, S233, S234, S235, S236, S237
- **Amends:**
  - ADR-0130: a nested lane's inner Docker keeps its data root on a subvolume
    of its own, cloned from the project's nested lane that ran last, not made
    empty.
  - ADR-0121: a nested lane's guidelines name a second note, on the Docker it
    runs, which only a nested lane is pointed to.
- **Revised:**
  - 2026-10-18 (S236): the data root is cloned at each run's start too, from
    the nested lane whose run ended last, since lanes that each rebuild after
    an image change share nothing.
  - 2026-10-18 (S234): the cache cap is the daemon's, sized for the cache
    beside the images, which is all it counts; it acts once the older tags are
    gone, at the next build.
  - 2026-10-18 (S235): the host's sweep also removes containers whose project
    lanehost does not list, which is what a clone carries.
  - 2026-10-18: a nested lane is told what its inner Docker is, in a note its
    guidelines point to, and pine·trie's suites doc says what a change to
    pine·trie's own images costs its nested lanes.
  - 2026-10-18: a host removes the images of pine·trie's it does not need, not
    the older ones of a kind, since pine·trie's default lane image and a
    project's own share one repository; and the sweep takes only containers
    whose disks are in its own lanes directory.
  - 2026-10-18: the lane that ran last is named when its container stops, not
    when its run ends; and a lane to clone from whose data root has gone is no
    source, so a lane keeps its own.

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
- **Lanes that rebuild apart end up apart** (S236). Three clones of one
  data root, each building the lane image after an early change and
  dropping the older version, shared only the base image's layers
  (568 MiB) and held 2.0 to 3.1 GiB each of their own: the build's steps
  are not reproducible, so the same Containerfile gives other bytes in
  each lane. A clone of a lane that already had the version held 232 KiB.
- **The daemon's cache collection is on, but never acts in a lane**
  (S234). Its limits default to fractions of the disk, which for a nested
  lane is the lane VM's whole data disk (215 GiB max used on 288). It
  counts and removes only cache records no image uses, least recently used
  first, a minute after each build and at no other time. A cap of 512 MB
  took a lane's cache beside its current image from 1.58 GB to 265 MB, and
  a late change to the Containerfile still built from cache.
- **A host's startup sweep removes only containers of projects lanehost
  lists** whose root is gone (S235). A clone of `docker/` alone lists none
  of its source's projects, so the containers it carries would stay.
- **Only the host that builds an image knows which tag is current.** The
  tag is computed from what that host's checkout holds; another host on
  the same Docker (a slot of the lane VM, a suite's throwaway host) may
  hold another.
- **One repository holds two lane images.** pine·trie's default lane image
  and a project's own (`pinetrie.Containerfile`) are both tagged
  `pinetrie-lane:<hash>` (`planImages`). A project with its own needs both:
  its lanes run its own, and the lane runtime is copied out of the default
  one (`prepareImages`' `runtimeFrom`), from which no lane's container is
  made.
- **A Docker may hold more than one lanes directory's containers.** On
  Linux a host's lanes directory is under the person's `XDG_STATE_HOME`;
  another person on the same Docker, or a host given another state
  directory, has its own, which this host's lanehost does not list.

**Decision.**

- **A host that builds an image removes pine·trie's images it does not
  need that no container uses,** at once after the build. What it needs is
  one set of tags, every image it built or found for its lanes (the lane
  image its lanes run, the default lane image the runtime comes from, the
  lanehost and observer images), planned in one place. What it may remove
  is a tag of a repository pine·trie names (`pinetrie-lane`,
  `pinetrie-lanehost`, `pinetrie-observer`) that is not in that set and
  that no container, running or stopped, was made from. The removal is a
  value planned from those three inputs, so no tag the host needs can be
  in it, whatever repository it shares. Docker refuses to remove an image
  a container uses, and that refusal is what spares another host's: a
  host on the same Docker with lanes made has containers holding its tags.
  The rule is the same code wherever a host runs, so a nested lane's own
  host prunes its inner Docker by it.
- **A daemon pine·trie runs caps the cache beside its images.** The lane
  image's rootless daemon and the lane VM's dockerd set `builder.gc` in
  their `daemon.json` (the rootless one beside the runtime settings already
  there): `defaultMaxUsedSpace` 512 MB, `defaultReservedSpace` 256 MB,
  `defaultMinFreeSpace` 1 GB. The cap counts only what no image uses, so it
  keeps what a late change builds from and removes the older versions'
  records once their tags are gone: the removal comes at once after a
  build, inside the minute before the daemon's collection. A person's own
  Docker, on Linux, keeps its own policy: pine·trie removes only its tags
  there.
- **A nested lane's inner Docker data root is a subvolume of its own,**
  at the same path inside the lane (`/var/lib/pinetrie-lanes/docker`), so
  it can be cloned without the inner lanehost's projects beside it.
- **Its data root is a clone of the one that ran last.** The host keeps,
  per project and in memory, the nested lane whose run ended last: the
  lane whose container stopped last after a run. After a host's start
  there is none until a run ends.
  - **At a fork,** the new lane's data root is a clone of the last run's
    lane's, else of the lane whose disk the fork clones, else empty.
  - **At a run's start,** before its container starts, a lane whose data
    root is not as of the last run's lane's newest run is given a clone of
    that lane's in place of its own, which is dropped. The lane's
    container is stopped between runs, so no inner Docker runs on the
    root being replaced.
  - **A lane to clone from whose data root has gone is no source:** the
    lane keeps its own, so deleting a lane needs no bookkeeping here.

  So a version one lane builds reaches the others at their next run for
  the cost of a clone, and lanes on one version hold it once between them.
  The data root is a cache of content-addressed images, not history: a
  clone is of the source's current state, never of a fork's point, and a
  lane's turns never snapshot it. The inner lanehost's `projects/` stays
  the lane's own.
- **The host's sweep also removes containers whose project lanehost does
  not list, among those whose disks are in its own lanes directory:** what
  a clone carries of its source's inner lanes, and their networks. Which
  containers are its own is read from where their binds lie, as the slot
  sweep reads it (`sweepSlot`), not from a label, so another lanes
  directory's containers on the same Docker are never in it. The lane's own inner lanes' containers, lost with its replaced
  data root, are made again at their next start, as any missing container
  is.
- **A lane's delete drops its data root,** with the nested subvolume, as
  now.
- **A nested lane is told where to read about its Docker, and nothing
  more.** The line its guidelines already carry when the project grants
  `lanes.nested` (`laneGuidelines`) gains one clause: before building or
  running images, read the Docker note, `packages/pi/lane-docker.md`, at
  its path in pine·trie's mount. A lane without the grant is told nothing
  of it, and the grant is fixed while the host runs, so the prompt stays
  the same between requests. The note holds what is true of every nested
  lane, each fact naming its source as the lane note's do (ADR-0121):
  - the inner Docker is a cache, never snapshotted or carried into a
    branch, and at a run's start it may be replaced by a clone of the
    project's nested lane that ran last, so what `docker images` lists is
    what is there, whatever this lane built before;
  - after a build, the older tags of that image that no container uses
    are removed, and the cache beside the images is capped;
  - a tag already present builds nothing; a cold build of pine·trie's lane
    image is about 3 minutes;
  - pruning by hand gains nothing and costs the next late change a cold
    build.

  The lane note (`packages/pi/lane.md`) names the Docker note where it
  mentions `lanes.nested`, and says no more of it.
- **What a change to pine·trie's own images costs is pine·trie's own
  fact,** in its suites doc (`apps/pinetrie/e2e/TECHNICAL.md`), which an
  agent reads before working on the suites, not in `AGENTS.md`, which every
  pine·trie lane loads: `e2e:lanes` in a lane builds the lane image from
  that lane's checkout, so a change to its Containerfile or to the app's
  Playwright version gives a new tag, and the nested lanes rebuild as the
  change reaches them, alternating while some have it and some do not.
  Such changes are better made together than in many threads at once.

**Consequences.**

- **A project's nested lanes hold about one version of each image between
  them** when they run one version; each lane owns only what its runs
  write. A lane whose checkout needs another version (a WIP that changes
  the Containerfile or the app's Playwright version) builds it at its run,
  and becomes the last run's lane when that run ends: the next lane on the common
  version rebuilds it in turn. Lanes that alternate between two versions
  so rebuild at each run; a WIP that changes an image's inputs is rare,
  and its cost is a build, not the disk.
- **A run's start gains a disk operation** for a lane that is not the
  last run's lane: a clone and a drop, both by the lanehost's disks role. A fork's
  steps gain one, and a fork that stops part way runs again from the top,
  as every fork does (ADR-0167).
- **A clone may be of a lane that has started again.** The last run's
  lane is named when its container stops, so it is stopped when others
  clone it unless it has started again since; a clone taken while it runs
  is the state a power cut leaves, from which the inner Docker started in
  S233's one sample.
- **A host may find its tag gone** when another host on the same Docker
  removed it before it made a container from it. The runtime therefore
  keeps how it built each tag it needs, and when a container's create is
  refused for a missing image, builds it again and creates once more.
- **The daemon's collection once removed the current image's cache too**
  (S234, one clone of three, unexplained). Its image still ran; a late
  change after it costs a cold build, about 3 minutes of steps, and the
  clone's rebuild then holds its own copy until its next clone.
- **The Docker note and the suites doc land with the code that makes them
  true:** a note states only what holds (ADR-0121), so neither is written
  ahead of it.
- **The lane VM's dockerd reads its setting from a file the system image
  carries,** named by `--config-file` in the VM's `init`, since its root is
  read-only: a root dockerd of the VM's version applies `builder.gc` from
  such a file as the rootless one does (S237), so the cap is a change to
  the image.

**Alternatives rejected.**

- **Prune everything when a run ends.** Bounded, but every run would
  rebuild the lane image from cold, about 3 minutes, and a nested lane
  runs many times.
- **Clone at a fork only.** It saves a branch's first build, but after any
  change to the lane image every nested lane that runs builds and holds
  its own copy, 2 to 3 GiB each (S236): the disk that filled.
- **A size limit on the nested subvolume** (a btrfs qgroup). Quotas are
  slow on a filesystem holding tens of thousands of subvolumes, as the
  lane VM's did, and a build that hits the limit fails with ENOSPC, which
  an agent must make sense of. It bounds the waste without removing it.
- **Give nested lanes the outer Docker.** One copy of everything, but a
  lane would reach the daemon every other lane runs on, which rootless
  nested Docker exists to prevent.
- **Clone the whole nested subvolume.** A lane would take another's inner
  test projects, their disks and snapshots, which the folder scenarios had
  left by the thousand in two lanes (2026-10-17).
- **A warm data root the host keeps per project.** It would have to build
  images into an inner Docker for a version of pine·trie the host may not
  be running: what a lane builds is its own checkout's. The last run's lane is that,
  built by a lane that needed it.
- **Prune the build cache from the host.** `docker builder prune` removes
  the current image's records too, since none is in use between builds,
  and the next late change builds cold (S232); the daemon's cap keeps
  them.
- **Remove the older tags of the built image's repository.** pine·trie's
  default lane image and a project's own share `pinetrie-lane`, so building
  one would remove the other, which the host also needs, and the next
  start would build it again.
- **Sweep every container whose project lanehost does not list.** It would
  take another lanes directory's live containers on the same Docker.
- **A section on Docker in the lane note.** The lane note is one file for
  every lane, and most lanes run no Docker.
- **A skill the model loads when it needs it.** Its description would be
  in every lane's prompt, with or without the grant, since no lane's skills
  are chosen by its grants; and a skill is also a command people see
  (ADR-0036). pine·trie's own skills are all the host's to ask for; this
  would be the first the model chooses, for one topic.
- **The current state in the prompt** (which lane the data root came from,
  which tags it holds). The block is fixed while the host runs, so a
  lane's prompt stays the same between requests (ADR-0121); `docker
  images` answers the same question when it is needed.
- **Remove older tags at the host's start, not after a build.** A host
  that starts without building has nothing newer to keep, and may share
  the Docker with a host of the older version still running.
