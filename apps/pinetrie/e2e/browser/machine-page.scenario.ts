// e2e/browser/machine-page — the Machine page over a host whose lane runs:
// the footer's glyph opens it, a running lane is named by its thread, and
// Copy diagnostics copies one text that says which host it came from.

import { isThreadId } from "@pinetrie/core"
import { thisInstall } from "@pinetrie/install"
import { scriptedModel } from "@pinetrie/pi"
import { readNames } from "@pinetrie/reads"
import { hostVersion } from "../../host/machine/diagnostics.ts"
import type { Checks } from "../checks.ts"
import { gateClose, gateCommand, newGate } from "../gate.ts"
import { waitFor } from "../harness.ts"
import { inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { asPerson, col, launchBrowser, typeAfter } from "./page.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const browser = await launchBrowser()
  const script = scriptedModel({ tokensPerSecond: 400 })
  const section = await lanes.sectionHost({
    files: { "notes.txt": "hello\n" },
    model: { kind: "scripted", script },
  })
  const { host } = section
  const held = newGate("machine-page")
  let lane: string | null = null
  try {
    const context = await browser.newContext()
    // Copy diagnostics writes the clipboard, which the check reads.
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const page = await context.newPage()
    await asPerson(page, "mia@browser.test", "Mia")
    await page.goto(host.httpUrl, { waitUntil: "domcontentloaded" })

    // A run held at a gate: its lane's container runs while the page reads.
    script.use([
      {
        tool: "bash",
        args: { intent: `Wait at ${held.fifo}`, command: gateCommand(held) },
      },
      { text: "Done waiting." },
    ])
    await page.click("#sidebar .add-canvas")
    await typeAfter(page, `${col(0)} .composer .input`, "wait at the gate")
    await page.click(`${col(0)} .composer .send`)
    // The thread's first run starts its lane, which a loaded machine can
    // take a while to do.
    await page.waitForSelector(
      `${col(0)} .tool.live:has-text("pinetrie-gate")`,
      { timeout: 60_000 },
    )
    lane = await page.getAttribute(col(0), "data-card")

    // 1. The footer's glyph opens the page.
    await page.click("footer button.machine-status")
    const opened = await page
      .waitForFunction(() => location.hash === "#machine", undefined, {
        timeout: 10_000,
      })
      .then(
        () => true,
        () => false,
      )
    check(
      "the footer's machine status opens the Machine page",
      opened && (await page.$(".machine-page")) !== null,
      await page.evaluate(() => location.hash),
    )

    // 2. The running lane, by its thread's name, once the host has named
    // it and a sample has read it.
    const named = await waitFor(() => {
      if (lane === null || !isThreadId(lane)) return false
      return readNames(host.session).get(lane) !== undefined
    }, 60_000)
    const name =
      lane !== null && isThreadId(lane)
        ? (readNames(host.session).get(lane) ?? null)
        : null
    const row = `.machine-threads li[data-lane="${lane ?? ""}"]`
    const rowText = await page
      .waitForFunction(
        ([sel, want]) =>
          want !== null &&
          (document.querySelector(sel)?.textContent ?? "").startsWith(want),
        [row, name] as const,
        { timeout: 30_000 },
      )
      .then(
        () => page.textContent(row),
        () => page.textContent(row).catch(() => null),
      )
    check(
      "the Machine page names each lane by its thread",
      named >= 0 && name !== null && (rowText ?? "").startsWith(name),
      `${name ?? "unnamed"}: ${rowText ?? "no row"}`,
    )

    // 3. Copy diagnostics copies one text, holding the host's version.
    const version = await hostVersion(thisInstall.root)
    await page.evaluate(() => navigator.clipboard.writeText(""))
    await page.click(".machine-copy")
    let copied = ""
    await waitFor(async () => {
      copied = await page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => "")
      return copied !== ""
    }, 15_000)
    check(
      "Copy diagnostics copies the page's words and the host's version",
      version !== null &&
        copied.startsWith("Now:") &&
        copied.includes(`"version":"${version}"`),
      copied.slice(0, 200),
    )
  } finally {
    if (lane !== null && isThreadId(lane))
      await inLaneQuiet(lane, gateClose(held)).catch(() => {})
    await browser.close()
    await section.close()
  }
}
