// e2e/host/live — a real model's words (`pnpm run e2e:live`). Every other
// scenario runs on a scripted model, so its steps are repeatable, cost nothing
// and need no key.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ImageRef, projectTranscript, ROOT } from "@pinetrie/core"
import { readBanners } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import {
  idleNow,
  join,
  laneNamesOf,
  START_AGENT,
  SUITE_CONFIG,
  startSuiteHost,
  tipIn,
  treeOf,
  waitFor,
} from "../harness.ts"
import { imageSize, RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { runOf } from "./support.ts"

export const scenario: Scenario = {
  needs: async () =>
    process.env.PINETRIE_LIVE === "1"
      ? null
      : "a real model: PINETRIE_LIVE=1 (pnpm run e2e:live)",
  run: ({ check }) => run(check),
}

const PROMPT = "Say exactly: PINETRIE-OK"
/** The suites' own real model: never the person's pi setup, which costs them. */
const LIVE_MODEL = {
  kind: "named",
  provider: "cerebras",
  model: "qwen-3.8-27b",
} as const

async function run(check: Checks["check"]): Promise<void> {
  console.log("\n--- live turn ---")
  const live = await startSuiteHost({
    port: 0,
    model: LIVE_MODEL,
    log: () => {},
  })
  const asker = await join(live, "asker", "live")
  await asker.chat(PROMPT, ROOT, START_AGENT)
  await waitFor(() => idleNow(live), 120_000)
  const [lane] = laneNamesOf(live)
  const last = projectTranscript(
    treeOf(live),
    lane === undefined ? null : tipIn(live, lane),
  ).at(-1)
  console.log(`  model said: ${JSON.stringify(last?.text)}`)
  check(
    "the model's reply contains the requested token",
    last?.role === "assistant" && last.text.includes("PINETRIE-OK"),
  )
  // A pasted image reaches a real model: it says what it shows.
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
  const imageLane = laneNamesOf(live).find(l => l !== lane)
  const seenBy = projectTranscript(
    treeOf(live),
    imageLane === undefined ? null : tipIn(live, imageLane),
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
  // `aspect_ratio` of 1:1 asks.
  const bannerConfig = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-live-banner-")),
    "config.json",
  )
  writeFileSync(
    bannerConfig,
    JSON.stringify({ ...SUITE_CONFIG, icons: { source: "drawn" } }),
  )
  const bannerLog: string[] = []
  const drawing = await startSuiteHost({
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
  await waitFor(() => readBanners(drawing.session).size > 0, 120_000)
  await drawing.quiet()
  const [banner] = readBanners(drawing.session).values()
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
