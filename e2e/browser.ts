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

import { type Browser, chromium } from "@playwright/test"
import { startHost } from "../host/index.ts"
import { createChecks } from "./harness.ts"

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

const host = await startHost({ log: () => {} })
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
