// e2e/host/images — pasted, kept by content, read by the model (ADR-0042).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cardId, type ImageRef, type LaneName, ROOT } from "@pineta/core"
import { scriptedModel, sha256Of } from "@pineta/pi"
import { readLaneNames } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { idleNow, join, waitFor } from "../harness.ts"
import { BLUE_PNG, GREEN_PNG, RED_PNG, YELLOW_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { at, idOfIn, recordsHold, START_AGENT, sleep } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  {
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pineta-images-")),
      "pineta.db",
    )
    const script = scriptedModel()
    let opened = openStore(dbFile)
    const GRACE_MS = 1_500
    const start = () =>
      startHost({
        model: { kind: "scripted", script },
        store: opened.store,
        blobs: opened.blobs,
        blobGraceMs: GRACE_MS,
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
          "default-src 'none'" &&
        (served.headers.get("cache-control") ?? "").includes("immutable") &&
        servedBytes.equals(RED_PNG),
    )

    // 2. What an upload may be.

    // 3. A message shows it; the model reads it after the text.
    const iu = await join(ih, "ivy", "images")
    await iu.setName("Ivy")
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
    await iu.chat(asked, ROOT, START_AGENT)
    await iidle()

    check(
      "the model reads the message's text, then its image",
      seen.at(-1) === `Ivy: ${asked}[image image/png ${red.sha256}]`,
      `${seen.at(-1)?.slice(-80)}`,
    )

    // 4. A card queued for its lane carries its images when it is taken.
    const green = await upload(GREEN_PNG)
    const replyId = idOfIn(ih.doc, "a red one")
    const paused = script.pause("hold on")
    script.use([{ text: "held" }, { text: "a green one" }])
    await iu.chat("@agent hold on", at(replyId), {
      mode: "reply",
    })
    await waitFor(() => paused.reached, 10_000)
    const queuedText = `@agent and this? ![green](/blob/${green.sha256})`
    const lane = readLaneNames(ih.doc)[0] as LaneName | undefined
    const queued = cardId(crypto.randomUUID())
    iu.createCard(
      {
        id: queued,
        owner: iu.writer,
        place: { kind: "drafting", at: at(replyId), lane: lane ?? null },
        command: null,
        unsent: null,
      },
      queuedText,
    )
    if (lane !== undefined) iu.queueCard(queued, { lane, at: at(replyId) })
    await waitFor(() => ih.cardText(queued) === queuedText, 5_000)

    paused.resume()
    await iidle()

    // 5. An image the host does not store refuses the send.
    const missing = "9".repeat(64)
    await iu.chat(
      `![gone](/blob/${missing})`,
      at(idOfIn(ih.doc, "a green one")),
      { mode: "reply" },
    )

    // 6. No image bytes in the session's records, compacted.
    await ih.quiet()
    const base64Slice = RED_PNG.toString("base64").slice(20, 70)
    await recordsHold(opened.store, base64Slice)

    // 7. Deleting what nothing shows, after the grace; a card's image stays,
    // across a restart (ADR-0048).
    await upload(BLUE_PNG)
    const yellow = await upload(YELLOW_PNG)
    const drafted = cardId(crypto.randomUUID())
    const draftedText = `next: ![yellow](/blob/${yellow.sha256})`
    iu.createCard(
      {
        id: drafted,
        owner: iu.writer,
        place: {
          kind: "drafting",
          at: at(idOfIn(ih.doc, "a green one")),
          lane: null,
        },
        command: null,
        unsent: null,
      },
      draftedText,
    )
    await waitFor(() => ih.cardText(drafted) === draftedText, 5_000)
    await iu.close()
    await sleep(100)
    await ih.shutdown()
    opened = openStore(dbFile)
    ih = await start()
    await sleep(GRACE_MS + 200)
    const iv = await join(ih, "ivy", "images")
    script.use([{ text: "swept" }])
    await iv.chat("@agent anything", at(idOfIn(ih.doc, "a green one")), {
      mode: "reply",
    })
    await iidle()
    await ih.quiet()
    let seenAfter: readonly string[] = []
    script.use([
      {
        reply: context => {
          seenAfter = context
          return "still red"
        },
      },
    ])
    await iv.chat("@agent and the first one?", at(idOfIn(ih.doc, "swept")), {
      mode: "reply",
    })
    await iidle()
    check(
      "after a restart on the same file, an image is still served, and still reaches the model",
      (await blobAt(red.sha256)).status === 200 &&
        seenAfter.includes(`Ivy: ${asked}[image image/png ${red.sha256}]`),
    )
    await iv.close()
    await sleep(100)
    await ih.shutdown()
  }
}
