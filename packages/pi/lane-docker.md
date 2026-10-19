# Docker in a pine·trie lane

Your lane runs a rootless Docker of its own at `$DOCKER_HOST`, because its
project grants lanes of their own (`lanes.nested`). This note is true of
every such lane. Read it before you build or run images here.

Each fact names the code it comes from in an HTML comment, so whoever
changes pine·trie can keep this note true. You can skip them.

## What its data is

- Its data root is a cache, not your work: a disk of its own beside
  `/workspace`, never snapshotted, never committed, and never carried into
  a branch. <!-- packages/docker/plan.ts INNER_DOCKER_DATA_ROOT_DIR -->
- At the start of a run, it may be replaced by a copy of the data root of
  the project's nested lane whose run ended last, so a version of an image
  another lane built is here without a build. So `docker images` says what
  is here now, whatever you built in an earlier run.
  <!-- packages/lanes/nested-data-root.ts planInnerDockerDataRootSource -->
- Containers you start end with the run: the lane's container stops, and
  your Docker with it. A container another lane's copy brought with it is
  removed when a pine·trie host starts here.
  <!-- packages/docker/plan.ts planProjectSweep -->

## Images and the build cache

- An image pine·trie needs that is already here is never built again; a
  missing one is built from scratch.
  <!-- packages/lanes/runtime-port.ts ensureLaneImages -->
- After a pine·trie host here builds an image, it removes the other images
  of pine·trie's repositories that it does not need and no container was
  made from. It removes no image of any other name, though a data root
  replaced at a run's start holds only what its source held.
  <!-- packages/docker/plan.ts unneededImageTags -->
  <!-- packages/docker/plan.ts PINETRIE_IMAGE_REPOSITORIES -->
- The build cache beside the images is capped, so what a late change to a
  Containerfile builds from stays, and older versions' cache goes.
  <!-- packages/lanes/image/daemon.json defaultMaxUsedSpace -->
- So pruning by hand (`docker system prune`, `docker builder prune`) frees
  nothing pine·trie would not, and costs the next change a build from
  scratch. <!-- packages/lanes/image/daemon.json builder -->
