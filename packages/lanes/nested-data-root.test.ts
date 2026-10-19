import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  innerDockerDataRootsAfterClone,
  innerDockerDataRootsAfterRunEnd,
  NO_INNER_DOCKER_DATA_ROOTS,
  planInnerDockerDataRootSource,
} from "./nested-data-root.ts"

describe("a nested lane's inner Docker data root: the last run's lane's, cloned", () => {
  const [A, B, C] = [threadIdFor("a"), threadIdFor("b"), threadIdFor("c")]
  const afterRun = (...lanes: (typeof A)[]) =>
    lanes.reduce(innerDockerDataRootsAfterRunEnd, NO_INNER_DOCKER_DATA_ROOTS)
  const atStart = (roots: typeof NO_INNER_DOCKER_DATA_ROOTS, lane: typeof A) =>
    planInnerDockerDataRootSource({
      roots,
      lane,
      clonedAtRunEnd: roots.clonedAtRunEnd.get(lane) ?? null,
      forkSourceLane: null,
    })
  test("with no run ended, every lane keeps its own", () => {
    expect(atStart(NO_INNER_DOCKER_DATA_ROOTS, A)).toEqual({ kind: "keep" })
  })
  test("the last run's lane keeps its own; another clones it, then keeps it until another run ends", () => {
    const roots = afterRun(A, B)
    expect(atStart(roots, B)).toEqual({ kind: "keep" })
    const source = atStart(roots, A)
    expect(source).toEqual({ kind: "clone", cloneFromLane: B, atRunEnd: 2 })
    const cloned = innerDockerDataRootsAfterClone(roots, A, source)
    expect(atStart(cloned, A)).toEqual({ kind: "keep" })
    expect(atStart(innerDockerDataRootsAfterRunEnd(cloned, C), A)).toEqual({
      kind: "clone",
      cloneFromLane: C,
      atRunEnd: 3,
    })
  })
  test("a fork clones the last run's lane, else its source lane, else keeps", () => {
    const atFork = (
      roots: typeof NO_INNER_DOCKER_DATA_ROOTS,
      lane: typeof A,
      forkSourceLane: typeof A | null,
    ) =>
      planInnerDockerDataRootSource({
        roots,
        lane,
        clonedAtRunEnd: null,
        forkSourceLane,
      })
    expect(atFork(afterRun(B), A, C)).toEqual({
      kind: "clone",
      cloneFromLane: B,
      atRunEnd: 1,
    })
    // The fork's delete dropped the last run's own: its source's instead.
    expect(atFork(afterRun(A), A, C)).toEqual({
      kind: "clone",
      cloneFromLane: C,
      atRunEnd: null,
    })
    expect(atFork(NO_INNER_DOCKER_DATA_ROOTS, A, null)).toEqual({
      kind: "keep",
    })
    expect(atFork(NO_INNER_DOCKER_DATA_ROOTS, A, A)).toEqual({ kind: "keep" })
  })
})
