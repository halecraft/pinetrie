// e2e/host/tool-images — a tool's image: kept by content, a reference in the session.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { subscribe } from "@kyneta/schema"
import { ROOT } from "@pinetrie/core"
import { blobSha256, scriptedModel } from "@pinetrie/pi"
import { readPlaces } from "@pinetrie/reads"
import { projectSpine, transcriptCalls } from "@pinetrie/threads"
import { BLOB_GRACE_MS } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  at,
  committedProject,
  held,
  heldLanes,
  heldTree,
  idleNow,
  START_AGENT,
  suiteClock,
  waitFor,
} from "../harness.ts"
import { RED_PNG } from "../images.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

import { clockedStore, recordsHold } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  {
    const work = await committedProject("pinetrie-tool-images-", {
      "shot.png": RED_PNG,
    })
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pinetrie-tool-images-db-")),
      "pinetrie.db",
    )
    const script = scriptedModel()
    const clock = suiteClock()
    let stored = clockedStore(dbFile, clock)
    const start = () =>
      lanes.sectionHost({
        dir: work,
        model: { kind: "scripted", script },
        ...stored,
      })
    let section = await start()
    let th = section.host
    const tidle = () => waitFor(() => idleNow(th), 30_000)
    const readCall = () => {
      const tree = heldTree(th)
      const spine = projectSpine(
        tree,
        heldLanes(th, tree, readPlaces(th.places))[0]?.tip ?? null,
      ).spine
      return spine
        .flatMap(transcriptCalls)
        .find(c => c.name === "read" && c.subject === "shot.png")
    }
    const red = blobSha256(RED_PNG)
    const tu = section.user

    // pi's pending entries, as each change of the document leaves them: a
    // compaction after the run rewrites the history they were in.
    const pendings: string[] = []
    // Each root's document, followed as the host opens it: a run is in
    // its root's, which a start makes, and starting a run is a
    // change to what streams, which comes first.
    const watching = new Map<object, () => void>()
    const watchRoots = () => {
      for (const doc of held(th).roots) {
        if (watching.has(doc)) continue
        watching.set(
          doc,
          subscribe(doc, () => {
            for (const [key, v] of Object.entries(doc.values()))
              if (key.includes("pi.pending.entry"))
                pendings.push(JSON.stringify(v))
          }),
        )
      }
    }
    const offLive = subscribe(th.live, watchRoots)
    const unwatch = () => {
      offLive()
      for (const off of watching.values()) off()
    }

    // 1. A read of a PNG: its result holds a reference, and the model the image.
    script.use([
      { tool: "read", args: { path: "shot.png" } },
      { text: "a red square" },
    ])
    await tu.send("what is in shot.png?", ROOT, START_AGENT)
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
    // which a delete leaves in the history until a compaction.
    unwatch()
    await th.quiet()
    const base64Slice = RED_PNG.toString("base64").slice(20, 70)
    await recordsHold(stored.store.store, base64Slice)

    // 3. After a restart on the same file and the grace, the sweep keeps it,
    // and it still reaches the model.
    await section.close(true)
    stored = clockedStore(dbFile, clock)
    section = await start()
    th = section.host
    clock.advance(BLOB_GRACE_MS + 1)
    const tv = section.user
    script.use([{ text: "still red" }])
    const tip = heldLanes(th, heldTree(th), readPlaces(th.places))[0]
    await tv.send("@agent and now?", at(tip?.tip ?? null), {
      thread: tip?.name,
    })
    await tidle()
    await th.quiet()
    await section.close()
  }
}
