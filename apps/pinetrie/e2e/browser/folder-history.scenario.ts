// e2e/browser/folder-history — a folder project's history page: your save
// listed, its review drawing an image's two sides as images, and a restore
// of the version before it, which writes its files back into the folder.

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { scriptedModel } from "@pinetrie/pi"
import { readAccepted } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import { waitFor } from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { asPerson, launchBrowser } from "./page.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

/** Two 1×1 GIFs: each holds a NUL, so its bytes say it is an image. */
const GIF_CLEAR = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
)
const GIF_RED = Buffer.from(
  "R0lGODlhAQABAPAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
)

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-folder-")))
  chmodSync(dir, 0o755)
  writeFileSync(path.join(dir, "a.txt"), "first\n")
  writeFileSync(path.join(dir, "a.gif"), GIF_CLEAR)
  const host = await lanes.startHost({
    model: { kind: "scripted", script: scriptedModel() },
    project: { dir, tools: true },
    log: m => {
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  const newest = () => {
    const r = readAccepted(host.session)
    return r?.kind === "folder" ? r : null
  }
  const browser = await launchBrowser()
  try {
    await waitFor(() => newest() !== null, 60_000)
    const first = newest()?.newest
    writeFileSync(path.join(dir, "a.txt"), "second\n")
    writeFileSync(path.join(dir, "a.gif"), GIF_RED)
    await waitFor(
      () => newest()?.newest !== first && (newest()?.kept.length ?? 0) >= 2,
      60_000,
    )
    const p = await (await browser.newContext()).newPage()
    const answers: string[] = []
    p.on("response", r => {
      if (new URL(r.url()).pathname.startsWith("/review/"))
        answers.push(`${r.status()} ${r.url()}`)
    })
    await asPerson(p, "hana@browser.test", "Hana")
    await p.goto(`${host.httpUrl}#history`, { waitUntil: "domcontentloaded" })
    const entries = ".history-entries > .history-entry"
    const listed = await p
      .waitForFunction(
        sel => {
          const words = [...document.querySelectorAll(sel)].map(
            e => e.querySelector(".history-words")?.textContent ?? "",
          )
          // Each entry once both reads are drawn; nothing before.
          return words.length >= 2 ? words : null
        },
        entries,
        { timeout: 30_000 },
      )
      .then(h => h.jsonValue())
      .catch(() => [] as string[])
    check(
      "the history lists your save in the project's folder, newest first",
      Array.isArray(listed) &&
        listed.length >= 2 &&
        listed[0] === "saved in the project's folder",
      JSON.stringify(listed),
    )

    // The newest save's review draws the image's before and after.
    await p.click(`${entries}:first-child .history-review`)
    const drawn = await p
      .waitForFunction(
        () => {
          const imgs = [
            ...document.querySelectorAll<HTMLImageElement>(
              '.review-file[data-media="image"] .review-media img',
            ),
          ]
          return imgs.length === 2 && imgs.every(i => i.naturalWidth === 1)
        },
        undefined,
        { timeout: 30_000 },
      )
      .then(
        () => true,
        () => false,
      )
    check(
      "an image's row in a review draws its two sides as images",
      drawn,
      JSON.stringify(
        await p
          .locator(".review-file")
          .evaluateAll(fs => fs.map(f => f.outerHTML.slice(0, 300))),
      ),
    )

    // Restoring the version before it writes its files back.
    await p.click(`${entries}:nth-child(2) .history-restore`)
    await p
      .click(".history-preview .history-restore-confirm", { timeout: 30_000 })
      .catch(async (error: unknown) => {
        // What the page held instead, for a run that cannot be watched.
        const held = await p
          .locator(".history")
          .evaluate(h => h.outerHTML.slice(0, 4000))
          .catch(() => "no .history")
        throw new Error(
          `${String(error)}\naccepted: ${JSON.stringify(newest())}\nreviews fetched: ${JSON.stringify(answers)}\npage: ${held}`,
        )
      })
    const restored = await waitFor(
      () =>
        readFileSync(path.join(dir, "a.txt"), "utf8") === "first\n" &&
        readFileSync(path.join(dir, "a.gif")).equals(GIF_CLEAR),
      60_000,
    )
    check(
      "restore writes the version chosen back into the project's folder",
      restored >= 0,
      readFileSync(path.join(dir, "a.txt"), "utf8"),
    )
  } finally {
    await browser.close().catch(() => {})
    await host.shutdown().catch(() => {})
    await cleanUp(host.session, dir)
  }
}
