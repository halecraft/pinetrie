// e2e/host/live — a real model's words (`pnpm run e2e:live`). Every other
// scenario runs on a scripted model, so its steps are repeatable, cost nothing
// and need no key.

import { homedir } from "node:os"
import { configPlaces } from "@pinetrie/config"
import { type ImageRef, ROOT } from "@pinetrie/core"
import { readBanners } from "@pinetrie/reads"
import { projectTranscript } from "@pinetrie/threads"
import type { Checks } from "../checks.ts"
import {
  heldLaneNames,
  heldTree,
  idleNow,
  join,
  START_AGENT,
  SUITE_CONFIG,
  startSuiteHost,
  suitePlaces,
  tipIn,
  untilSent,
  waitFor,
} from "../harness.ts"
import { imageSize, RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { startedRunId } from "./support.ts"

export const scenario: Scenario = {
  requires: ["live-model"],
  run: ({ check }) => run(check),
}

const PROMPT = "Say exactly: PINETRIE-OK"
/**
 * The places of a live host: the suite's, but the person's own data
 * directory, for the credential `pnpm sign-in cerebras` stored (or
 * `CEREBRAS_API_KEY`). Nothing else of the person's is read.
 */
const livePlaces = (user?: Readonly<Record<string, unknown>>) =>
  suitePlaces({
    ...(user === undefined ? {} : { user }),
    data: configPlaces(process.env, homedir(), null).dirs.data,
  })

/** The suites' own real model, named: never the person's configured one, which costs them. */
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
    places: livePlaces(),
    env: process.env,
    log: () => {},
  })
  const asker = await join(live, "asker", "live")
  await untilSent(live, await asker.send(PROMPT, ROOT, START_AGENT), 120_000)
  const [lane] = heldLaneNames(live)
  const last = projectTranscript(
    heldTree(live),
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
  const shown = await asker.send(
    `What colour is this image? Answer in one word. ![square](/blob/${red.sha256})`,
    ROOT,
    START_AGENT,
  )
  await waitFor(() => idleNow(live), 120_000)
  // A message at the root begins a thread of its own: its lane is the new one.
  const imageLane = heldLaneNames(live).find(l => l !== lane)
  const seenBy = projectTranscript(
    heldTree(live),
    imageLane === undefined ? null : tipIn(live, imageLane),
  ).at(-1)
  console.log(`  model said of the image: ${JSON.stringify(seenBy?.text)}`)
  check(
    "a real model reads a pasted image: it names its colour",
    startedRunId(shown) !== "" &&
      seenBy?.role === "assistant" &&
      /red/i.test(seenBy.text),
  )
  await asker.close()
  await live.shutdown()

  // A banner drawn by the real image model: a square icon, as the request's
  // `aspect_ratio` of 1:1 asks.
  const bannerLog: string[] = []
  const drawing = await startSuiteHost({
    port: 0,
    model: LIVE_MODEL,
    places: livePlaces({ ...SUITE_CONFIG, icons: { source: "drawn" } }),
    env: process.env,
    log: line => bannerLog.push(line),
  })
  const painter = await join(drawing, "painter", "live")
  await untilSent(
    drawing,
    await painter.send(
      "Name three birds of spring marshes, in one line.",
      ROOT,
      START_AGENT,
    ),
    120_000,
  )
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
