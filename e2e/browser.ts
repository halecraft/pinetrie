// e2e/browser — drive a REAL browser against the host, from inside the jail.
//
// Why a remote browser: pi-jail (Seatbelt) denies `mach-register`, and Chromium
// must register `MachPortRendezvousServer` via `bootstrap_check_in` to talk to
// its own child processes. So a browser cannot be *launched* here. It can be
// *driven* here — the jail does not restrict loopback, and Playwright's
// connect() is pure websocket.
//
// Upstream: anthropics/sandbox-runtime#210 (open, 0 comments); the fix, PR #407,
// was closed unmerged. Neither srt 0.0.75 (ours) nor 0.0.77 (latest) can emit
// `mach-register`.
//
// START THE SERVER OUTSIDE THE JAIL, in a normal terminal:
//
//     cd ~/halecraft/pineta
//     pnpm exec playwright run-server --port 3100
//
// then, in here:
//
//     pnpm run e2e:browser
//
// Override the endpoint with PW_SERVER if you used a different port.

import { entryId, projectTranscript } from "@pineta/core"
import { readLaneNames, readLaneTip } from "@pineta/schema"
import { type Browser, chromium } from "@playwright/test"
import { readRenderableEntries } from "../client/projection.ts"
import { connectSession } from "../client/session-view.ts"
import { startHost } from "../host/index.ts"
import { createChecks, waitFor } from "./harness.ts"

const PW_SERVER = process.env.PW_SERVER ?? "ws://localhost:3100/"

const { ok, report } = createChecks()

let browser: Browser
try {
  browser = await chromium.connect(PW_SERVER, { timeout: 5000 })
} catch (error: unknown) {
  console.error(`\n  Could not reach a Playwright server at ${PW_SERVER}`)
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`  ${detail.split("\n")[0]}\n`)
  console.error(`  Start one OUTSIDE the jail:`)
  console.error(`      cd ~/halecraft/pineta`)
  console.error(`      pnpm exec playwright run-server --port 3100\n`)
  console.error(
    `  (it cannot be launched from inside — see the header of this file)`,
  )
  process.exit(2)
}

console.log(`\n=== Pineta — real browser against a real host ===`)
console.log(`  playwright server : ${PW_SERVER}`)
console.log(`  browser           : ${browser.version()}\n`)

const host = await startHost({
  log: (m: string) => console.log("    [host]", m),
})
console.log(`  host              : ${host.httpUrl}\n`)

const page = await browser.newPage()
const errors: string[] = []
page.on("pageerror", e => errors.push(String(e.message)))
page.on("console", m => m.type() === "error" && errors.push(m.text()))

