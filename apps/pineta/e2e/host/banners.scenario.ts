// e2e/host/banners — an image behind each thread's column header (ADR-0050, ADR-0053).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ImageRef, messageText, ROOT } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import { readBanners, readCards, readLanes, readTreeIndex } from "@pineta/reads"
import { readEntries, rowMessage } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import { committedProject, idleNow, join, waitFor } from "../harness.ts"
import { RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { at, idOfIn, START_AGENT, sleep } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // Turned on by the user config. A scripted model draws a fixed image; the
  // grace is short, so the sweep's handling of banners shows.
  {
    const project = committedProject("pineta-banners-", { "a.txt": "a\n" })
    const userConfig = path.join(
      mkdtempSync(path.join(tmpdir(), "pineta-banner-config-")),
      "config.json",
    )
    writeFileSync(userConfig, JSON.stringify({ banner: { enabled: true } }))
    const script = scriptedModel({ answer: { text: "noted" } })
    const GRACE_MS = 1_000
    const bh = await startHost({
      model: { kind: "scripted", script },
      tools: { project },
      containers: false,
      userConfig,
      blobGraceMs: GRACE_MS,
      log: () => {},
    })
    const bu = await join(bh, "bea", "banners")
    await bu.setName("Bea")
    const bidle = async () => {
      await waitFor(() => idleNow(bh), 60_000)
      await bh.quiet()
    }
    const blobAt = (sha: string) => fetch(`${bh.httpUrl}blob/${sha}`)

    // 1. A new thread's banner is made as it is named, while its first run is
    //    still going.
    const planning = script.pause("plan the parser")
    await bu.chat("@agent plan the parser", ROOT, START_AGENT)
    await waitFor(() => planning.reached, 10_000)
    const bannerOfFirst = () => {
      const [first] = readLanes(
        bh.doc,
        readTreeIndex(bh.doc),
        readCards(bh.cards),
      )
      return first === undefined
        ? undefined
        : readBanners(bh.doc).get(first.name)
    }
    const madeEarly =
      (await waitFor(() => bannerOfFirst() !== undefined, 10_000)) >= 0
    planning.resume()
    await bidle()
    const [lane] = readLanes(
      bh.doc,
      readTreeIndex(bh.doc),
      readCards(bh.cards),
    ).map(l => l.name)
    const made = lane === undefined ? undefined : readBanners(bh.doc).get(lane)
    check(
      "a new thread's banner is made as it is named, before its first run ends, stored and served as an image",
      madeEarly &&
        made !== undefined &&
        (await blobAt(made.sha)).status === 200,
    )

    // 2. The sweep keeps a banner nothing else shows.
    await sleep(GRACE_MS + 200)
    const reply = idOfIn(bh.doc, "noted")
    await bu.chat("@agent and the lexer", at(reply), { mode: "reply" })
    await bidle()

    // 3. `set_banner` sets a pasted image; the one it replaces is swept.
    const response = await fetch(`${bh.httpUrl}blob`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(RED_PNG),
    })
    const red = (await response.json()) as ImageRef
    script.use([
      {
        tool: "set_banner",
        args: { image: `/blob/${red.sha256}` },
      },
      { text: "set it" },
    ])
    await bu.chat(
      `@agent use this as the banner ![red](/blob/${red.sha256})`,
      at(idOfIn(bh.doc, "noted")),
      { mode: "reply" },
    )
    await bidle()
    const toolSaid = Object.values(readEntries(bh.doc))
      .map(rowMessage)
      .filter(m => (m as { role?: string }).role === "toolResult")
      .map(m => messageText(m as never))
    const now = lane === undefined ? undefined : readBanners(bh.doc).get(lane)
    check(
      "set_banner sets a pasted image as the thread's banner, and tells the agent",
      now?.sha === red.sha256 && toolSaid.includes("The banner is set."),
    )
    await sleep(GRACE_MS + 200)
    await bu.chat("@agent thanks", at(idOfIn(bh.doc, "set it")), {
      mode: "reply",
    })
    await bidle()
    await bu.close()
    await sleep(100)
    await bh.shutdown()
  }
}
