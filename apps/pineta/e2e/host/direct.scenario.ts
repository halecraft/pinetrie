// e2e/host/direct — a lane in a directory you name (ADR-0032).

import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ancestry, ROOT } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import { readLaneRecords, readPlaces } from "@pineta/reads"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  idleNow,
  join,
  lanesOf,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { at, BRANCH, idOfIn, START_AGENT } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // No containers here: lanes of their own are `e2e:lanes`'s. A lane asked to
  // work directly does so wherever lanes of their own are available or not.
  {
    const project = committedProject("pineta-direct-", {
      "shared.txt": "one\n",
    })
    const elsewhere = realpathSync(
      mkdtempSync(path.join(tmpdir(), "pineta-elsewhere-")),
    )
    const script = scriptedModel()
    const dh = await startHost({
      model: { kind: "scripted", script },
      tools: { project },
      containers: false,
      log: () => {},
    })
    const du = await join(dh, "uma", "direct")
    await du.request({ kind: "name", name: "Uma" })
    const didle = () => waitFor(() => idleNow(dh), 60_000)
    const laneWith = (text: string) => {
      const id = idOfIn(dh, text)
      const index = treeOf(dh)
      return lanesOf(dh, index, readPlaces(dh.places)).find(
        l => id !== null && ancestry(index, l.tip).path.includes(id),
      )
    }

    // In the named directory; a branch below it works there too.
    script.use([
      { tool: "bash", args: { command: "pwd > here.txt" } },
      { text: "here" },
    ])
    await du.chat("work over there", ROOT, {
      ...START_AGENT,
      work: { kind: "direct", dir: elsewhere },
    })
    await didle()
    const direct = laneWith("work over there")
    script.use([{ text: "still here" }])
    await du.chat("@agent and below", at(direct?.tip ?? null), BRANCH)
    await didle()
    const below = laneWith("@agent and below")
    const records = readLaneRecords(dh.session)
    check(
      "a lane working directly writes in its directory, and a branch below inherits it",
      direct !== undefined &&
        existsSync(path.join(elsewhere, "here.txt")) &&
        readFileSync(path.join(elsewhere, "here.txt"), "utf8") ===
          `${elsewhere}\n` &&
        !existsSync(path.join(project, "here.txt")) &&
        below !== undefined &&
        below.name !== direct.name &&
        JSON.stringify(records.get(below.name)?.work) ===
          JSON.stringify({ kind: "direct", dir: elsewhere }),
    )

    await du.close()
    await dh.shutdown()
  }
}