try {
  await page.goto(host.httpUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  })

  // The bundle must instantiate the Loro wasm before anything renders. A
  // mismatched wasm/glue pair fails exactly here, with a LinkError — which is
  // the bug a browser-free check cannot see.
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent === "connected",
    { timeout: 20_000 },
  )
  ok(true, "page loaded, wasm instantiated, client connected to the host")
  ok(
    errors.length === 0,
    `no page errors during load${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
  )

  const lane = (await page.textContent("#lane"))?.trim() ?? ""
  ok(lane.startsWith("w-"), `lane carries writer identity, not "main": ${lane}`)

  await page.fill("#input", "Say exactly: BROWSER-OK")
  await page
    .click("#form button, #form [type=submit]")
    .catch(() => page.press("#input", "Enter"))

  // Streaming must be visible *before* the turn commits — that is ADR-0014's
  // Schema.text() insert path, observed through a real DOM.
  const streamed = await page
    .waitForFunction(() => !document.getElementById("streaming")?.hidden, {
      timeout: 30_000,
    })
    .then(() => true)
    .catch(() => false)
  ok(streamed, "streaming text appeared in the DOM while the turn was running")

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".msg.assistant .text")].some(n =>
        n.textContent?.includes("BROWSER-OK"),
      ),
    { timeout: 60_000 },
  )
  ok(true, "assistant reply rendered in the DOM")

  const roles = await page.$$eval(".msg", ns =>
    ns.map(n => n.className.replace("msg ", "")),
  )
  ok(
    roles.join(",").includes("user,assistant"),
    `transcript ordered by parentId walk: [${roles.join(", ")}]`,
  )

  // A fork, written host-side exactly as another replica would write it, then
  // asserted in the RENDERED DOM. A spine with no branch proves nothing, so
  // the fixture has to actually fork.
  const before = await page.$$eval(".fork", ns => ns.length)
  ok(before === 0, `no fork marker before the branch exists (${before})`)

  // The page is the only writer so far, so its lane is the only one recorded.
  const pageLane = readLaneNames(host.doc)[0] ?? ""
  const tip = readLaneTip(host.doc, pageLane)
  const parentId =
    projectTranscript(readRenderableEntries(host.doc), tip).at(-2)?.id ?? null
  ok(parentId !== null, "found a parent to fork from")
  if (parentId !== null) {
    // The v1 demo's frame: ANOTHER writer branches off the page's message.
    // It has its own lane (ADR-0011), so the page's lane is never touched and
    // nothing has to be moved back afterwards. It goes through the protocol
    // and pi, so the aside is an entry pi created and the page can navigate
    // into it later.
    const other = await connectSession({
      url: host.wsUrl,
      WebSocket,
      peerId: "browser-other-writer",
    })
    const aside = await other.prompt("an aside", entryId(parentId))
    ok(aside.kind === "started", "another writer's aside was accepted")
    await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
    ok(
      readLaneTip(host.doc, pageLane) === tip,
      "the other writer's aside did not move the page's lane",
    )
    await other.close()

    await page.waitForFunction(
      () => document.querySelectorAll(".fork").length > 0,
      { timeout: 15_000 },
    )
    ok(true, "the fork replicated and rendered a branch marker")

    const summary = await page.$eval(".fork button", n => n.textContent ?? "")
    // Exact text, not `includes`. A looser check passed while the marker
    // rendered the literal characters `\u2442` and `\u00b7`, because JSX text
    // does not process escapes. The screenshot caught it; this now would.
    ok(
      // Two, because the aside is a real turn: the user entry and the reply.
      summary.trim() === "⑂ 1 branch · 2 messages",
      `the marker summarises the branch: "${summary.trim()}"`,
    )

    await page.click(".fork button")
    const label = await page.$eval(".outside", n => n.textContent ?? "")
    ok(
      label.trim() === "not in your context",
      `the context boundary is stated in words: "${label.trim()}"`,
    )

    const spineNodes = await page.$$eval(
      "#transcript > div > .msg",
      ns => ns.length,
    )
    ok(
      spineNodes === 2,
      `the branch does NOT join the spine (${spineNodes} spine nodes)`,
    )
  }

  // The first end-to-end proof that a USER can fork a conversation: read a
  // branch, type into it, and the turn attaches there rather than at the lane
  // tip they navigated away from.
  await page.click(".branch button")
  await page.click(".fork button") // collapse the preview
  const offLane = await page.$eval("#offLane", n => n.textContent ?? "")
  ok(
    offLane.includes("fork from here"),
    `reading a branch says sending will fork: "${offLane.trim().slice(0, 48)}"`,
  )
  const sendLabel = await page.$eval("#send", n => n.textContent ?? "")
  ok(
    sendLabel.trim() === "branch from here",
    `the composer offers to branch, not to refuse: "${sendLabel.trim()}"`,
  )

  await page.fill("#input", "BRANCH-FROM-BROWSER")
  await page.click("#send")
  // The reply is the ACCEPTANCE, not the completion, so wait for the entry to
  // commit and replicate rather than for the status to settle.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#transcript .text")].some(n =>
        n.textContent?.includes("BRANCH-FROM-BROWSER"),
      ),
    undefined,
    { timeout: 60_000 },
  )
  ok(true, "the branch turn ran and the spine re-rooted")

  const rendered = await page.$$eval("#transcript .text", ns =>
    ns.map(n => n.textContent ?? ""),
  )
  ok(
    rendered.some(t => t.includes("BRANCH-FROM-BROWSER")),
    "the branched message renders on the new spine",
  )

  // Coming BACK. The lane is now on the branch, so the trunk shows as a fork
  // marker on the first spine node. Read it, then switch the lane to it.
  // Without the navigate command this is impossible: a branch is one-way.
  await page.click("#transcript > div:first-child .fork button")
  await page.click("#transcript > div:first-child .branch button")
  // Reading the trunk ALREADY renders the trunk spine, so waiting on the
  // spine proves nothing about switching. Assert what only a switch changes:
  // the off-lane bar goes away, and the HOST's lane tip is on the trunk.
  ok(
    (await page.$("#offLane")) !== null,
    "reading the trunk is off-lane before switching",
  )
  await page.click("#switchLane")
  await page.waitForFunction(
    () => document.querySelector("#offLane") === null,
    undefined,
    {
      timeout: 15_000,
    },
  )
  const hostLane = projectTranscript(
    readRenderableEntries(host.doc),
    readLaneTip(host.doc, pageLane),
  ).map(m => m.text)
  ok(
    hostLane.some(t => t.includes("BROWSER-OK")) &&
      !hostLane.some(t => t.includes("BRANCH-FROM-BROWSER")),
    `switched back: the page's lane in the HOST is the trunk again (${hostLane.length} messages)`,
  )

  // A SECOND WINDOW joins the live session. It has written nothing, so it has
  // no lane: it must show the most recently advanced lane by default, and its
  // composer must offer to branch, because sending forks from what it reads.
  // Getting the default wrong would make a joining window fork from a stale
  // point without anyone noticing.
  const second = await browser.newPage()
  try {
    await second.goto(host.httpUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })
    // Resolve to a boolean rather than throwing, so a wrong default view is
    // reported as a labelled FAIL instead of a crashed suite.
    const rendered = await second
      .waitForFunction(
        () => document.querySelectorAll("#transcript .msg").length > 0,
        undefined,
        { timeout: 20_000 },
      )
      .then(
        () => true,
        () => false,
      )
    ok(rendered, "a joining window renders a conversation at all")
    const joined = await second.$$eval("#transcript > div > .msg .text", ns =>
      ns.map(n => n.textContent ?? ""),
    )
    ok(
      joined.some(t => t.includes("BROWSER-OK")),
      `a joining window shows the live lane by default (${joined.length} messages)`,
    )
    const joinedSend = await second.$eval("#send", n => n.textContent ?? "")
    ok(
      joinedSend.trim() === "branch from here",
      `a joining window is off-lane, so it branches: "${joinedSend.trim()}"`,
    )
  } finally {
    await second.close().catch(() => {})
  }

  ok(
    errors.length === 0,
    `no page errors overall${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
  )

  const shot = "e2e/browser-screenshot.png"
  await page.screenshot({ path: shot })
  console.log(`\n  screenshot: ${shot}`)
} finally {
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
  // `RunningHost` exposes `shutdown()`, not `close()`. The old
  // `host.close?.()` was always a no-op, so the host (and its websocket
  // server) leaked for the life of the process. Optional chaining hid it.
  await host.shutdown().catch(() => {})
}

report("browser e2e")
