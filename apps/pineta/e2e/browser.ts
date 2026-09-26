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

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { connectSession } from "@pineta/client/session"
import { atEntry, entryId, projectRail } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import { readParticipantNames, readTreeIndex } from "@pineta/reads"
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
  // The suites' own model: never the person's pi setup, which costs them.
  model: { kind: "named", provider: "cerebras", model: "qwen-3.8-27b" },
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

  ok(
    (await page.$("#lane")) === null,
    "the header shows no lane: people own none, threads do",
  )

  // ── helpers ──────────────────────────────────────────────────────────────
  /** A message for Ada only: it names her, so in agent work it asks no one. */
  const NOTE = "@Ada just a note"
  const col = (n: number) => `.column[data-position="${n}"]`
  const msg = (text: string) =>
    `.msg:has(> .text:text-is(${JSON.stringify(text)}))`
  const label = async (n: number) =>
    (await page.textContent(`${col(n)} .composer .send`))?.trim() ?? ""
  const send = async (n: number, text: string) => {
    await page.fill(`${col(n)} .composer .input`, text)
    await page.click(`${col(n)} .composer .send`)
  }
  const idle = () =>
    waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
  const shows = (text: string, scope = "") =>
    page
      .waitForSelector(`${scope} ${msg(text)}`.trim(), { timeout: 60_000 })
      .then(
        () => true,
        () => false,
      )
  const texts = (n: number) =>
    page.$$eval(`${col(n)} .msg > .text`, ns =>
      ns.map(t => t.textContent ?? ""),
    )
  const top = (sel: string) =>
    page.$eval(sel, n => n.getBoundingClientRect().top).catch(() => Number.NaN)

  // ── names, and the promise before the first message ─────────────────────
  await page.fill("#name", "Ada")
  await page.press("#name", "Enter")
  const named = await waitFor(
    () =>
      [...readParticipantNames(host.doc)].some(
        ([writer, name]) => name === "Ada" && writer.startsWith("w-"),
      ),
    15_000,
  )
  ok(named >= 0, "the name typed in the header is stored by the writer's id")
  ok(
    (await page.locator(".composer .audience").count()) === 0,
    "the composer does not guess an audience: presence will say who is here",
  )
  ok(
    (await page.locator(`${col(0)} .start`).count()) === 1 &&
      (await page.locator(`${col(0)} .composer`).count()) === 0,
    "an empty session offers Start Chat and Start Agent, and no composer",
  )
  await page.click(`${col(0)} .start-agent`)
  await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
  ok(
    (await label(0)) === "send · agent will reply",
    `Start Agent promises a reply with no mention: "${await label(0)}"`,
  )

  // ── the first turn: the reply, the agent joining ────────────────────────
  // Whether a reply streams live is checked on the scripted host below, where
  // its pace is set: a live model's one-line reply can open and close its
  // stream between two of the page's renders.
  await send(0, "Say exactly: BROWSER-OK")
  // Structure, not the model's words: a reply appeared, in this column. What
  // the model says is `e2e:live`'s to check.
  ok(
    await page
      .waitForSelector(`${col(0)} .msg.assistant`, { timeout: 60_000 })
      .then(
        () => true,
        () => false,
      ),
    "the agent's reply rendered in the first column",
  )
  await idle()
  const roles = await page.$$eval(`${col(0)} .msg`, ns =>
    ns.map(
      n =>
        `${n.className.replace("msg ", "")}:${n.querySelector(".role")?.textContent}`,
    ),
  )
  ok(
    roles.join(",") === "chat asked:Ada,assistant:agent",
    `the column reads Ada's asked message, then the agent: [${roles.join(", ")}]`,
  )
  ok(
    (await page.$$eval(".joined", n => n.length)) === 1,
    "the column shows where the agent joined",
  )

  // ── mentions pick the addressee, and the button says so ────────────────
  // The thread has a lane now, so a message naming no one asks the agent; one
  // naming only a person is for them (ADR-0021).
  await page.fill(`${col(0)} .composer .input`, NOTE)
  const plain = await label(0)
  const assistantsBefore = await page.$$eval(".msg.assistant", n => n.length)
  await page.click(`${col(0)} .composer .send`)
  await shows(NOTE)
  await new Promise(r => setTimeout(r, 1500))
  ok(
    plain === "send · to Ada" &&
      (await page.$$eval(".msg.assistant", n => n.length)) ===
        assistantsBefore &&
      Object.keys(host.doc.activeRuns()).length === 0,
    `naming only a person, the button said who it is for, and no reply came ("${plain}")`,
  )
  await page.fill(
    `${col(0)} .composer .input`,
    "@agent say exactly: BROWSER-TWO",
  )
  const ask = await label(0)
  const repliesBefore = await page.$$eval(".msg.assistant", n => n.length)
  await page.click(`${col(0)} .composer .send`)
  ok(
    ask === "send · agent will reply" &&
      (await page
        .waitForFunction(
          n => document.querySelectorAll(".msg.assistant").length > n,
          repliesBefore,
          { timeout: 60_000 },
        )
        .then(
          () => true,
          () => false,
        )),
    `typing @agent promised a reply, and it came ("${ask}")`,
  )
  await idle()
  const railCount = async () => page.$$eval(".rail-dot", n => n.length)
  const messages = () => projectRail(readTreeIndex(host.doc)).length
  ok(
    (await railCount()) === messages() && messages() >= 5,
    `the rail has a dot per message (${await railCount()} of ${messages()})`,
  )

  // ── a branch opens beside its parent, in its colour ─────────────────────
  // It forks at the agent's reply, the second message, so opening has to
  // bring its first message down to meet the fork point.
  const replyId =
    (await page.$eval(`${col(0)} .msg.assistant`, n =>
      n.getAttribute("data-entry"),
    )) ?? ""
  const atReply = `${col(0)} .msg[data-entry="${replyId}"]`
  const other = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "browser-other",
  })
  await other.setName("Bea")
  // A fork on purpose, at the agent's reply: `branch`. A branch starts as a
  // conversation, so it is appended with no run.
  const aside = await other.chat("an aside", atEntry(entryId(replyId)), {
    mode: "branch",
  })
  ok(
    aside.kind === "appended",
    `another writer's aside is a conversation: appended, no run (${aside.kind})`,
  )
  await page.waitForSelector(`${atReply} .open-branch`, { timeout: 15_000 })
  const trunkNow = await texts(0)
  ok(
    trunkNow.some(t => t.includes("BROWSER-TWO")) &&
      !trunkNow.includes("an aside"),
    "a newer branch does not pull the first column away from its thread",
  )
  await page.evaluate(() => document.fonts.ready)
  await page.click(`${atReply} .open-branch`)
  const opened = await shows("an aside", col(1))
  ok(
    opened && (await page.$$eval(".column", n => n.length)) === 2,
    "the branch opened as a second column, to the right of its parent",
  )
  const drift = Math.abs((await top(`${col(1)} .msg`)) - (await top(atReply)))
  const needed = (await top(atReply)) - (await top(`${col(0)} .msg`))
  ok(
    drift <= 4 && needed > 20,
    `it opened with its first message level with the fork point, ${needed.toFixed(0)}px down (off by ${drift.toFixed(1)}px)`,
  )
  const colours = await page.evaluate(
    ({ first, branch }) => {
      const column = document.querySelector(branch)
      const track = column?.getAttribute("data-track") ?? ""
      const dot = document.querySelector(
        `${first} .fork-dot[data-track="${track}"]`,
      )
      const railDot = document.querySelector(
        `.rail-dot[data-track="${track}"][data-open="yes"]`,
      )
      const head = column?.querySelector(".column-head") ?? null
      return {
        head: head === null ? "none" : getComputedStyle(head).borderTopColor,
        dot: dot === null ? "none" : getComputedStyle(dot).backgroundColor,
        rail:
          railDot === null ? "none" : getComputedStyle(railDot).backgroundColor,
      }
    },
    { first: col(0), branch: col(1) },
  )
  ok(
    colours.head !== "none" &&
      colours.head === colours.dot &&
      colours.dot === colours.rail,
    `the branch's header, its fork dot and its rail track share a colour (${colours.head} · ${colours.dot} · ${colours.rail})`,
  )
  const beforeScroll = await page.$eval(
    `${col(1)} .column-body`,
    n => n.scrollTop,
  )
  await page.$eval(`${col(0)} .column-body`, n => {
    n.scrollTop += 40
  })
  ok(
    (await page.$eval(`${col(1)} .column-body`, n => n.scrollTop)) ===
      beforeScroll,
    "scrolling one column does not scroll another",
  )

  // ── → opens a branch beside its parent, and it follows its branch ──────
  // From the first column while two are open, so "beside its parent"
  // (position 1) and "the far right" (position 2) differ.
  await page.hover(`${col(0)} ${msg(NOTE)}`)
  await page.click(`${col(0)} ${msg(NOTE)} > .branch`)
  const beside = await page
    .waitForFunction(
      ([c, note]) =>
        document
          .querySelector(`${c} .fork-label`)
          ?.textContent?.includes(note) === true &&
        document.querySelector(`${c} .msg`) === null,
      [col(1), NOTE] as const,
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    )
  ok(
    beside,
    "→ opens an empty column next to the column it forks from, not at the far right",
  )
  const dotsBefore = await railCount()
  await send(1, "deeper")
  ok(
    await shows("deeper", col(1)),
    "a message sent in a fresh column appears in that column",
  )
  await idle()
  ok((await railCount()) > dotsBefore, "the new branch appears in the rail")
  ok(
    !(await texts(0)).includes("deeper"),
    "the column it branched from does not take the new branch",
  )
  // Each column's LAST message, found by class: `:last-of-type` would match
  // the last div, and pass on finding nothing.
  const lasts = await page.$$eval(".column", cs =>
    cs.map(c => {
      const all = c.querySelectorAll(".column-body .msg")
      const last = all[all.length - 1]
      return (
        last?.querySelector(":scope > .branch")?.getAttribute("title") ??
        (last === undefined ? "none" : "no")
      )
    }),
  )
  ok(
    lasts.join(" | ") === "continue as a conversation | no | no",
    `→ at a column's end only in agent work, where it steps down (${lasts.join(" | ")})`,
  )

  // ── make main ────────────────────────────────────────────────────────────
  await page.click(`${col(2)} .make-main`)
  await page.waitForFunction(
    c =>
      document.querySelector(`${c} .msg`)?.textContent?.includes("BROWSER-OK"),
    col(0),
    { timeout: 15_000 },
  )
  const main = await texts(0)
  const former = await texts(1)
  ok(
    main.includes("an aside") &&
      former.some(t => t.includes("BROWSER-TWO")) &&
      !former.includes("Say exactly: BROWSER-OK"),
    "make main puts the branch first, and the old first column now starts after its fork point",
  )
  const leftover = await page.$eval(
    `${col(0)} .spacer`,
    n => n.getBoundingClientRect().height,
  )
  ok(
    leftover === 0,
    `the new first column keeps no alignment spacer: it has no fork point (${leftover}px)`,
  )

  // ── the agent's context, lit ────────────────────────────────────────────
  await send(0, "@agent say exactly: LIT")
  const lit = await page.waitForSelector(".msg.dim", { timeout: 30_000 }).then(
    () => true,
    () => false,
  )
  const litState = await page.evaluate(note => {
    const byText = (t: string) =>
      [...document.querySelectorAll(".msg")].find(
        n => n.querySelector(":scope > .text")?.textContent === t,
      )?.className ?? ""
    return { aside: byText("an aside"), note: byText(note) }
  }, NOTE)
  ok(
    lit && litState.aside.includes("lit") && litState.note.includes("dim"),
    `while the agent replies, its path is lit and the rest dims (${litState.aside} / ${litState.note})`,
  )
  await idle()

  // ── a busy thread: the composer says it will queue, and it does ────────
  // On one host the page sees another writer's run start almost at once, so
  // the composer chooses `queue` itself: that is what a person meets. A true
  // conflict needs two sends to cross in flight; its outcome is checked in
  // e2e, where the commands can be ordered.
  const tipOf0 = () =>
    page.$$eval(
      `${col(0)} .column-body .msg[data-entry]`,
      ns => ns.at(-1)?.getAttribute("data-entry") ?? "",
    )
  await page.fill(`${col(0)} .composer .input`, "@agent after Bea")
  const idleLabel = await label(0)
  const bea = await other.chat(
    "@agent Bea's turn",
    atEntry(entryId(await tipOf0())),
  )
  ok(
    bea.kind === "started",
    `Bea's question starts the thread's run (${bea.kind})`,
  )
  const queues = await page
    .waitForFunction(
      c =>
        document
          .querySelector(`${c} .composer .send`)
          ?.textContent?.startsWith("queue · agent replies after Bea") === true,
      col(0),
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    )
  ok(
    idleLabel === "send · agent will reply" && queues,
    `once Bea's run shows, the composer says it will queue after her ("${await label(0)}")`,
  )
  await page.click(`${col(0)} .composer .send`)
  const waiting = await page
    .waitForSelector(`${col(0)} .msg.waiting`, { timeout: 15_000 })
    .then(
      () => true,
      () => false,
    )
  ok(waiting, "the queued message shows in its column, waiting")
  await idle()
  const order = await page.$$eval(`${col(0)} .msg`, ns =>
    ns
      .map(n => n.querySelector(":scope > .text")?.textContent ?? "")
      .filter(t => t === "@agent Bea's turn" || t === "@agent after Bea"),
  )
  const lastFour = await page.$$eval(`${col(0)} .msg`, ns =>
    ns.slice(-4).map(n => n.className.replace("msg ", "").split(" ")[0]),
  )
  ok(
    order.join(" | ") === "@agent Bea's turn | @agent after Bea" &&
      lastFour.join(",") === "chat,assistant,chat,assistant",
    `queued after Bea, both are answered in order (${order.join(" | ")}; ${lastFour.join(",")})`,
  )

  // ── the agent in a thread no column shows: the rail pulses ──────────────
  await page.click(`${col(1)} .close`)
  await page.click(`${col(1)} .close`)
  await page.waitForFunction(
    () => document.querySelectorAll(".column").length === 1,
    undefined,
    { timeout: 15_000 },
  )
  const noteId =
    Object.values(host.doc.entries()).find(e =>
      JSON.stringify(e).includes("just a note"),
    )?.id ?? ""
  await other.chat("@agent say exactly: PULSE", atEntry(entryId(noteId)), {
    mode: "branch",
  })
  const pulsing = await page
    .waitForSelector(".rail-dot.pulse", { timeout: 30_000 })
    .then(el => el.getAttribute("data-entry"))
    .catch(() => null)
  ok(
    pulsing !== null,
    "the rail pulses where the agent replies, with no column open there",
  )
  if (pulsing !== null) await page.click(`.rail-dot[data-entry="${pulsing}"]`)
  ok(
    await shows("@agent say exactly: PULSE"),
    "clicking the pulse opens that thread",
  )
  await idle()
  await other.close()

  // ── a rename shows, and the name each message was sent under stays ─────
  await page.fill("#name", "Ada Lovelace")
  await page.press("#name", "Enter")
  const renamed = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll(".msg.chat .role")].some(
          n => n.textContent === "Ada Lovelace (Ada)",
        ),
      undefined,
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    )
  ok(
    renamed,
    "after a rename, Ada's earlier messages show her current name, then the one she sent under",
  )

  // ── the rail's +: an agent thread at the root, and stepping down ───────
  const before = await page.$$eval(".column", n => n.length)
  await page.click("#rail .new-thread")
  await page.click("#rail .start-agent")
  const agentCol = col(before)
  await page.waitForSelector(`${agentCol} .composer`, { timeout: 15_000 })
  ok(
    (await label(before)) === "send · agent will reply" &&
      (await page.$$eval(`${agentCol} .msg`, n => n.length)) === 0,
    "the rail's + opens an empty Start Agent column at the end",
  )
  await send(before, "say exactly: DOWN-ONE")
  await page.waitForSelector(`${agentCol} .msg.assistant`, { timeout: 60_000 })
  await idle()
  // → at the agent thread's end: a conversation continuing from there.
  const end = `${agentCol} .msg.assistant`
  await page.hover(end)
  await page.click(`${end} > .branch`)
  const downCol = col(before + 1)
  await page.waitForSelector(`${downCol} .composer`, { timeout: 15_000 })
  ok(
    (await label(before + 1)) === "send",
    `the stepped-down column is a conversation: "${await label(before + 1)}"`,
  )
  await send(before + 1, "off the record")
  await shows("off the record", downCol)
  // The agent thread goes on through its lane; the newer conversation at its
  // old end must not take its column, nor its reply.
  await send(before, "say exactly: DOWN-TWO")
  await page
    .waitForFunction(
      c => document.querySelectorAll(`${c} .msg.assistant`).length === 2,
      agentCol,
      { timeout: 60_000 },
    )
    .catch(() => null)
  await idle()
  const agentTexts = await texts(before)
  const downTexts = await texts(before + 1)
  ok(
    agentTexts.includes("say exactly: DOWN-TWO") &&
      !agentTexts.includes("off the record") &&
      (await page.$$eval(`${agentCol} .msg.assistant`, n => n.length)) === 2,
    `the agent thread's column keeps its thread past the newer conversation (${agentTexts.length} messages)`,
  )
  ok(
    downTexts.includes("off the record") &&
      !downTexts.includes("say exactly: DOWN-TWO"),
    "the conversation's column keeps only its own thread",
  )

  // ── tools: rows, live output, and Stop, on a scripted host ─────────────
  {
    const work = mkdtempSync(path.join(tmpdir(), "pineta-browser-tools-"))
    writeFileSync(path.join(work, "notes.txt"), "the secret word is MANGO\n")
    // Slow enough that a reply is seen while it is still being written.
    const script = scriptedModel({ tokensPerSecond: 60 })
    const toolHost = await startHost({
      model: { kind: "scripted", script },
      tools: { cwd: work },
      log: () => {},
    })
    const tp = await browser.newPage()
    try {
      await tp.goto(toolHost.httpUrl, { waitUntil: "domcontentloaded" })
      await tp.click(`${col(0)} .start-agent`)
      const say = async (text: string) => {
        await tp.fill(`${col(0)} .composer .input`, text)
        await tp.click(`${col(0)} .composer .send`)
      }
      const toolIdle = () =>
        waitFor(() => Object.keys(toolHost.doc.activeRuns()).length === 0)
      const appears = (sel: string, timeout = 20_000) =>
        tp.waitForSelector(sel, { timeout }).then(
          () => true,
          () => false,
        )

      script.use([
        { text: "Let me look.", tool: "read", args: { path: "notes.txt" } },
        { text: "It says MANGO. The file holds one line, and nothing else." },
      ])
      await say("what is in notes?")
      const streamed = await tp
        .waitForFunction(
          c => {
            const s = document.querySelector(`${c} .streaming .text`)
            return s !== null && (s.textContent ?? "").length > 0
          },
          col(0),
          { timeout: 20_000 },
        )
        .then(
          () => true,
          () => false,
        )
      ok(streamed, "the agent's reply shows in its column while it is written")
      const row = `${col(0)} .tool[data-tool="read"][data-status="ok"]`
      const shown = await appears(row)
      await toolIdle()
      const label = await tp.textContent(`${row} .tool-label`).catch(() => "")
      if (shown) await tp.click(`${row} summary`)
      const output = await tp.textContent(`${row} .tool-output`).catch(() => "")
      ok(
        shown &&
          label === "read notes.txt" &&
          (await tp.textContent(`${row} .tool-status`)) === "✓" &&
          output?.includes("MANGO") === true,
        `a tool call shows as a row with its label, ✓, and its result folded in (${label})`,
      )

      script.use([
        {
          tool: "bash",
          args: {
            command:
              "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 0.25; done",
          },
        },
        { text: "ticked" },
      ])
      await say("tick")
      const live = await tp
        .waitForFunction(
          c =>
            document
              .querySelector(`${c} .tool.live .tool-output`)
              ?.textContent?.includes("tick 2") === true,
          col(0),
          { timeout: 20_000 },
        )
        .then(
          () => true,
          () => false,
        )
      ok(live, "a running command's output shows live in its column")
      await toolIdle()
      ok(
        (await tp.locator(`${col(0)} .tool.live`).count()) === 0,
        "when the command ends, its live row gives way to the committed one",
      )

      script.use([
        { tool: "bash", args: { command: "sleep 5" } },
        { text: "after" },
      ])
      await say("sleep")
      // As a person does: stop the command once it is seen running.
      await appears(`${col(0)} .tool.live`)
      const stopShown = await appears(`${col(0)} .stop`)
      const t0 = Date.now()
      if (stopShown) await tp.click(`${col(0)} .stop`)
      const failed = `${col(0)} .tool[data-tool="bash"][data-status="error"]`
      const ended = await appears(failed, 10_000)
      if (ended) await tp.click(`${failed} summary`)
      const why = await tp.textContent(`${failed} .tool-output`).catch(() => "")
      ok(
        stopShown &&
          ended &&
          Date.now() - t0 < 4_000 &&
          (await tp.textContent(`${failed} .tool-status`)) === "✗" &&
          why?.includes("aborted") === true,
        `Stop ends a running command, shown as ✗ "Command aborted" (${why?.slice(-16) ?? "none"})`,
      )
      await toolIdle()
    } finally {
      await tp.close().catch(() => {})
      await toolHost.shutdown().catch(() => {})
    }
  }

  // ── nothing left of the old controls ────────────────────────────────────
  const gone = await page.$$eval(
    "#reading, #thread, #threadMode, #followLatest, #switchLane, #offLane, .fork, #streaming, .rule, .rule-marker, .branch-here",
    n => n.length,
  )
  ok(gone === 0, `none of the removed controls exist (${gone})`)

  // ── a second window joins, asks, and cites ──────────────────────────────
  const second = await browser.newPage()
  try {
    await second.goto(host.httpUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })
    const rendered = await second
      .waitForSelector(".column .msg", { timeout: 20_000 })
      .then(
        () => true,
        () => false,
      )
    ok(rendered, "a joining window renders a column")
    await second.fill(`${col(0)} .composer .input`, "B asks about this")
    await second.click(`${col(0)} .composer .send`)
    await second
      .waitForSelector(msg("B asks about this"), { timeout: 60_000 })
      .catch(() => null)
    await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
    // A's replica has everything the host has, and has drawn it, before A's
    // messages are counted: otherwise a reply still arriving reads as a change.
    const total = String(Object.keys(host.doc.entries()).length)
    await page.waitForFunction(
      n => document.getElementById("count")?.textContent === n,
      total,
      { timeout: 15_000 },
    )
    const spineBefore = await page.$$eval(".msg", n => n.length)
    await second.hover(`${col(0)} .msg`)
    await second.click(`${col(0)} .msg .tools .cite`)
    const shown = await page
      .waitForSelector(".cited-by", { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    ok(shown, "B's citation appears live in A's window as a backlink")
    const marker = await page
      .$eval(".cited-by", n => n.textContent ?? "")
      .catch(() => "")
    ok(marker.includes("cited by 1"), `A sees "${marker.trim()}"`)
    ok(
      (await page.$$eval(".msg", n => n.length)) === spineBefore,
      "A's columns are unchanged by the citation: it adds no message",
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
