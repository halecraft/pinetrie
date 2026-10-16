// e2e/host/banners — an image behind each thread's column header.

import { type ImageRef, messageText, ROOT } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readBanners, readPlaces } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import { BLOB_GRACE_MS } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  at,
  entriesOf,
  lanesOf,
  START_AGENT,
  SUITE_CONFIG,
  suiteClock,
  suitePlaces,
  treeOf,
  waitFor,
} from "../harness.ts"
import { RED_PNG } from "../images.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { idOfIn } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // Turned on by the suite's config. A scripted model draws a fixed image; the
  // host's clock is moved past the grace, so the sweep's handling of banners
  // shows.
  {
    const script = scriptedModel({ answer: { text: "noted" } })
    const clock = suiteClock()
    const {
      host: bh,
      user: bu,
      idle: bidle,
      close,
    } = await lanes.sectionHost({
      files: { "a.txt": "a\n" },
      model: { kind: "scripted", script },
      places: suitePlaces({
        user: { ...SUITE_CONFIG, icons: { source: "drawn" } },
      }),
      now: clock.now,
    })
    await bu.request({ kind: "name", name: "Bea" })
    const blobAt = (sha: string) => fetch(`${bh.httpUrl}blob/${sha}`)

    // 1. A new thread's banner is made as it is named, while its first run is
    //    still going.
    const planning = script.hold("plan the parser")
    await bu.send("@agent plan the parser", ROOT, START_AGENT)
    await waitFor(() => planning.reached, 10_000)
    const bannerOfFirst = () => {
      const [first] = lanesOf(bh, treeOf(bh), readPlaces(bh.places))
      return first === undefined
        ? undefined
        : readBanners(bh.session).get(first.name)
    }
    const madeEarly =
      (await waitFor(() => bannerOfFirst() !== undefined, 10_000)) >= 0
    planning.finish()
    await bidle()
    const [lane] = lanesOf(bh, treeOf(bh), readPlaces(bh.places)).map(
      l => l.name,
    )
    const made =
      lane === undefined ? undefined : readBanners(bh.session).get(lane)
    check(
      "a new thread's banner is made as it is named, before its first run ends, stored and served as an image",
      madeEarly &&
        made !== undefined &&
        (await blobAt(made.sha)).status === 200,
    )

    // 2. The sweep keeps a banner nothing else shows.
    clock.advance(BLOB_GRACE_MS + 1)
    const reply = idOfIn(bh, "noted")
    await bu.send("@agent and the lexer", at(reply), { mode: "reply" })
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
    await bu.send(
      `@agent use this as the banner ![red](/blob/${red.sha256})`,
      at(idOfIn(bh, "noted")),
      { mode: "reply" },
    )
    await bidle()
    const toolSaid = Object.values(entriesOf(bh))
      .map(rowMessage)
      .filter(m => (m as { role?: string }).role === "toolResult")
      .map(m => messageText(m as never))
    const now =
      lane === undefined ? undefined : readBanners(bh.session).get(lane)
    check(
      "set_banner sets a pasted image as the thread's banner, and tells the agent",
      now?.sha === red.sha256 && toolSaid.includes("The banner is set."),
    )
    clock.advance(BLOB_GRACE_MS + 1)
    await bu.send("@agent thanks", at(idOfIn(bh, "set it")), {
      mode: "reply",
    })
    await bidle()
    await close()
  }
}
