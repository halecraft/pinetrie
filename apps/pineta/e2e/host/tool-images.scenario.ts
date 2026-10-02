// e2e/host/tool-images — a tool's image: kept by content, a reference in the session (ADR-0051).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { subscribe } from "@kyneta/schema"
import { projectSpine, ROOT } from "@pineta/core"
import { scriptedModel, sha256Of } from "@pineta/pi"
import { readLanes, readPlaces, readTreeIndex } from "@pineta/reads"
import { startHost } from "../../host/index.ts"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { committedProject, idleNow, join, waitFor } from "../harness.ts"
import { RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { at, recordsHold, START_AGENT, sleep } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  {
    const work = committedProject("pineta-tool-images-", {
      "shot.png": RED_PNG,
    })
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pineta-tool-images-db-")),
      "pineta.db",
    )
    const script = scriptedModel()
    let opened = openStore(dbFile)
    const GRACE_MS = 1_500
    const start = () =>
      startHost({
        model: { kind: "scripted", script },
        tools: { project: work },
        containers: false,
        store: opened.store,
        blobs: opened.blobs,
        blobGraceMs: GRACE_MS,
        log: () => {},
      })
    let th = await start()
    const tidle = () => waitFor(() => idleNow(th), 30_000)
    const readCall = () => {
      const tree = readTreeIndex(th.doc)
      const spine = projectSpine(
        tree,
        readLanes(th.doc, tree, readPlaces(th.places))[0]?.tip ?? null,
      ).spine
      return spine
        .flatMap(n => n.toolCalls ?? [])
        .find(c => c.label === "read shot.png")
    }
    const red = sha256Of(RED_PNG)
    const tu = await join(th, "tia", "tool-images")

    // pi's pending entries, as each change of the document leaves them: a
    // compaction after the run rewrites the history they were in (S59).
    const pendings: string[] = []
    const unwatch = subscribe(th.doc, () => {
      for (const [key, v] of Object.entries(th.doc.values()))
        if (key.includes("pi.pending.entry")) pendings.push(JSON.stringify(v))
    })

    // 1. A read of a PNG: its result holds a reference, and the model the image.
    script.use([
      { tool: "read", args: { path: "shot.png" } },
      { text: "a red square" },
    ])
    await tu.chat("what is in shot.png?", ROOT, START_AGENT)
    await tidle()
    const call = readCall()
    const served = await fetch(`${th.httpUrl}blob/${red}`)
    check(
      "a read image is stored by content, and its result holds the reference",
      call?.subject === "shot.png" &&
        JSON.stringify(call.result?.images) ===
          JSON.stringify([
            { sha256: red, mimeType: "image/png", width: 40, height: 30 },
          ]) &&
        served.status === 200 &&
        Buffer.from(await served.arrayBuffer()).equals(RED_PNG),
      `${JSON.stringify(call?.result?.images)}`,
    )

    // 2. No bytes in the session: not in the entry, nor in pi's pending entry,
    // which a delete leaves in the history until a compaction (S59).
    unwatch()
    await th.quiet()
    const base64Slice = RED_PNG.toString("base64").slice(20, 70)
    await recordsHold(opened.store, base64Slice)

    // 3. After a restart on the same file and the grace, the sweep keeps it,
    // and it still reaches the model.
    await tu.close()
    await sleep(100)
    await th.shutdown()
    opened = openStore(dbFile)
    th = await start()
    await sleep(GRACE_MS + 200)
    const tv = await join(th, "tia", "tool-images")
    script.use([{ text: "still red" }])
    const tip = readLanes(
      th.doc,
      readTreeIndex(th.doc),
      readPlaces(th.places),
    )[0]
    await tv.chat("@agent and now?", at(tip?.tip ?? null), {
      lane: tip?.name,
    })
    await tidle()
    await th.quiet()
    await tv.close()
    await sleep(100)
    await th.shutdown()
  }
}
