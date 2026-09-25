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

import { readParticipantNames } from "@pineta/client/projection"
import { connectSession } from "@pineta/client/session"
import { entryId } from "@pineta/core"
import { type Browser, chromium } from "@playwright/test"
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

  // A display name: a label, stored by lane, shown to everyone.
  await page.fill("#name", "Ada")
  await page.press("#name", "Enter")
  const named = await waitFor(
    () => readParticipantNames(host.doc).get(lane) === "Ada",
    15_000,
  )
  ok(named >= 0, "the name typed in the header is stored for this lane")
  await page.waitForFunction(
    () => document.getElementById("seenBy")?.textContent?.includes("Ada"),
    undefined,
    { timeout: 15_000 },
  )
  ok(true, "the composer says who will see the message")

  // The session's root is a working session, and the composer says so before
  // anything is sent.
  const mode = await page.getAttribute("#thread", "data-mode")
  ok(mode === "session", `a fresh session is a working session (${mode})`)
  const label = async () => (await page.textContent("#send"))?.trim() ?? ""
  ok(
    (await label()) === "send · agent will reply",
    `the composer promises a reply in a working session: "${await label()}"`,
  )

  await page.fill("#input", "Say exactly: BROWSER-OK")
  await page.click("#send")

  // Streaming must be visible *before* the turn commits — that is ADR-0014's
  // Schema.text() insert path, observed through a real DOM. The agent streams
  // on its own lane, and every window shows it.
  const streamed = await page
    .waitForFunction(() => !document.getElementById("streaming")?.hidden, {
      timeout: 30_000,
    })
    .then(() => true)
    .catch(() => false)
  ok(streamed, "streaming text appeared in the DOM while the turn was running")

  const replied = (token: string) =>
    page
      .waitForFunction(
        t =>
          [...document.querySelectorAll(".msg.assistant .text")].some(n =>
            n.textContent?.includes(t),
          ),
        token,
        { timeout: 60_000 },
      )
      .then(
        () => true,
        () => false,
      )
  ok(await replied("BROWSER-OK"), "the agent's reply rendered in the DOM")

  const roles = await page.$$eval("#transcript > div > .msg", ns =>
    ns.map(
      n =>
        `${n.className.replace("msg ", "")}:${n.querySelector(".role")?.textContent}`,
    ),
  )
  ok(
    roles.join(",") === "chat asked:Ada,assistant:assistant",
    `the spine is Ada's message, marked as asked, then the reply: [${roles.join(", ")}]`,
  )
  ok(
    (await page.$$eval(".joined", ns => ns.length)) === 1,
    "the thread shows where the agent joined",
  )

  // Switching to a conversation changes the promise, and the promise holds:
  // a plain message runs nothing; `@agent` runs the agent.
  await page.click("#threadMode")
  await page.waitForFunction(
    () => document.getElementById("thread")?.dataset.mode === "conversation",
    undefined,
    { timeout: 15_000 },
  )
  ok(true, "the thread became a conversation")
  await page.fill("#input", "just a note")
  const plainLabel = await label()
  const plainPromise = (await page.$("#willReply")) !== null
  const assistantsBefore = await page.$$eval(".msg.assistant", n => n.length)
  await page.click("#send")
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#transcript .text")].some(n =>
        n.textContent?.includes("just a note"),
      ),
    undefined,
    { timeout: 30_000 },
  )
  await new Promise(r => setTimeout(r, 1500))
  const assistantsAfter = await page.$$eval(".msg.assistant", n => n.length)
  ok(
    plainLabel === "send" &&
      !plainPromise &&
      assistantsAfter === assistantsBefore &&
      Object.keys(host.doc.activeRuns()).length === 0,
    `in a conversation the composer promised no reply, and none came ("${plainLabel}")`,
  )
  await page.fill("#input", "@agent say exactly: BROWSER-TWO")
  const askLabel = await label()
  const askPromise = (await page.$("#willReply")) !== null
  await page.click("#send")
  ok(
    askLabel === "send · agent will reply" &&
      askPromise &&
      (await replied("BROWSER-TWO")),
    `typing @agent promised a reply, and it came ("${askLabel}")`,
  )

  // A fork, written by ANOTHER writer through the protocol, then asserted in
  // the RENDERED DOM. It attaches at Ada's first message, which is in the
  // root's working session, so it is a real turn: a message and a reply.
  const before = await page.$$eval(".fork", ns => ns.length)
  ok(before === 0, `no fork marker before the branch exists (${before})`)
  const firstId = await page.$eval(
    "#transcript > div:first-child .msg",
    n => n.getAttribute("data-entry") ?? "",
  )
  const other = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "browser-other-writer",
  })
  const aside = await other.chat("an aside", {
    kind: "entry",
    id: entryId(firstId),
  })
  ok(
    aside.kind === "started",
    `another writer's aside was accepted (${aside.kind})`,
  )
  await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
  await other.close()

  const forked = await page
    .waitForFunction(
      () => document.querySelectorAll(".fork").length > 0,
      undefined,
      {
        timeout: 15_000,
      },
    )
    .then(
      () => true,
      () => false,
    )
  ok(forked, "the fork replicated and rendered a branch marker")
  const texts = async (p = page) =>
    p.$$eval("#transcript > div > .msg .text", ns =>
      ns.map(n => n.textContent ?? ""),
    )
  ok(
    (await texts()).some(t => t.includes("BROWSER-TWO")) &&
      !(await texts()).some(t => t.includes("an aside")),
    "the newer branch does not pull the view away from the thread being read",
  )
  const summary = await page.$eval(".fork button", n => n.textContent ?? "")
  // Exact text, not `includes`. A looser check passed while the marker
  // rendered the literal characters `\u2442` and `\u00b7`, because JSX text
  // does not process escapes. The screenshot caught it; this now would.
  ok(
    summary.trim() === "⑂ 1 branch · 2 messages",
    `the marker summarises the branch: "${summary.trim()}"`,
  )
  await page.click(".fork button")
  const outside = await page.$eval(".outside", n => n.textContent ?? "")
  ok(
    outside.trim() === "not in your context",
    `the context boundary is stated in words: "${outside.trim()}"`,
  )

  // Read the branch, and send there: a message goes where you are reading.
  await page.click(".branch button")
  await page.click(".fork button") // collapse the preview; it stays mounted
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#transcript .text")].some(n =>
        n.textContent?.includes("an aside"),
      ),
    undefined,
    { timeout: 15_000 },
  )
  ok((await page.$("#reading")) !== null, "reading a branch says so")
  await page.fill("#input", "BRANCH-FROM-BROWSER")
  await page.click("#send")
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#transcript .text")].some(n =>
        n.textContent?.includes("BRANCH-FROM-BROWSER"),
      ),
    undefined,
    { timeout: 60_000 },
  )
  ok(
    (await texts()).some(t => t.includes("an aside")),
    "the message was sent on the branch being read, below the aside",
  )

  // Coming BACK: the trunk is now a fork marker on the first node. Reading it
  // shows the trunk again, with nothing from the branch.
  await page.click("#transcript > div:first-child .fork button")
  await page.click("#transcript > div:first-child .branch button")
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#transcript .text")].some(n =>
        n.textContent?.includes("BROWSER-TWO"),
      ),
    undefined,
    { timeout: 15_000 },
  )
  const trunk = await texts()
  ok(
    trunk.some(t => t.includes("BROWSER-TWO")) &&
      !trunk.some(t => t.includes("BRANCH-FROM-BROWSER")),
    `reading the trunk again shows the trunk alone (${trunk.length} messages)`,
  )

  // A SECOND WINDOW joins. Having chosen nothing, it follows the newest tip
  // overall, and the root's working session means it would be answered.
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
    const joined = await texts(second)
    ok(
      joined.some(t => t.includes("BRANCH-FROM-BROWSER")),
      `a joining window follows the newest thread (${joined.length} messages)`,
    )

    // The v1 demo, completed: B asks, which gives B a lane to cite from, then
    // cites A's first message. A sees the backlink; A's spine is unchanged.
    await second.fill("#input", "B asks about this")
    await second.click("#send")
    await second.waitForFunction(
      () =>
        [...document.querySelectorAll("#transcript .text")].some(n =>
          n.textContent?.includes("B asks about this"),
        ),
      undefined,
      { timeout: 60_000 },
    )
    await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
    const spineBefore = await page.$$eval(
      "#transcript > div > .msg",
      n => n.length,
    )
    await second.click("#transcript > div:first-child .cite")
    const shown = await page
      .waitForFunction(
        () => document.querySelector(".cited-by") !== null,
        undefined,
        {
          timeout: 15_000,
        },
      )
      .then(
        () => true,
        () => false,
      )
    ok(shown, "B's citation appears live in A's window as a backlink")
    const marker = await page
      .$eval(".cited-by", n => n.textContent ?? "")
      .catch(() => "")
    ok(marker.includes("cited by 1"), `A sees "${marker.trim()}"`)
    const spineAfter = await page.$$eval(
      "#transcript > div > .msg",
      n => n.length,
    )
    ok(
      spineAfter === spineBefore,
      `A's spine is unchanged by the citation (${spineBefore} -> ${spineAfter})`,
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
