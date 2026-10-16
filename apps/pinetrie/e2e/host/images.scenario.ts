// e2e/host/images — pasted, kept by content, read by the model.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ImageRef, ROOT, type ThreadId } from "@pinetrie/core"
import { scriptedModel, sha256Of } from "@pinetrie/pi"
import { BLOB_GRACE_MS } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  at,
  composeAt,
  idleNow,
  join,
  laneNamesOf,
  queueCard,
  START_AGENT,
  startSuiteHost,
  suiteClock,
  waitFor,
} from "../harness.ts"
import { BLUE_PNG, GREEN_PNG, RED_PNG, YELLOW_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { clockedStore, idOfIn, recordsHold } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  {
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pinetrie-images-")),
      "pinetrie.db",
    )
    const script = scriptedModel()
    const clock = suiteClock()
    let stored = clockedStore(dbFile, clock)
    const start = () =>
      startSuiteHost({
        model: { kind: "scripted", script },
        ...stored.options,
        log: () => {},
      })
    let ih = await start()
    const upload = async (bytes: Buffer): Promise<ImageRef> => {
      const response = await fetch(`${ih.httpUrl}blob`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      })
      if (response.status !== 201)
        throw new Error(`upload refused: ${response.status}`)
      return (await response.json()) as ImageRef
    }
    const blobAt = (sha: string) => fetch(`${ih.httpUrl}blob/${sha}`)

    // 1. Upload and serve.
    const red = await upload(RED_PNG)
    const served = await blobAt(red.sha256)
    const servedBytes = Buffer.from(await served.arrayBuffer())
    check(
      "an uploaded PNG is kept by the SHA-256 of its bytes, with its size, and served back as it was",
      red.sha256 === sha256Of(RED_PNG) &&
        red.mimeType === "image/png" &&
        red.width === 40 &&
        red.height === 30 &&
        served.status === 200 &&
        served.headers.get("content-type") === "image/png" &&
        served.headers.get("x-content-type-options") === "nosniff" &&
        served.headers.get("content-security-policy") ===
          "sandbox; default-src 'none'" &&
        (served.headers.get("cache-control") ?? "").includes("immutable") &&
        servedBytes.equals(RED_PNG),
    )

    // 2. What an upload may be.

    // 3. A message shows it; the model reads it after the text.
    const iu = await join(ih, "ivy", "images")
    await iu.request({ kind: "name", name: "Ivy" })
    const iidle = () => waitFor(() => idleNow(ih), 30_000)
    let seen: readonly string[] = []
    script.use([
      {
        reply: context => {
          seen = context
          return "a red one"
        },
      },
    ])
    const asked = `what colour is this? ![red](/blob/${red.sha256})`
    await iu.send(asked, ROOT, START_AGENT)
    await iidle()

    check(
      "the model reads the message's text, then its image",
      seen.at(-1) === `Ivy: ${asked}[image image/png ${red.sha256}]`,
      `${seen.at(-1)?.slice(-80)}`,
    )

    // 4. A card queued for its lane carries its images when it is popped.
    const green = await upload(GREEN_PNG)
    const replyId = idOfIn(ih, "a red one")
    const paused = script.hold("hold on")
    script.use([{ text: "held" }, { text: "a green one" }])
    await iu.send("@agent hold on", at(replyId), {
      mode: "reply",
    })
    await waitFor(() => paused.reached, 10_000)
    const queuedText = `@agent and this? ![green](/blob/${green.sha256})`
    const lane = laneNamesOf(ih)[0] as ThreadId | undefined
    const queued = await composeAt(
      iu,
      { entry: replyId, lane: lane ?? null },
      queuedText,
    )
    if (lane !== undefined) void queueCard(iu, queued, lane)
    await waitFor(() => ih.cardText(queued) === queuedText, 5_000)

    paused.finish()
    await iidle()

    // 5. An image the host does not store refuses the send.
    const missing = "9".repeat(64)
    await iu.send(`![gone](/blob/${missing})`, at(idOfIn(ih, "a green one")), {
      mode: "reply",
    })

    // 6. No image bytes in the session's records, compacted.
    await ih.quiet()
    const base64Slice = RED_PNG.toString("base64").slice(20, 70)
    await recordsHold(stored.opened.store, base64Slice)

    // 7. Deleting what nothing shows, after the grace; a card's image stays,
    // across a restart.
    const blue = await upload(BLUE_PNG)
    const yellow = await upload(YELLOW_PNG)
    const draftedText = `next: ![yellow](/blob/${yellow.sha256})`
    const drafted = await composeAt(
      iu,
      { entry: idOfIn(ih, "a green one"), lane: null },
      draftedText,
    )
    await waitFor(() => ih.cardText(drafted) === draftedText, 5_000)
    await iu.close()
    await ih.shutdown()
    stored = clockedStore(dbFile, clock)
    ih = await start()
    clock.advance(BLOB_GRACE_MS + 1)
    const iv = await join(ih, "ivy", "images")
    script.use([{ text: "swept" }])
    await iv.send("@agent anything", at(idOfIn(ih, "a green one")), {
      mode: "reply",
    })
    await iidle()
    await ih.quiet()
    // The run's end swept, on the host's clock, a day past both uploads.
    const blueAfter = (await blobAt(blue.sha256)).status
    const yellowAfter = (await blobAt(yellow.sha256)).status
    check(
      "after the grace, the sweep deletes an image nothing shows, and keeps one a card shows",
      blueAfter === 404 && yellowAfter === 200,
      `blue ${blueAfter}, yellow ${yellowAfter}`,
    )
    let seenAfter: readonly string[] = []
    script.use([
      {
        reply: context => {
          seenAfter = context
          return "still red"
        },
      },
    ])
    await iv.send("@agent and the first one?", at(idOfIn(ih, "swept")), {
      mode: "reply",
    })
    await iidle()
    check(
      "after a restart on the same file, an image is still served, and still reaches the model",
      (await blobAt(red.sha256)).status === 200 &&
        seenAfter.includes(`Ivy: ${asked}[image image/png ${red.sha256}]`),
    )
    await iv.close()
    await ih.shutdown()
  }
}
