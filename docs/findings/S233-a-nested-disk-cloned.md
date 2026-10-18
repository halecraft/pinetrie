# S233 — A nested lane's inner Docker runs on a copy-on-write clone of another's, and the clone shares all but what each then writes

- **Status:** Answered (one sample of a clone taken while the source ran)
- **Led to:** ADR-0169

**Question.** A nested lane's disk for its inner Docker is made empty
(`planNestedDisk`), so every new nested lane builds its images from cold.
If a fork cloned its parent's nested disk as it clones the workspace, a
branch would start warm. Does rootless Docker start on a btrfs snapshot of
another lane's data root, with its images, its build cache and the
ability to run and build? How much does the clone share with its source
after use? And does a clone taken while the source's Docker runs, as a
fork during a run would take it, start?

**Kill criterion.** If the inner Docker refuses the clone, loses its
images, or needs every layer copied, forking the nested disk saves
nothing, and only pruning is left.

**Throw away.** Everything: the scratch lanes and subvolumes of S232's
setup, under `/var/lib/lanehost/spike/S232/` in the lane VM.

## Answers

Measured 2026-10-18 in the Mac's lane VM, on S232's scratch lane after its
builds (one image, `pinetrie-lane:c`, and its build cache; 3.07 GiB). The
second lane is made as the first, its nested disk a writable btrfs snapshot
of the first's at the same mount (`/var/lib/pinetrie-lanes`).

- **The source stopped:** the clone keeps its owner (uid 1000) and its
  modes. Its inner Docker starts, lists `pinetrie-lane:c`, runs it, and a
  build of the same Containerfile reuses its cache.
- **Sharing:** `btrfs filesystem du -s` on both after the clone: 3.07 GiB
  each, 0 exclusive. After the clone's container run and cached build,
  then both stopped: 588 KiB exclusive to the source, 776 KiB to the clone.
- **The source running:** a clone taken while the source's inner Docker
  ran a container writing 200 MB. On the clone, Docker starts, has
  removed the half-run container (`docker ps -a` empty), lists the image
  and runs it. The source is unaffected. One sample: the clone is the state
  a power cut would leave, and containerd and dockerd recovered from it
  here; a clone taken during a build or a pull was not tried.

The kill criterion does not fire. What a clone does not carry was not
measured here: the inner lanehost's `projects/` lives on the same
subvolume beside `docker/`, so cloning the whole nested disk would copy a
parent's inner test projects too, unless the data root becomes a
subvolume of its own.
