// e2e/host/live — a real model's words (`pnpm run e2e:live`). Every other
// scenario runs on a scripted model, so its steps are repeatable, cost nothing
// and need no key (ADR-0041).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ImageRef, projectTranscript, ROOT } from "@pineta/core"
import { readBanners, readTreeIndex } from "@pineta/reads"
import { readLaneNames, readLaneTip } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import { idleNow, join, waitFor } from "../harness.ts"
import { imageSize, RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { runOf, START_AGENT } from "./support.ts"

export const scenario: Scenario = {
  needs: async () =>
    process.env.PINETA_LIVE === "1"
      ? null
      : "a real model: PINETA_LIVE=1 (pnpm run e2e:live)",
  run: ({ check }) => run(check),
}

const PROMPT = "Say exactly: PINETA-OK"
/** The suites' own real model: never the person's pi setup, which costs them. */
const LIVE_MODEL = {
  kind: "named",
  provider: "cerebras",
  model: "qwen-3.8-27b",
} as const

async function run(check: Checks["check"]): Promise<void> {
  console.log("\n--- live turn ---")
  const live = await startHost({
    port: 0,
    model: LIVE_MODEL,
    log: () => {},
  })
  const asker = await join(live, "asker", "live")
  await asker.chat(PROMPT, ROOT, START_AGENT)
  await waitFor(() => idleNow(live), 120_000)
  const [lane] = readLaneNames(live.doc)
  const last = projectTranscript(
    readTreeIndex(live.doc),
    lane === undefined ? null : readLaneTip(live.doc, lane),
  ).at(-1)
  console.log(`  model said: ${JSON.stringify(last?.text)}`)
  check(
    "the model's reply contains the requested token",
    last?.role === "assistant" && last.text.includes("PINETA-OK"),
  )
  // A pasted image reaches a real model (ADR-0042): it says what it shows.
  const uploaded = await fetch(`${live.httpUrl}blob`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(RED_PNG),
  })
  const red = (await uploaded.json()) as ImageRef
  const shown = await asker.chat(
    `What colour is this image? Answer in one word. ![square](/blob/${red.sha256})`,
    ROOT,
    START_AGENT,
  )
  await waitFor(() => idleNow(live), 120_000)
  // A Start Agent message begins a thread of its own: its lane is the new one.
  const imageLane = readLaneNames(live.doc).find(l => l !== lane)
  const seenBy = projectTranscript(
    readTreeIndex(live.doc),
    imageLane === undefined ? null : readLaneTip(live.doc, imageLane),
  ).at(-1)
  console.log(`  model said of the image: ${JSON.stringify(seenBy?.text)}`)
  check(
    "a real model reads a pasted image: it names its colour",
    runOf(shown) !== "" &&
      seenBy?.role === "assistant" &&
      /red/i.test(seenBy.text),
  )
  await asker.close()
  await live.shutdown()

  // A banner drawn by the real image model: a square icon, as the request's
  // `aspect_ratio` of 1:1 asks (ADR-0053).
  const bannerConfig = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-live-banner-")),
    "config.json",
  )
  writeFileSync(bannerConfig, JSON.stringify({ banner: { enabled: true } }))
  const bannerLog: string[] = []
  const drawing = await startHost({
    port: 0,
    model: LIVE_MODEL,
    userConfig: bannerConfig,
    log: line => bannerLog.push(line),
  })
  const painter = await join(drawing, "painter", "live")
  await painter.chat(
    "Name three birds of spring marshes, in one line.",
    ROOT,
    START_AGENT,
  )
  await waitFor(() => idleNow(drawing), 120_000)
  await waitFor(() => readBanners(drawing.doc).size > 0, 120_000)
  await drawing.quiet()
  const [banner] = readBanners(drawing.doc).values()
  const served =
    banner === undefined
      ? null
      : await fetch(`${drawing.httpUrl}blob/${banner.sha}`)
  const bytes = served === null ? null : Buffer.from(await served.arrayBuffer())
  const size = bytes === null ? null : imageSize(bytes)
  console.log(
    `  banner: ${JSON.stringify(size)} ${served?.headers.get("content-type")} ${bannerLog.filter(l => l.includes("banner")).join(" | ")}`,
  )
  check(
    "a real image model draws a thread's banner, square as its request asks",
    served?.status === 200 && size !== null && size.width === size.height,
    `${size?.width}×${size?.height}`,
  )
  await painter.close()
  await drawing.shutdown()
}
