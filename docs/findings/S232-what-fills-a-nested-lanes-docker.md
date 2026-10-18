# S232 — What fills a nested lane's inner Docker, and does it stack

- **Status:** Answered (the lane image stacks; its scenarios not run)
- **Led to:** ADR-0169

**Question.** A lane granted `lanes.nested` runs a rootless Docker whose
data root is on its nested disk (`nested/<lane>/docker` in the lanes
directory), made empty and never pruned. On the Mac's lane VM, 79 of them
held about 107 GiB (3.7 to 12.7 GiB each) when the data disk filled,
2026-10-17. What takes that space: images, build cache, containers or
volumes, and which ones? Does a second suite run on the same disk add to
it, and does a change to the lane's `Containerfile` leave the old image
beside the new one?

**Kill criterion.** If one suite run's images and cache are most of what a
lane holds, and a second run and an image change add little, nothing
stacks: pruning what is no longer current gains little, and the cost is the
first run's, which only sharing a warm data root across lanes (a nested
disk forked with its lane) would cut.

**Throw away.** The scratch lane: its workspace and nested disk under
`/var/lib/lanehost/spike/S232/` in the lane VM, its container, and the
leasing script in `sandbox/`.

## How it runs

In the Mac's lane VM, outside any project's directory: a container made as
the host makes a nested lane's (the lane image, the narrow seccomp
profile, `systempaths=unconfined`, `/dev/net/tun`, 4 GiB, the slot's
shares of the repo, the lane runtime, the lane's git config and Kyneta),
its `/workspace` a writable snapshot of a pine·trie lane's disk, its
nested disk a new subvolume owned by the rootless user. In it,
`pnpm run e2e:lanes`, then `docker system df -v` on the inner Docker; a
second run; then a change to the lane image's `Containerfile` and a third.

## Answers

Measured 2026-10-18 in the Mac's lane VM, as above, the workspace a
snapshot of accepted work's base (cd3486407d) after `pnpm install
--frozen-lockfile`. The inner Docker is rootless 29.8.2 with containerd's
image store, snapshotter `overlayfs`, data root
`/var/lib/pinetrie-lanes/docker`.

**The suite did not run its scenarios here.** `pnpm run e2e:lanes` in
this lane reported `pass=0 fail=0 skip=11`: a nested lane's scenarios need
a pine·trie host outside relaying the observer
(`/run/pinetrie/observer.sock`), and this lane had none. So the measure is
of the builds a run makes, done by hand with the host's own arguments
(`docker buildx build --load`, `JJ_VERSION`, `PLAYWRIGHT_VERSION`), not of
a whole run. In a nested lane the inner host loads no observer (that is
why the scenarios skip), so it builds no observer image; what the suite's
scenarios add beside the lane image (their own small images, inner lanes'
containers, which `cleanUp` removes) was not measured.

| step | inner `docker system df` | data root on disk (`du -sm`) |
|---|---|---|
| empty | nothing | 1 MB |
| the lane image, cold | 1 image 1.93 GB, cache 1.93 GB | 3,197 MB |
| a `LABEL` appended (a late change), new tag | 2 images, sharing every layer | 3,198 MB |
| `JJ_VERSION` changed (an early change: the first `RUN`), new tag | 3 images 3.52 GB, cache 3.52 GB | 5,805 MB |
| the two older tags removed | | 4,708 MB |
| `docker builder prune -f` | 1 image, cache 0 | 1,846 MB |

- **It stacks.** Every image is tagged by a hash of its inputs
  (`planImages`), nothing removes an old tag, and an early change to the
  lane image adds about 2.6 GB on disk. The lanes found holding 3.7, 5.9
  and 12.7 GiB fit one, two and four or five versions with their cache.
  The outer Docker showed the same pattern for the same reason: 9
  `pinetrie-lane` tags and 28 `pinetrie-observer` tags (2026-10-17).
- **The build cache costs as much as the image** under containerd's
  store: 3.2 GB on disk for a 1.93 GB image, 1.85 GB once the cache is
  pruned.
- **Removing an old tag frees little until the cache goes:** 1.1 GB of
  the 4 GB the two older tags and their cache held came back from `rmi`,
  the rest from `docker builder prune -f`, which removed every cache
  record, the current image's included, since none is in use between
  builds.
- **What the cache buys is a late change's build:** the `LABEL` build
  reused every layer. An early change reran all but the base (1 step
  cached; 133 s of steps against 175 s cold), so the cache saved nothing
  there. With the cache pruned, a build of the same Containerfile reruns
  every step; the host builds only a tag that is missing
  (`ensureImage`), so that costs a rebuild only after a change.

The kill criterion does not fire: a second version adds about as much as
the first. Pruning what is not current is worth doing; removing the old
tags alone is not enough, and pruning the cache costs the next late
change a cold build (about 3 minutes of steps here).

**Throw away:** done. The scratch lane's container and subvolumes are
deleted. The lease that filled the slot with the repo, the lane runtime,
the lane's git config and Kyneta is `sandbox/S232-lane.ts`, untracked.
