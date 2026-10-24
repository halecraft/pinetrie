// pnpm --filter @pinetrie/app run lane-tests — the unit
// tests this place cannot run, in a throwaway lane (`test-lane.ts`): plan
// where each unit requirement is met (`planUnitRequirements`), and when one
// is planned in a lane, run there every test tagged with one so planned.
// Vitest's own output streams through, and its JSON report is written with
// the plan beside it (`LaneReport`, at `UNIT_REPORTS.lane`), for
// `scripts/requirements-report.ts`. Exits as the lane's tests did: 0 when
// no lane is planned, or none can be made (the report says why).

import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { errorText } from "@pinetrie/core"
import { gatherUnitFacts } from "../e2e/place.ts"
import {
  lanePlanned,
  laneTagsFilter,
  planUnitRequirements,
  type RequirementPlace,
  UNIT_REPORTS,
  type UnitRequirement,
} from "../e2e/requirements.ts"
import { LANE_CHECKOUT, openTestLane } from "./test-lane.ts"

/** What `lane-tests` writes: the plan it ran by, and the lane's report. */
export interface LaneReport {
  readonly plan: Readonly<Record<UnitRequirement, RequirementPlace>>
  /** Vitest's JSON report from the lane; null when no lane ran. */
  readonly vitest: unknown
  /** The checkout's root in the lane, which the report's paths are under. */
  readonly root: string
  /** Why the lane planned did not run its tests, or null. */
  readonly failed: string | null
}

const root = path.resolve(import.meta.dirname, "../../..")
const reportFile = path.join(root, UNIT_REPORTS.lane)
const log = (line: string) => console.log(line)

const write = async (report: LaneReport) => {
  await mkdir(path.dirname(reportFile), { recursive: true })
  await writeFile(reportFile, `${JSON.stringify(report)}\n`)
}

// A report left by an earlier run must not stand for this one's.
await rm(reportFile, { force: true })
const facts = gatherUnitFacts(root)
// The runtime is probed only when a lane might be needed: on the Mac it
// reads the lane VM's state.
const first = planUnitRequirements({ ...facts, laneRuntime: null })
const laneRuntime =
  lanePlanned(first).length === 0
    ? null
    : await (await import("../e2e/lane-hosts.ts")).runtimeProblem()
const plan = planUnitRequirements({ ...facts, laneRuntime })
const filter = laneTagsFilter(lanePlanned(plan))
if (filter === null) {
  await write({ plan, vitest: null, root: LANE_CHECKOUT, failed: null })
  log("[lane] every unit requirement is met here, or by no lane: none made")
  process.exit(0)
}

log(`[lane] the tests tagged ${filter}, in a throwaway lane`)
const IN_LANE_REPORT = "/workspace/unit-lane.json"
let status: number | null = 1
try {
  const lane = await openTestLane({ root, log })
  try {
    const ran = await lane.run(
      [
        "pnpm",
        "exec",
        "vitest",
        "run",
        `--tags-filter=${filter}`,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${IN_LANE_REPORT}`,
      ],
      { onOutput: chunk => process.stdout.write(chunk) },
    )
    status = ran.status
    await write({
      plan,
      vitest: JSON.parse(await lane.read(IN_LANE_REPORT)),
      root: LANE_CHECKOUT,
      failed: null,
    })
  } finally {
    await lane.close()
  }
} catch (error) {
  await write({
    plan,
    vitest: null,
    root: LANE_CHECKOUT,
    failed: errorText(error),
  })
  console.error(`[lane] ${errorText(error)}`)
  process.exit(1)
}
process.exit(status ?? 1)
