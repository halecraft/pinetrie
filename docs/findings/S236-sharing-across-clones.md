# S236 — What clones of one inner Docker share once each rebuilds the lane image

- **Status:** Answered
- **Led to:** ADR-0169

**Question.** ADR-0169 has lanes clone their inner Docker from the lane
they came from, and expects their sharing to last only until each
rebuilds: after a change to the lane image, every lane that builds it
holds its own copy. How much does each clone hold of its own after an
early change, after the older tag is removed and the cache trimmed, and
how much does a clone taken from a lane that has already rebuilt hold?

**Kill criterion.** If clones that each rebuild hold nearly a whole cold
build apiece, cloning saves only until the next image change, and the
disk a project's nested lanes take grows with their count times the image;
the plan then needs lanes to take the newer version from one another.

**Throw away.** The scratch nested lanes and their disks under
`/var/lib/lanehost/spike/` in the lane VM.

## Answers

Measured 2026-10-18 in the Mac's lane VM, on scratch nested lanes made as
S232's, each inner Docker capped as S234 found (`defaultMaxUsedSpace`
512 MB, `defaultReservedSpace` 256 MB). The source held the lane image
built with `JJ_VERSION=0.45.0` and its cache, 3.07 GiB. Three clones of it
each built the lane image with `JJ_VERSION=0.45.1`, an early change that
reran every step but the base. Sizes are `btrfs filesystem du -s` over the
set named, with the lanes stopped.

| state | each clone's own (exclusive) | shared with the rest |
|---|---|---|
| cloned | 0 | 3.07 GiB |
| each built the new version, the old tag kept | 1.46 to 1.64 GiB | 2.01 to 3.07 GiB |
| each removed the old tag, then built again (cached) so GC ran | 1.46 to 2.52 GiB | 568 MiB |
| a clone of one of those, its image run, no build | 232 KiB | 3.07 GiB |

- **Lanes that rebuild apart end up apart.** Once each has dropped the
  older version, all a clone shares with the others is the base image's
  layers (568 MiB); the rest, 2.0 to 3.1 GiB, is its own. Each clone's
  rebuild wrote its own layers: the steps are not reproducible, so the
  same Containerfile gives other blobs.
- **A clone of a lane that has the current version costs nothing:** it
  has the tag, so the host builds nothing (`ensureImage`), and it shares
  all but what it writes.
- **A clone rebuilt only because its cache was gone:** one source's GC had
  removed the current image's cache records (S234), so a build in its
  clone reran every step and the clone owned 2.52 GiB. The host would not
  have built there, since the tag existed.

The kill criterion fires: after a change to the lane image, every nested
lane that builds the new version holds about one whole version of its
own, so a project's nested lanes take about their count times 2 to 3 GiB,
cloned or not. Cloning saves the first build of a fork from a lane that
already has the version, and until the image next changes. To keep the
saving across a change, lanes must take the new version from one another:
for instance a fork, or a lane's next run, cloning from the lane that
built it, rather than building it again.
