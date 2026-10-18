// host/work/inner-docker-data-roots — the host's one `InnerDockerDataRoots`
// value: which nested lane's container stopped last after a run, and which
// run end each lane's inner Docker data root is as of. In memory only: after
// a start there is no last run's lane until a run ends, so lanes keep their
// own data roots until then. The decisions are `@pinetrie/lanes`'.

import type { ThreadId } from "@pinetrie/core"
import {
  type InnerDockerDataRootSource,
  innerDockerDataRootsAfterClone,
  innerDockerDataRootsAfterRunEnd,
  NO_INNER_DOCKER_DATA_ROOTS,
  planInnerDockerDataRootSource,
} from "@pinetrie/lanes"

export interface InnerDockerDataRootsHeld {
  /** Where a lane's data root comes from at a start of its container. */
  sourceAtStart(lane: ThreadId): InnerDockerDataRootSource
  /** Where a forked lane's data root comes from: its delete dropped its own. */
  sourceAtFork(
    lane: ThreadId,
    forkSourceLane: ThreadId | null,
  ): InnerDockerDataRootSource
  /** After `source`'s step ran for `lane`. */
  made(lane: ThreadId, source: InnerDockerDataRootSource): void
  /** After a nested lane's container stopped at its run's end. */
  stoppedAfterRun(lane: ThreadId): void
}

export function holdInnerDockerDataRoots(): InnerDockerDataRootsHeld {
  let roots = NO_INNER_DOCKER_DATA_ROOTS
  return {
    sourceAtStart: lane =>
      planInnerDockerDataRootSource({
        roots,
        lane,
        clonedAtRunEnd: roots.clonedAtRunEnd.get(lane) ?? null,
        forkSourceLane: null,
      }),
    sourceAtFork: (lane, forkSourceLane) =>
      planInnerDockerDataRootSource({
        roots,
        lane,
        clonedAtRunEnd: null,
        forkSourceLane,
      }),
    made(lane, source) {
      roots = innerDockerDataRootsAfterClone(roots, lane, source)
    },
    stoppedAfterRun(lane) {
      roots = innerDockerDataRootsAfterRunEnd(roots, lane)
    },
  }
}
