// lanes/fixtures — values the planners' tests share: a lane, its session's
// files, the parts of its mounts and its spec.

import { pointId, threadIdFor } from "@pinetrie/core"
import { planMounts } from "./mounts.ts"
import { sessionFiles } from "./session-files.ts"
import { type LaneSpec, NOTHING_ATTACHED } from "./spec.ts"
import type { LaneStep, Step } from "./steps.ts"

export const LANE = threadIdFor("1")

export const C1 = pointId("c1")

export const C2 = pointId("c2")

export const HOME = "/Users/ada"

export const SESSION = "/xdg/data/pinetrie/sessions/p"

export const files = sessionFiles(SESSION)

export const parts = {
  hostWorkingCopy: "/p",
  pinetrie: "/opt/pinetrie",
  runtime: `${files.lanes.runtime}/abc`,
  ignoreDir: files.lanes.laneGit,
  links: [{ source: "/k", target: "/k", readonly: true }],
  grants: [],
  shared: [],
  hostPaths: [],
}

export const spec: LaneSpec = {
  lane: LANE,
  image: "pinetrie-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts(parts),
  grants: { nested: false, hostPorts: [], env: [] },
  attached: NOTHING_ATTACHED,
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "2G",
  states: false,
}

export const argvs = (steps: readonly (LaneStep | Step)[]) =>
  steps.map(s =>
    s.in === "lane"
      ? `lane: ${s.argv.join(" ")}`
      : s.op.kind === "run"
        ? `runtime: run ${s.op.start.shape.name}`
        : `runtime: ${JSON.stringify(s.op)}`,
  )
