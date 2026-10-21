import { pointId, type RunSource } from "@pinetrie/core"
import { expect, test } from "vitest"
import { refreshBase } from "./base.ts"
import { spec } from "./fixtures.ts"
import { baseCheckout } from "./history-port.ts"
import type { LaneRuntime } from "./runtime-port.ts"
import { baseLane, type LaneOwner, type LaneSpec } from "./spec.ts"

const unobserved: RunSource = {
  drain: async drain => (await drain(new Map())).result,
}

/** A runtime that keeps nothing: each container and disk call it is asked, by its lane's name. */
function namingRuntime(project: string, seen: string[]): LaneRuntime {
  const no = () => {
    throw new Error("not asked in a base's build")
  }
  return {
    baseLane: baseLane(project),
    disk: async op => {
      seen.push(`disk ${op.kind} ${"lane" in op ? op.lane : ""}`)
    },
    run: async shape => {
      seen.push(`run ${shape.name}`)
    },
    remove: async container => {
      seen.push(`remove ${container}`)
    },
    stop: async container => {
      seen.push(`stop ${container}`)
    },
    readLaneFile: async () => null,
    execArgv: (container, argv) => ["exec", container, ...argv],
    diskExists: no,
    snapshotExists: no,
    snapshots: no,
    diff: no,
    runSpec: no,
    containerFacts: no,
    start: no,
    ensureLaneImages: no,
    imagePath: no,
    runInImage: no,
  }
}

test("a base is built, snapshotted and removed in its own project's scratch lane alone", async () => {
  const project = "0123456789abcdef"
  const seen: string[] = []
  const made = await refreshBase({
    runtime: namingRuntime(project, seen),
    spec: spec as LaneSpec<LaneOwner>,
    env: {},
    open: async () => ({
      channel: null,
      runs: unobserved,
      run: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
      bytes: async () => ({
        ok: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: "",
      }),
      close: async () => {},
      closed: new Promise<void>(() => {}),
    }),
    accepted: {
      points: [pointId("line-1")],
      checkout: () => baseCheckout([]),
    },
  })
  const lane = `base-scratch-${project}`
  expect(made).toBe(true)
  expect(seen).toEqual([
    `remove pinetrie-${lane}`,
    `disk delete ${lane}`,
    `disk create ${lane}`,
    `run pinetrie-${lane}`,
    `disk snapshot ${lane}`,
    `stop pinetrie-${lane}`,
    `remove pinetrie-${lane}`,
    `disk delete ${lane}`,
  ])
})
