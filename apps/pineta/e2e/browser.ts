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
import { atEntry, entryId, handleOf, projectRail, ROOT } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import {
  readParticipantNames,
  readReferences,
  readTreeIndex,
} from "@pineta/reads"
import { type Browser, chromium, type Page } from "@playwright/test"
import { startHost } from "../host/index.ts"
import { createChecks, waitFor } from "./harness.ts"

const PW_SERVER = process.env.PW_SERVER ?? "ws://localhost:3100/"
/** The ⋯ of the tab you are on: every root tab has one, shown on hover. */
const OWN_MENU = '#tabs .tab[aria-selected="true"] ~ .tab-more .tab-menu'

const { ok, report } = createChecks()

/**
 * Open the menu behind `trigger`, and find `item` in it if a person could see
 * it: Playwright scrolls a clipped element into view and clicks it, so a menu
 * check proves it can be seen by what `elementFromPoint` finds at the item's
 * centre (`packages/client/TECHNICAL.md`, Gotchas). Null when not seen.
 */
async function seeInMenu(p: Page, trigger: string, item: string) {
  await p.click(trigger)
  const el = await p
    .waitForSelector(`.menu ${item}`, { timeout: 15_000 })
    .catch(() => null)
  if (el === null) return null
  const seen = await el.evaluate(n => {
    const r = n.getBoundingClientRect()
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    )
    return hit !== null && n.contains(hit)
  })
  return seen ? el : null
}

/** `seeInMenu`, then choose the item. Whether it was seen; one not seen is not clicked. */
async function chooseFromMenu(
  p: Page,
  trigger: string,
  item: string,
): Promise<boolean> {
  const el = await seeInMenu(p, trigger, item)
  if (el === null) return false
  await el.click()
  return true
}

/** In the page: the messages its rail draws, a dot each and a capsule's count. */
const RAIL_MESSAGES = () =>
  document.querySelectorAll(".rail .rail-dot").length +
  [...document.querySelectorAll(".rail .rail-run")].reduce(
    (n, run) => n + Number(run.getAttribute("data-count")),
    0,
  )

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

// An explicit context: a page from `browser.newPage()` owns its context, and
// Playwright refuses a second tab in it, which the column checks open.
const page = await (await browser.newContext()).newPage()
const errors: string[] = []
page.on("pageerror", e => errors.push(String(e.message)))
page.on("console", m => m.type() === "error" && errors.push(m.text()))

try {
  await page.goto(host.httpUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  })

  // The bundle must load and connect before anything renders: a module the
  // browser cannot run fails exactly here, which a browser-free check cannot
  // see.
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent === "connected",
    { timeout: 20_000 },
  )
  ok(true, "page loaded, wasm instantiated, client connected to the host")
  ok(
    errors.length === 0,
    `no page errors during load${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
  )
  // The session is plain JSON (ADR-0023): the page loads no Loro and no wasm.
  // In development Vite pre-bundles loro-crdt with its wasm inside a JS module,
  // so a check for `.wasm` files alone would pass with Loro loaded.
  const heavy = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map(e => e.name)
      .filter(n => /loro|\.wasm/i.test(n)),
  )
  ok(
    heavy.length === 0,
    `the page loads no Loro and no wasm${heavy[0] === undefined ? "" : ` — ${heavy[0].split("/").at(-1)}`}`,
  )

  ok(
    (await page.$("#lane")) === null,
    "the header shows no lane: people own none, threads do",
  )

  // ── helpers ──────────────────────────────────────────────────────────────
  /** A message for Ada only: it names her, so in agent work it asks no one. */
  const NOTE = "@Ada just a note"
  const col = (n: number) => `.column[data-position="${n}"]`
  // Plain text is drawn as markdown: one paragraph holding one run. `:text-is`
  // matches the smallest element holding the text, which is that run.
  const msg = (text: string) =>
    `.msg:has(> .text > p:only-child > span:only-child:text-is(${JSON.stringify(text)}))`
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
  await page.waitForSelector("#tabs .add-agent", { timeout: 15_000 })
  ok(
    (await page.locator('#tabs [role="tab"]').count()) === 1 &&
      (await page.locator("#tabs .tab-archive").count()) === 1 &&
      (await page.locator(".composer").count()) === 0,
    "an empty session shows Archive and ＋, and no composer",
  )
  await page.click("#tabs .add-agent")
  await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
  ok(
    (await label(0)) === "send · agent will reply",
    `＋ agent promises a reply with no mention: "${await label(0)}"`,
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
  /** Messages the rail draws: one per dot, and each capsule's count. */
  const railCount = (p: Page = page) => p.evaluate(RAIL_MESSAGES)
  const messages = () => {
    const index = readTreeIndex(host.doc)
    return projectRail(index, index.roots[0] ?? "").length
  }
  ok(
    (await railCount()) === messages() && messages() >= 5,
    `the rail accounts for every message (${await railCount()} of ${messages()})`,
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
  // The → sits in the column's right padding, all but a pixel outside its
  // message, and a hidden → takes no hover. A pointer that overshoots into
  // that padding, past the →, must still show it and reach it.
  await page.locator(`${col(0)} ${msg(NOTE)}`).scrollIntoViewIfNeeded()
  const gutter = await page.$eval(`${col(0)} ${msg(NOTE)}`, m => {
    const body = m.closest(".column-body")
    const arrow = m.querySelector(":scope > .branch")?.getBoundingClientRect()
    if (body === null || arrow === undefined) return null
    // Its client area's right edge: a scrollbar, if drawn, lies beyond it.
    const inner =
      body.getBoundingClientRect().left + body.clientLeft + body.clientWidth
    return {
      past: { x: inner - 1, y: arrow.top + arrow.height / 2 },
      on: { x: arrow.left + arrow.width / 2, y: arrow.top + arrow.height / 2 },
    }
  })
  await page.mouse.move(0, 0)
  if (gutter !== null) {
    await page.mouse.move(gutter.past.x, gutter.past.y)
    await page.mouse.move(gutter.on.x, gutter.on.y, { steps: 4 })
  }
  const reached =
    gutter !== null &&
    (await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return (
        hit?.classList.contains("branch") === true &&
        getComputedStyle(hit).visibility === "visible"
      )
    }, gutter.on))
  ok(
    reached,
    "→ shows from the padding beside its message, and takes the click",
  )

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
  const railBefore = await railCount()
  await send(1, "deeper")
  ok(
    await shows("deeper", col(1)),
    "a message sent in a fresh column appears in that column",
  )
  await idle()
  ok((await railCount()) > railBefore, "the new branch appears in the rail")
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

  // ── ＋ agent: a new tab, an agent thread at the root, and stepping down ──
  const firstRoot = readTreeIndex(host.doc).roots[0] ?? ""
  // A new tab holds one column, so the thread's columns count from 0.
  const before = 0
  await page.click("#tabs .add-agent")
  const agentCol = col(before)
  await page.waitForSelector(`${agentCol} .composer`, { timeout: 15_000 })
  ok(
    (await label(before)) === "send · agent will reply" &&
      (await page.$$eval(".column", n => n.length)) === 1 &&
      (await page.$$eval(`${agentCol} .msg`, n => n.length)) === 0 &&
      (await page.textContent('#tabs .tab-new[aria-selected="true"]')) ===
        "new agent",
    "＋ agent opens a new tab with one empty column, where the agent answers",
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

  // ── your tabs, the header and the inbox (ADR-0029, ADR-0030) ───────────
  const downRoot = readTreeIndex(host.doc).roots.at(-1) ?? ""
  const tabSel = (root: string) => `#tabs .tab[data-root="${root}"]`
  const selectedRoot = (p: Page) =>
    p
      .$eval('#tabs .tab[aria-selected="true"]', n =>
        n.getAttribute("data-root"),
      )
      .catch(() => null)
  const messagesIn = (root: string) =>
    projectRail(readTreeIndex(host.doc), root).length
  const firstTrack = () =>
    page.$eval(".rail-dot", n => n.getAttribute("data-track")).catch(() => "")
  // 1. Each tab's rail draws its own root only, from track 0.
  const downShown = [await railCount(), await firstTrack()]
  await page.click(tabSel(firstRoot))
  await page
    .waitForFunction(
      `(${RAIL_MESSAGES})() === ${messagesIn(firstRoot)}`,
      null,
      {
        timeout: 15_000,
      },
    )
    .catch(() => null)
  ok(
    downRoot !== firstRoot &&
      downShown[0] === messagesIn(downRoot) &&
      downShown[1] === "0" &&
      (await railCount()) === messagesIn(firstRoot) &&
      (await firstTrack()) === "0",
    `each root's tab draws only its root, from track 0 (${downShown[0]} of ${messagesIn(downRoot)}; ${await railCount()} of ${messagesIn(firstRoot)})`,
  )

  // 2. A root someone else starts opens no tab here (ADR-0030).
  const api = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "browser-tabs",
  })
  await api.setName("Bea")
  const third = await api.chat("a third thread", ROOT, { mode: "branch" })
  const thirdRoot = third.kind === "appended" ? third.id : ""
  await page.waitForFunction(
    n => document.getElementById("count")?.textContent === n,
    String(Object.keys(host.doc.entries()).length),
    { timeout: 15_000 },
  )
  ok(
    thirdRoot !== "" &&
      (await page.locator(tabSel(thirdRoot)).count()) === 0 &&
      (await selectedRoot(page)) === firstRoot,
    "a root another writer starts opens no tab, and the page stays where it is",
  )
  // Any root can be archived: another tab's ⋯ shows while it is hovered.
  const otherMenu = page.locator(`${tabSel(downRoot)} ~ .tab-more .tab-menu`)
  const hiddenAtRest = !(await otherMenu.isVisible())
  await page.hover(tabSel(downRoot))
  const shownOnHover = await otherMenu.isVisible()
  await page.mouse.move(0, 0)
  ok(
    hiddenAtRest && shownOnHover,
    `another root's tab shows its ⋯ on hover, and not at rest (${hiddenAtRest}, ${shownOnHover})`,
  )

  // 3. Closing a tab is yours: × writes nothing, and reopening brings its columns back.
  await page.click(tabSel(downRoot))
  await page.waitForFunction(
    () => document.querySelectorAll(".column").length >= 2,
    undefined,
    { timeout: 15_000 },
  )
  const downKeys = await page.$$eval(".column", cs =>
    cs.map(c => c.getAttribute("data-key") ?? ""),
  )
  const beforeClose = Object.keys(host.doc.entries()).length
  await page.click(`${tabSel(downRoot)} ~ .tab-close`)
  const closed = await page
    .waitForFunction(
      r => document.querySelector(`#tabs .tab[data-root="${r}"]`) === null,
      downRoot,
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    )
  ok(
    closed && Object.keys(host.doc.entries()).length === beforeClose,
    "× closes a root's tab for you, and writes nothing",
  )
  const openFromArchive = async (p: Page, r: string) => {
    await p.click("#tabs .tab-archive")
    await p.click(`.archive-row[data-root="${r}"]`)
    await p.click(".archive-preview .read-only-action")
    await p.waitForSelector(`${tabSel(r)}[aria-selected="true"]`, {
      timeout: 15_000,
    })
  }
  await openFromArchive(page, downRoot)
  await page
    .waitForFunction(
      n => document.querySelectorAll(".column").length === n,
      downKeys.length,
      { timeout: 15_000 },
    )
    .catch(() => null)
  const downAgain = await page.$$eval(".column", cs =>
    cs.map(c => c.getAttribute("data-key") ?? ""),
  )
  ok(
    downAgain.join() === downKeys.join(),
    `opening a closed root again brings back its columns (${downAgain.length} of ${downKeys.length})`,
  )
  await page.click(tabSel(firstRoot))

  // 4. Another window: the header shows it, never yourself, and takes you to it.
  const myWriter = await page.evaluate(
    () => `w-${sessionStorage.getItem("pineta-peer-id")}`,
  )
  const tb = await browser.newPage()
  try {
    await tb.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
    const landed = await tb
      .waitForSelector('#tabs .tab-archive[aria-selected="true"]', {
        timeout: 20_000,
      })
      .then(
        () => true,
        () => false,
      )
    ok(
      landed && (await tb.locator("#tabs .tab-root").count()) === 0,
      "a page with nothing stored opens on the Archive tab, with no root tabs",
    )
    await openFromArchive(tb, thirdRoot)
    const avatar = await page
      .waitForSelector("#top .here-person .here-trigger", { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    ok(
      avatar &&
        (await page
          .locator(`#top .avatar[data-writer="${myWriter}"]`)
          .count()) === 0,
      "another window shows in the header, and you never do",
    )
    const toThem = await chooseFromMenu(
      page,
      "#top .here-person .here-trigger",
      ".here-thread",
    )
    const followed = await page
      .waitForSelector(`${tabSel(thirdRoot)}[aria-selected="true"]`, {
        timeout: 15_000,
      })
      .then(
        () => true,
        () => false,
      )
    ok(
      toThem && followed && (await shows("a third thread")),
      "choosing a person's thread in the header opens it as your tab",
    )
    const onThird = await page
      .waitForSelector(`${tabSel(thirdRoot)} .avatar`, { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    await openFromArchive(tb, firstRoot)
    const moved = await page
      .waitForFunction(
        ([from, to]) =>
          document.querySelector(`#tabs .tab[data-root="${from}"] .avatar`) ===
            null &&
          document.querySelector(`#tabs .tab[data-root="${to}"] .avatar`) !==
            null,
        [thirdRoot, firstRoot] as const,
        { timeout: 15_000 },
      )
      .then(
        () => true,
        () => false,
      )
    ok(
      onThird && moved,
      "another window shows on the tab it is on, and leaves it when it switches",
    )

    // 5. The add menu, by keyboard; an unsent new tab closes without a trace.
    const entriesBefore = Object.keys(host.doc.entries()).length
    await page.focus("#tabs .add-menu")
    await page.keyboard.press("ArrowDown")
    const focused = await page
      .waitForFunction(
        () => document.activeElement?.classList.contains("add-conversation"),
        undefined,
        { timeout: 5_000 },
      )
      .then(
        () => true,
        () => false,
      )
    await page.keyboard.press("Enter")
    await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
    const convo = await label(0)
    ok(
      focused &&
        convo === "send" &&
        (await page.textContent('#tabs .tab-new[aria-selected="true"]')) ===
          "new conversation",
      `the add menu's conversation, chosen by keyboard, opens a new tab that only sends ("${convo}")`,
    )
    await page.fill(`${col(0)} .composer .input`, "never sent")
    await page.click("#tabs .tab-new ~ .tab-close")
    await page
      .waitForFunction(() => document.querySelector("#tabs .tab-new") === null)
      .catch(() => null)
    ok(
      (await page.locator("#tabs .tab-new").count()) === 0 &&
        Object.keys(host.doc.entries()).length === entriesBefore,
      "closing an unsent new tab writes nothing",
    )

    // 6. Mentions: @ counts what you have not seen, and takes you there.
    const unseen = () =>
      page
        .$eval("#top .inbox-count", n => Number(n.getAttribute("data-unseen")))
        .catch(() => 0)
    // The page's handle, from its name as it is now (it was renamed above).
    const handle = `@${handleOf(await page.inputValue("#name"))}`
    const before = await unseen()
    const mention = await api.chat(
      `${handle} a look at this?`,
      atEntry(entryId(downRoot)),
    )
    const mentionId = mention.kind === "appended" ? mention.id : ""
    const counted = await page
      .waitForFunction(
        n =>
          Number(
            document
              .querySelector("#top .inbox-count")
              ?.getAttribute("data-unseen") ?? 0,
          ) === n,
        before + 1,
        { timeout: 15_000 },
      )
      .then(
        () => true,
        () => false,
      )
    const picked = await chooseFromMenu(
      page,
      "#top .inbox-trigger",
      `.inbox-row[data-entry="${mentionId}"]`,
    )
    const drawn = await page
      .waitForSelector(`.column .msg[data-entry="${mentionId}"]`, {
        timeout: 15_000,
      })
      .then(
        () => true,
        () => false,
      )
    await page
      .waitForFunction(
        () => document.querySelector("#top .inbox-count") === null,
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => null)
    ok(
      counted && picked && drawn && (await unseen()) === 0,
      `a mention counts on @, and choosing it opens its thread with the message drawn (${before} → ${before + 1} → ${await unseen()})`,
    )
    // One on screen is seen at once: the page is on that thread.
    await api.chat(`${handle} and here`, atEntry(entryId(mentionId)))
    await shows(`${handle} and here`)
    await waitFor(() => false, 1_000)
    ok(
      (await unseen()) === 0,
      "a mention drawn in the tab you are on is never counted",
    )
    // Seen is kept per device: across a reload, and a mention made meanwhile counts.
    await page.click(tabSel(firstRoot))
    const rootTabs = (p: Page) =>
      p.$$eval("#tabs .tab-root", ts =>
        ts.map(t => t.getAttribute("data-root") ?? ""),
      )
    const tabsBefore = await rootTabs(page)
    const reloading = page.reload({ waitUntil: "domcontentloaded" })
    await api.chat(`${handle} while you were away`, atEntry(entryId(mentionId)))
    await reloading
    const afterReload = await page
      .waitForFunction(
        () =>
          document
            .querySelector("#top .inbox-count")
            ?.getAttribute("data-unseen") === "1",
        undefined,
        { timeout: 20_000 },
      )
      .then(
        () => true,
        () => false,
      )
    ok(
      afterReload,
      "after a reload, what was seen stays seen, and a mention made meanwhile counts",
    )
    const tabsAfter = await rootTabs(page)
    ok(
      tabsBefore.length >= 3 && tabsAfter.join() === tabsBefore.join(),
      `a reload keeps your tabs, in order (${tabsAfter.length} of ${tabsBefore.length})`,
    )
    // Two tabs of one device share it: mark all seen in one clears the other.
    const sibling = await page.context().newPage()
    try {
      await sibling.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
      // A second tab is a second writer (S29), and "you" is a name
      // (ADR-0030): named as the page is, its mentions are the page's.
      await sibling.fill("#name", await page.inputValue("#name"))
      await sibling.press("#name", "Enter")
      await sibling.waitForSelector("#top .inbox-count", { timeout: 20_000 })
      await chooseFromMenu(sibling, "#top .inbox-trigger", ".inbox-all-seen")
      const cleared = await page
        .waitForFunction(
          () => document.querySelector("#top .inbox-count") === null,
          undefined,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      ok(
        cleared,
        "two tabs of one device share the inbox: mark all seen in one clears the other",
      )
    } finally {
      await sibling.close().catch(() => {})
    }

    // 7. Archived, a root leaves every tab bar; the page on it reads it.
    await page.click(tabSel(thirdRoot))
    await page.waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
    ok(
      (await page.locator(".column").count()) === 1 &&
        (await page.locator(".column .close").count()) === 0,
      "a root tab's only column offers no close: the root would give it back",
    )
    // tb opens the third root again, so it has a tab there to lose, and then
    // is on another: the tab someone is on stays until they leave it.
    await openFromArchive(tb, thirdRoot)
    await tb.click(tabSel(firstRoot))
    await page.fill(`${col(0)} .composer .input`, "typed, not sent")
    const menuSeen = await chooseFromMenu(page, OWN_MENU, ".archive-root")
    ok(menuSeen, "a tab's ⋯ opens a menu drawn in full below the tab bar")
    await page
      .waitForSelector(`${col(0)} .read-only`, { timeout: 15_000 })
      .catch(() => null)
    const banner =
      (await page.textContent(`${col(0)} .read-only-label`).catch(() => "")) ??
      ""
    const input = `${col(0)} .composer .input`
    const kept = await page.inputValue(input).catch(() => "")
    const frozen = await page
      .$eval(input, n => (n as HTMLTextAreaElement).readOnly)
      .catch(() => false)
    await page.hover(`${col(0)} .msg`)
    const tools = await page
      .locator(`${col(0)} .msg .tools button, ${col(0)} .msg .branch`)
      .count()
    const leftTb = await tb
      .waitForFunction(
        r => document.querySelector(`#tabs .tab[data-root="${r}"]`) === null,
        thirdRoot,
        { timeout: 15_000 },
      )
      .then(
        () => true,
        () => false,
      )
    ok(
      banner.startsWith("archived by Ada") &&
        kept === "typed, not sent" &&
        frozen &&
        tools === 0 &&
        leftTb,
      `an archived root leaves the other window's bar, and the page on it reads it: "${banner}", its typed text kept, no tools (${tools})`,
    )
    await page.click(`${col(0)} .read-only-action`)
    await page
      .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
      .catch(() => null)
    await waitFor(() => false, 1_000)
    ok(
      (await page.inputValue(input)) === "typed, not sent" &&
        (await tb.locator(tabSel(thirdRoot)).count()) === 0,
      "restoring it in place brings back the composer with its text, and opens no tab for the other window",
    )

    // Archived again and left, its tab goes; the Archive tab brings it back.
    await page.fill(input, "")
    await chooseFromMenu(page, OWN_MENU, ".archive-root")
    await page
      .waitForSelector(`${col(0)} .read-only`, { timeout: 15_000 })
      .catch(() => null)
    await page.click(tabSel(firstRoot))
    const left = await page
      .waitForFunction(
        r => document.querySelector(`#tabs .tab[data-root="${r}"]`) === null,
        thirdRoot,
        { timeout: 15_000 },
      )
      .then(
        () => true,
        () => false,
      )
    ok(left, "switching away from an archived root takes its tab from the bar")
    await page.click("#tabs .tab-archive")
    const rowOf = (r: string) => `.archive-row[data-root="${r}"]`
    await page.waitForSelector(rowOf(thirdRoot), { timeout: 15_000 })
    const states = await page.$$eval(".archive-row", rs =>
      rs.map(r => r.getAttribute("data-state")),
    )
    ok(
      states.length === 3 &&
        (await page.getAttribute(rowOf(thirdRoot), "data-state")) ===
          "archived" &&
        (await page.getAttribute(rowOf(firstRoot), "data-state")) === "open",
      `the Archive tab lists every root with its state (${states.join(", ")})`,
    )
    await page.click(rowOf(thirdRoot))
    await page.waitForSelector(".archive-preview .column .msg", {
      timeout: 15_000,
    })
    await page.hover(".archive-preview .column .msg")
    const previewWrites = await page
      .locator(
        ".archive-preview .composer .send, .archive-preview .msg .tools button, .archive-preview .msg .branch",
      )
      .count()
    ok(
      previewWrites === 0 &&
        (await page.locator(".archive-preview .rail-dot").count()) >= 1,
      `the archived root's preview draws its rail and column, with nothing that writes (${previewWrites})`,
    )
    await page.click(".archive-preview .read-only-action")
    const restored = await page
      .waitForFunction(
        r =>
          document
            .querySelector(`#tabs .tab[data-root="${r}"]`)
            ?.getAttribute("aria-selected") === "true",
        thirdRoot,
        { timeout: 15_000 },
      )
      .then(
        () => true,
        () => false,
      )
    await waitFor(() => false, 1_000)
    ok(
      restored && (await tb.locator(tabSel(thirdRoot)).count()) === 0,
      "Restore in the Archive tab opens it as a tab for the page that restored it, and not for the other window",
    )
    // The Archive tab reports no thread: the other window leaves nothing
    // behind, once its deletions have reached this page.
    await tb.click("#tabs .tab-archive")
    await page
      .waitForFunction(
        () =>
          document.querySelector(".avatar") === null &&
          document.querySelector(".rail-dot[data-here]") === null,
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => null)
  } finally {
    await tb.close().catch(() => {})
  }

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
      await tp.click("#tabs .add-agent")
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

      // ── a column keeps its width, whatever its content (S37) ─────────────
      script.use([
        {
          text: `\`\`\`\n${"x".repeat(150)}\n\`\`\``,
          tool: "read",
          args: { path: `${"y".repeat(100)}.txt` },
        },
        { text: "wide" },
      ])
      await say("something wide")
      await appears(
        `${col(0)} .tool[data-tool="read"] .tool-label:has-text("yyy")`,
      )
      await toolIdle()
      const widths = await tp.$eval(col(0), c => {
        const body = c.querySelector(".column-body")
        const rem = Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        )
        return {
          column: Math.round(c.getBoundingClientRect().width),
          basis: Math.round(28 * rem),
          overflow: body === null ? -1 : body.scrollWidth - body.clientWidth,
        }
      })
      ok(
        widths.column === widths.basis && widths.overflow === 0,
        `a long code line and a long tool label leave the column at 28rem, with nothing past its side (${JSON.stringify(widths)})`,
      )

      // ── markdown: drawn, and a selection in it cites its source ───────────
      const REPLY = [
        "Plain **bold** here.",
        "",
        "A first line,",
        "and a second.",
        "",
        "```sh",
        "echo hi",
        "```",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "<script>alert(1)</script>",
        "",
        "[x](javascript:alert(1))",
      ].join("\n")
      script.use([{ text: REPLY }])
      await say("show me markdown")
      await toolIdle()
      const drawn = `${col(0)} .msg:has(> .text strong)`
      await appears(drawn)
      const replyId =
        (await tp.locator(drawn).last().getAttribute("data-entry")) ?? ""
      const reply = `.msg[data-entry="${replyId}"]`
      // A soft break shows, as people type them. (So a triple-click there
      // selects one line: Chrome ends a paragraph at a shown newline.)
      const lines = `${reply} > .text p:nth-of-type(2)`
      const twoLines = await tp
        .$eval(lines, p => (p as HTMLElement).innerText)
        .catch(() => "")
      ok(
        (await tp.locator(`${reply} > .text pre code`).count()) === 1 &&
          (await tp.locator(`${reply} > .text table`).count()) === 1 &&
          twoLines === "A first line,\nand a second.",
        `a reply's markdown is drawn: bold, a code block, a table, and its soft break (${JSON.stringify(twoLines)})`,
      )
      const shownText = (await tp.textContent(`${reply} > .text`)) ?? ""
      ok(
        (await tp.locator(`${reply} .text script`).count()) === 0 &&
          shownText.includes("<script>alert(1)</script>") &&
          (await tp.getAttribute(`${reply} .text a`, "href")) === "",
        "raw HTML in a reply shows as text, and a javascript: link goes nowhere",
      )

      /** Select from one run's character to another's, as a drag would. */
      const select = (from: string, fromAt: number, to: string, toAt: number) =>
        tp.evaluate(
          ([scope, a, ao, b, bo]) => {
            const runs = [...document.querySelectorAll(`${scope} span[data-s]`)]
            const textOf = (v: string) =>
              runs.find(r => r.textContent === v)?.firstChild
            const s = textOf(a)
            const e = textOf(b)
            if (s == null || e == null) return false
            window.getSelection()?.setBaseAndExtent(s, ao, e, bo)
            return true
          },
          [reply, from, fromAt, to, toAt] as const,
        )
      /** Cite the page's selection, and what the host stored of it. */
      const cite = async () => {
        const refs = () =>
          readReferences(toolHost.doc).to.get(entryId(replyId)) ?? []
        const before = refs().length
        await tp.hover(reply)
        await tp.click(`${reply} .tools .cite`)
        await waitFor(() => refs().length > before, 15_000)
        const to = refs().at(-1)?.to
        return to?.kind === "span" ? REPLY.slice(to.start, to.end) : to?.kind
      }
      await select("bold", 0, "bold", 4)
      const bold = await cite()
      ok(
        bold === "bold",
        `selecting rendered bold text cites its source (${JSON.stringify(bold)})`,
      )
      await select("Plain ", 2, "echo hi", 4)
      const across = await cite()
      ok(
        across ===
          "ain **bold** here.\n\nA first line,\nand a second.\n\n```sh\necho",
        `a selection across a code block cites its source from end to end (${JSON.stringify(across)})`,
      )
      // A drag to the start of the next line ends at that block's first
      // character, which is not selected.
      await select("Plain ", 0, "A first line,\nand a second.", 0)
      const toNext = await cite()
      ok(
        toNext === "Plain **bold** here.",
        `a selection ending at the next block's start cites its own block, and no more (${JSON.stringify(toNext)})`,
      )
      await tp.click(`${reply} > .text p:first-of-type`, {
        clickCount: 3,
        position: { x: 4, y: 4 },
      })
      const paragraph = await cite()
      ok(
        paragraph === "Plain **bold** here.",
        `a triple-clicked paragraph cites its source, and no more (${JSON.stringify(paragraph)})`,
      )

      // A done note's text is markdown too (ADR-0025).
      await tp.hover(reply)
      await tp.click(`${reply} .tools .edit`)
      await tp
        .click(`${reply} .note .note-done`, { timeout: 15_000 })
        .catch(() => null)
      const doneLine = await tp
        .waitForSelector(
          `${reply} .note[data-state="done"] .note-text strong`,
          {
            timeout: 15_000,
          },
        )
        .then(
          () =>
            tp.$eval(
              `${reply} .note .note-text p:nth-of-type(2)`,
              p => (p as HTMLElement).innerText,
            ),
          () => "",
        )
      ok(
        doneLine === "A first line,\nand a second.",
        `a done note draws its markdown, and keeps its line breaks (${JSON.stringify(doneLine)})`,
      )

      // ── a column follows its end, until the reader scrolls up ──────────────
      const body = (n: number) => `${col(n)} .column-body`
      const gapOf = (n: number) =>
        tp.$eval(body(n), b => b.scrollHeight - b.scrollTop - b.clientHeight)
      const frame = () =>
        tp.evaluate(() => new Promise(r => requestAnimationFrame(r)))
      const streamHeight = () =>
        tp
          .$eval(`${col(0)} .streaming`, s => s.getBoundingClientRect().height)
          .catch(() => 0)
      /** The column's gap to its end, sampled while its reply is written. */
      const sampleWhileStreaming = async () => {
        const gaps: number[] = []
        let tallest = 0
        while ((await tp.$(`${col(0)} .streaming`)) !== null) {
          tallest = Math.max(tallest, await streamHeight())
          gaps.push(Math.round(await gapOf(0)))
          await new Promise(r => setTimeout(r, 100))
        }
        return { gaps, tallest }
      }
      const LONG = Array.from(
        { length: 40 },
        (_, i) => `Line ${i + 1} of a long reply.`,
      ).join("\n\n")

      script.use([{ text: LONG }])
      await say("a long one")
      await appears(`${col(0)} .streaming`)
      const followed = await sampleWhileStreaming()
      await toolIdle()
      ok(
        followed.gaps.length >= 3 &&
          followed.tallest >= 300 &&
          followed.gaps.every(g => g < 80),
        `a column at its end follows a reply as it is written (gaps ${followed.gaps.join(" ")}; reply ${Math.round(followed.tallest)}px)`,
      )

      script.use([{ text: LONG }])
      await say("another long one")
      await tp
        .waitForFunction(
          c =>
            (document.querySelector(`${c} .streaming`)?.getBoundingClientRect()
              .height ?? 0) > 100,
          col(0),
          { timeout: 20_000 },
        )
        .catch(() => null)
      await tp.hover(body(0))
      await tp.mouse.wheel(0, -10)
      await new Promise(r => setTimeout(r, 300))
      const heldAt = await tp.$eval(body(0), b => b.scrollTop)
      const grownFrom = await streamHeight()
      await tp
        .waitForFunction(
          ([c, h]) =>
            (document.querySelector(`${c} .streaming`)?.getBoundingClientRect()
              .height ?? 0) >
            h + 200,
          [col(0), grownFrom] as const,
          { timeout: 20_000 },
        )
        .catch(() => null)
      const heldTo = await tp.$eval(body(0), b => b.scrollTop)
      const offered = await appears(`${col(0)} .jump-latest`, 2_000)
      if (offered) await tp.click(`${col(0)} .jump-latest`)
      await frame()
      const jumped = await gapOf(0)
      const gone = (await tp.locator(`${col(0)} .jump-latest`).count()) === 0
      const after = await sampleWhileStreaming()
      await toolIdle()
      ok(
        Math.abs(heldTo - heldAt) <= 1 &&
          offered &&
          // While the reply streams, a paragraph can land between the jump
          // and this read, as in the samples.
          jumped < 80 &&
          gone &&
          after.gaps.every(g => g < 80),
        `a small scroll up holds the column still while the reply is written, and ↓ new below is the way back (held ${Math.round(heldAt)}→${Math.round(heldTo)}, offered ${offered}, gap after ${Math.round(jumped)}, then ${after.gaps.join(" ")})`,
      )

      await tp.hover(body(0))
      await tp.mouse.wheel(0, -300)
      await new Promise(r => setTimeout(r, 300))
      const away = await gapOf(0)
      script.use([{ text: "short" }])
      await say("back to the end")
      await toolIdle()
      await appears(`${col(0)} ${msg("back to the end")}`)
      await frame()
      const back = await gapOf(0)
      ok(
        away > 200 && back <= 2,
        `your own send brings the column back to its end (${Math.round(away)}px away, then ${Math.round(back)})`,
      )

      // A column opened level with its fork point, and longer than it is
      // tall, keeps that place as its thread grows: it was placed short of
      // its end, so it does not follow it.
      const aligner = await connectSession({
        url: toolHost.wsUrl,
        WebSocket,
        peerId: "browser-aligner",
      })
      try {
        const forkId =
          (await tp
            .locator(`${col(0)} .msg[data-entry]`)
            .nth(2)
            .getAttribute("data-entry")) ?? ""
        const lines = (n: number) =>
          `Branch message ${n}.\nIts second line.\nIts third line.`
        const first = await aligner.chat(lines(0), atEntry(entryId(forkId)), {
          mode: "branch",
        })
        let tip = first.kind === "appended" ? first.id : null
        for (let n = 1; n <= 12 && tip !== null; n++) {
          const next = await aligner.chat(lines(n), atEntry(tip))
          tip = next.kind === "appended" ? next.id : null
        }
        const fork = `${col(0)} .msg[data-entry="${forkId}"]`
        await tp.waitForSelector(`${fork} .open-branch`, { timeout: 15_000 })
        await tp.$eval(body(0), b => {
          b.scrollTop = 0
        })
        await tp.evaluate(() => document.fonts.ready)
        await tp.click(`${fork} .open-branch`)
        await tp.waitForSelector(`${col(1)} .msg`, { timeout: 15_000 })
        await frame()
        await frame()
        const level = async () => {
          const a = await tp.$eval(
            `${col(1)} .msg`,
            m => m.getBoundingClientRect().top,
          )
          const b = await tp.$eval(fork, m => m.getBoundingClientRect().top)
          return Math.abs(a - b)
        }
        const opened = await level()
        const more =
          tip === null
            ? null
            : await aligner.chat("one more below", atEntry(tip))
        await tp
          .waitForSelector(
            `${col(1)} .msg[data-entry="${more?.kind === "appended" ? more.id : "none"}"]`,
            { state: "attached", timeout: 15_000 },
          )
          .catch(() => null)
        await frame()
        const grown = await level()
        const short = await gapOf(1)
        ok(
          tip !== null && opened <= 4 && grown <= 4 && short > 100,
          `an aligned column that runs past its end keeps its alignment as its thread grows (off by ${opened.toFixed(1)}, then ${grown.toFixed(1)}px; ${Math.round(short)}px above its end)`,
        )
      } finally {
        await aligner.close()
      }

      // ── the agent's work, in the header (ADR-0030) ──────────────────────
      // Another writer starts agent work at the root: no tab opens, the
      // header's agent pulses with its thread count, choosing the thread
      // opens it, and that root cannot be archived until the agent is done.
      const own = await tp
        .$eval('#tabs .tab[aria-selected="true"]', n =>
          n.getAttribute("data-root"),
        )
        .catch(() => null)
      const starter = await connectSession({
        url: toolHost.wsUrl,
        WebSocket,
        peerId: "browser-starter",
      })
      try {
        script.use([{ text: LONG }])
        const started = await starter.chat(
          "@agent a long one elsewhere",
          ROOT,
          {
            mode: "branch",
          },
        )
        const newRoot = readTreeIndex(toolHost.doc).roots.at(-1) ?? ""
        const pulsed = await appears("#top .here-agent.running .here-count")
        const count = await tp
          .textContent("#top .here-agent .here-count")
          .catch(() => "")
        const stayed =
          (await tp
            .$eval('#tabs .tab[aria-selected="true"]', n =>
              n.getAttribute("data-root"),
            )
            .catch(() => null)) === own &&
          (await tp.locator(`#tabs .tab[data-root="${newRoot}"]`).count()) === 0
        const chosen = await chooseFromMenu(
          tp,
          "#top .here-agent .here-trigger",
          ".here-thread",
        )
        const opened = await appears(
          `#tabs .tab[data-root="${newRoot}"][aria-selected="true"]`,
        )
        const item = await seeInMenu(tp, OWN_MENU, ".archive-root")
        const disabled =
          (await item?.evaluate(b => (b as HTMLButtonElement).disabled)) ??
          false
        const why =
          (await item
            ?.$eval(".why", n => n.textContent ?? "")
            .catch(() => "")) ?? ""
        ok(
          started.kind === "started" &&
            pulsed &&
            count === "1" &&
            stayed &&
            chosen &&
            opened &&
            disabled &&
            why.includes("the agent is working here"),
          `a root started elsewhere opens no tab; the header's agent pulses (${count}), its thread opens from there, and its Archive is disabled ("${why.trim()}")`,
        )
        await toolIdle()
      } finally {
        await starter.close()
      }

      // ── the rail draws a long loop as one capsule (ADR-0031) ─────────────
      await tp.keyboard.press("Escape")
      await tp.click("#tabs .add-agent")
      script.use([
        ...Array.from({ length: 30 }, () => ({
          tool: "read",
          args: { path: "notes.txt" },
        })),
        { tool: "read", args: { path: "missing.txt" } },
        { text: "I read it 30 times, and one file was missing." },
      ])
      await say("read notes, again and again")
      await toolIdle()
      const loopIndex = readTreeIndex(toolHost.doc)
      const loopRows = projectRail(loopIndex, loopIndex.roots.at(-1) ?? "")
      await tp.waitForSelector(
        `${col(0)} .msg[data-entry="${loopRows.at(-1)?.id ?? "none"}"]`,
        { timeout: 15_000 },
      )
      const tall = await tp.$eval(
        body(0),
        b => b.scrollHeight > 2 * b.clientHeight,
      )
      const capsule = await tp
        .$eval(".rail .rail-run", r => ({
          count: Number(r.getAttribute("data-count")),
          span: Number(r.getAttribute("data-span")),
          height: r.getBoundingClientRect().height,
          label: r.getAttribute("title") ?? "",
          fill: r.getAttribute("data-fill"),
        }))
        .catch(() => null)
      const accounted = await railCount(tp)
      ok(
        tall &&
          capsule !== null &&
          capsule.count >= 30 &&
          capsule.span === 1 + String(capsule.count).length &&
          capsule.height > 8 &&
          capsule.label.endsWith("· 1 failed") &&
          capsule.fill === "agent" &&
          accounted === loopRows.length,
        `a long loop is one hollow capsule on the rail, as long as its size has digits, its label counting the failed call (${capsule?.count ?? 0} messages, ${capsule?.span ?? 0} rows, ${capsule?.fill ?? "no"} fill, "${capsule?.label ?? ""}"; ${accounted} of ${loopRows.length} accounted for)`,
      )

      // A capsule opens its first message in view, and the column keeps it
      // there. Its fork point is out of view in the column that shows it, so
      // aligning the new column to it alone would not show the message. The
      // aside is one message, so the preview below opens on a short path and
      // its pick scrolls down, which does not stop a column following (S33).
      const railer = await connectSession({
        url: toolHost.wsUrl,
        WebSocket,
        peerId: "browser-railer",
      })
      try {
        const say3 = (n: string) => `${n}.\nIts second line.\nIts third line.`
        const chain = async (from: string, name: string, n: number) => {
          let tip = from
          for (let k = 1; k <= n; k++) {
            // A message below one that has a reply starts a branch there.
            const r = await railer.chat(
              say3(`${name} ${k}`),
              atEntry(entryId(tip)),
              k === 1 ? { mode: "branch" } : undefined,
            )
            if (r.kind !== "appended") return null
            tip = r.id
          }
          return tip
        }
        const start = await railer.chat(say3("Trunk 0"), ROOT, {
          mode: "branch",
        })
        const trunk =
          start.kind === "appended" ? await chain(start.id, "Trunk", 20) : null
        // The trunk's continuation first, so it keeps the trunk's track; the
        // aside after it, so it is the newest leaf, which the tab opens.
        const later = trunk === null ? null : await chain(trunk, "Later", 30)
        const aside = trunk === null ? null : await chain(trunk, "Aside", 1)
        const railRoot = start.kind === "appended" ? start.id : "none"
        // Another writer's root opens no tab (ADR-0030): open it from Archive.
        await openFromArchive(tp, railRoot)
        await tp.waitForSelector(
          `${col(0)} .msg[data-entry="${aside ?? "none"}"]`,
          { timeout: 15_000 },
        )
        const rows = projectRail(readTreeIndex(toolHost.doc), railRoot)
        const firstLater = rows.find(r => r.parentId === trunk && r.track === 0)
        const target = firstLater?.id ?? "none"
        /** Whether `target` is drawn whole inside its column's view, in `scope`. */
        const inView = (scope = "#strip", id = target) =>
          tp.evaluate(
            ([scope, id]) => {
              const m = document.querySelector(
                `${scope} .msg[data-entry="${id}"]`,
              )
              const b = m?.closest(".column-body")
              if (
                m === null ||
                m === undefined ||
                b === null ||
                b === undefined
              )
                return false
              const r = m.getBoundingClientRect()
              const v = b.getBoundingClientRect()
              return r.top >= v.top - 1 && r.bottom <= v.bottom + 1
            },
            [scope, id] as const,
          )
        /** A resize: a column that is still following jumps to its end. */
        const nudge = async () => {
          const size = tp.viewportSize()
          if (size !== null)
            await tp.setViewportSize({ ...size, height: size.height - 40 })
          await frame()
          await frame()
          if (size !== null) await tp.setViewportSize(size)
        }
        // The fork point, the trunk's last message, goes below the view.
        await tp.$eval(body(0), b => {
          b.scrollTop = 0
        })
        /** Click `fraction` of the way down the capsule. */
        const clickRun = async (scope: string, fraction: number) => {
          const box = await tp
            .locator(`${scope} .rail-run[data-entry="${target}"]`)
            .boundingBox()
          if (box !== null)
            await tp.mouse.click(
              box.x + box.width / 2,
              box.y + fraction * box.height,
            )
        }
        const before = await inView()
        // At its top: a click there opens the run's first message.
        await clickRun(".rail", 0.02)
        await tp.waitForSelector(`#strip .msg[data-entry="${target}"]`, {
          timeout: 15_000,
        })
        await frame()
        const shownAtOnce = await inView()
        await nudge()
        const kept = await inView()
        ok(
          later !== null && !before && shownAtOnce && kept,
          `a click at a capsule's top opens a column at its first message, in view, and the column keeps it there (${before}, ${shownAtOnce}, ${kept})`,
        )

        // Three quarters of the way down: the message three quarters through
        // the run, in the column now showing it, and far from the first.
        // A run's messages are consecutive rows.
        const count = Number(
          await tp.getAttribute(
            `.rail .rail-run[data-entry="${target}"]`,
            "data-count",
          ),
        )
        const at = rows.findIndex(r => r.id === target)
        const members = at < 0 ? [] : rows.slice(at, at + count)
        const three = members[Math.floor(0.75 * members.length)]?.id ?? "none"
        await clickRun(".rail", 0.75)
        await frame()
        const deepShown = await inView("#strip", three)
        const firstGone = !(await inView())
        ok(
          members.length > 20 && deepShown && firstGone,
          `a click lower on a capsule shows the message that far through its run (${members.length} messages; ${deepShown}, ${firstGone})`,
        )

        // The Archive tab's preview does the same with its one column, which
        // opens at the newest leaf's end and moves to what is picked.
        const preview = ".archive-preview"
        await tp.click("#tabs .tab-archive")
        await tp.click(`.archive-row[data-root="${railRoot}"]`)
        await tp.waitForSelector(`${preview} .column .msg`, { timeout: 15_000 })
        await clickRun(preview, 0.02)
        await tp.waitForSelector(`${preview} .msg[data-entry="${target}"]`, {
          timeout: 15_000,
        })
        await frame()
        await nudge()
        const previewed = await inView(preview)
        ok(
          previewed,
          "a capsule in the Archive tab's preview shows its first message, and keeps it in view",
        )
      } finally {
        await railer.close()
      }
    } finally {
      await tp.close().catch(() => {})
      await toolHost.shutdown().catch(() => {})
    }
  }

  // ── nothing left of the old controls ────────────────────────────────────
  const gone = await page.$$eval(
    "#reading, #thread, #threadMode, #followLatest, #switchLane, #offLane, .fork, #streaming, .rule, .rule-marker, .branch-here, .new-thread, .start, .start-agent, .start-chat",
    n => n.length,
  )
  ok(gone === 0, `none of the removed controls exist (${gone})`)

  // ── a second window joins, asks, and cites ──────────────────────────────
  // Alone, nobody else is shown anywhere (ADR-0024).
  const alone = await page.evaluate(() => ({
    avatars: [...document.querySelectorAll(".avatar")].map(
      a =>
        `${a.closest("[data-root], .column-head")?.className}:${a.getAttribute("data-writer")}`,
    ),
    rings: [...document.querySelectorAll(".rail-dot[data-here]")].map(d =>
      d.getAttribute("title"),
    ),
  }))
  ok(
    alone.avatars.length === 0 && alone.rings.length === 0,
    `alone, no avatars and no rings (${JSON.stringify(alone)})`,
  )
  const second = await browser.newPage()
  try {
    await second.goto(host.httpUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })
    // It opens on the Archive tab, and follows Ada from her avatar.
    await second
      .waitForSelector("#top .here-person .here-trigger", { timeout: 20_000 })
      .catch(() => null)
    const followedAda = await chooseFromMenu(
      second,
      "#top .here-person .here-trigger",
      ".here-thread",
    )
    const rendered = await second
      .waitForSelector(".column .msg", { timeout: 20_000 })
      .then(
        () => true,
        () => false,
      )
    ok(
      followedAda && rendered,
      "a joining window follows Ada's thread from her avatar in the header",
    )
    // Presence: the second window's open column rings its thread's end on the
    // first window's rail; opening that thread shows it in the header.
    const ring = await page
      .waitForSelector(".rail-dot[data-here]", { timeout: 15_000 })
      .then(
        el => el,
        () => null,
      )
    const ringTitle = (await ring?.getAttribute("title")) ?? ""
    ok(
      ring !== null && ringTitle.startsWith("here: "),
      `another window following a thread rings its end on the rail (${ringTitle})`,
    )
    if (ring !== null) await ring.click()
    const avatar = await page
      .waitForSelector(".column-head .avatar", { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    ok(
      avatar,
      "the column following that thread shows the other window in its header",
    )
    await second.fill(`${col(0)} .composer .input`, "thinking")
    const typing = await page
      .waitForSelector(".composer .typing", { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    ok(typing, "the other window's typing shows in that thread's composer")
    await second.fill(`${col(0)} .composer .input`, "")
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

    // ── notes: a message opened for editing, and a draft written together ──
    // A message shown once, in whichever column shows it first.
    const askedEntry = await page
      .locator(msg("B asks about this"))
      .first()
      .getAttribute("data-entry")
    const asked = `.msg[data-entry="${askedEntry}"]`
    await page.hover(asked)
    await page.click(`${asked} .tools .edit`)
    const editorA = page.locator(`${asked} .note textarea`)
    const editorB = second.locator(`${asked} .note textarea`)
    const cards = await Promise.all([
      editorA.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      ),
      editorB.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      ),
    ])
    ok(
      cards.every(Boolean),
      "a message opened for editing becomes a note in both windows",
    )
    await editorA.focus()
    await page.keyboard.press("End")
    await page.keyboard.type(" A1")
    await editorB.focus()
    await second.keyboard.press("End")
    await second.keyboard.type(" B2")
    const bothIn = (v: string) => v.includes("A1") && v.includes("B2")
    const merged = await waitFor(() => false, 1_500).then(async () => [
      await editorA.inputValue(),
      await editorB.inputValue(),
    ])
    ok(
      merged.every(bothIn),
      `two windows typing in one note see the merged text (${merged[0]})`,
    )
    const editingShown = await page
      .waitForSelector(`${asked} .note .note-editing`, { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    ok(editingShown, "the other window editing the note shows on its card")
    // Drawn in the same 8 px box as every dot, so it sits on its track.
    const square = await page
      .locator(".rail-dot.noted")
      .evaluateAll(ns => ns.map(n => n.getBoundingClientRect()))
    const dot = await page
      .locator(".rail-dot:not(.noted)")
      .first()
      .evaluate(n => n.getBoundingClientRect())
    ok(
      square.length === 1 &&
        square[0]?.width === dot.width &&
        square[0]?.height === dot.height,
      `the rail draws the note's message as a square, the size of a dot (${square[0]?.width}×${square[0]?.height})`,
    )

    await page.fill(`${col(0)} .composer .input`, "Together:")
    await page.click(`${col(0)} .composer .compose-together`)
    const draftA = page.locator(`${col(0)} .draft-slot textarea`)
    await draftA.waitFor({ timeout: 15_000 }).catch(() => null)
    // The other window opens that thread from its rail, at its end.
    const draftEnd = await page
      .locator(`${col(0)} .msg[data-entry]`)
      .last()
      .getAttribute("data-entry")
    await second.click(`.rail-dot[data-entry="${draftEnd}"]`)
    await second
      .click(".draft-slot .join-draft", { timeout: 15_000 })
      .catch(() => null)
    const draftB = second.locator(".draft-slot textarea")
    const joinedDraft = await draftB.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    )
    ok(
      joinedDraft && (await draftA.inputValue()) === "Together:",
      "compose together makes the thread's draft, and the other window joins it",
    )
    await draftB.focus()
    await second.keyboard.press("End")
    await second.keyboard.type(" from B")
    await waitFor(() => false, 1_500)
    await page.click(`${col(0)} .draft-slot .note-send`)
    // Sent, the draft is done: its message shows its card, read-only.
    const sentDraft = `.msg:has(.note[data-state="done"] > .note-text > p:only-child > span:only-child:text-is("Together: from B"))`
    const together = await page
      .waitForSelector(sentDraft, { timeout: 60_000 })
      .then(
        () => true,
        () => false,
      )
    const byLine = await page
      .$eval(`${sentDraft} .role`, n => n.textContent ?? "")
      .catch(() => "")
    ok(
      together && /^Ada.*, with /.test(byLine),
      `a sent draft is the sender's message, with its other writer (${byLine})`,
    )
    await idle()
    await page.click(".notes-toggle")
    // The whole index shows, over the columns: its middle is its own, not a
    // column's drawn over it, and it is wider than the rail.
    const panel = await page.$eval(".notes-index", el => {
      const r = el.getBoundingClientRect()
      const rail = document.querySelector(".rail")?.getBoundingClientRect()
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      )
      return {
        on: hit !== null && el.contains(hit),
        width: r.width,
        rail: rail?.width ?? 0,
      }
    })
    ok(
      panel.on && panel.width > panel.rail,
      `the notes index opens over the columns, whole (${Math.round(panel.width)}px, rail ${Math.round(panel.rail)}px)`,
    )
    await page.click('.notes-filters [data-filter="done"]')
    const doneRows = await page.locator('.notes-row[data-state="done"]').count()
    const allDone = await page.locator(".notes-row").count()
    ok(
      doneRows === 1 && allDone === 1,
      `the notes index lists the sent draft under done (${doneRows} of ${allDone})`,
    )
    await page.click(".notes-toggle")
  } finally {
    await second.close().catch(() => {})
  }

  // A reload keeps the tab you are on, and its open columns (ADR-0027). The
  // DOWN thread's tab has two: the agent thread and the conversation below it.
  await page.click(tabSel(downRoot))
  await page.waitForFunction(
    () => document.querySelectorAll(".column").length >= 2,
    undefined,
    { timeout: 15_000 },
  )
  const columnKeys = (p: typeof page) =>
    p.$$eval(".column", cs => cs.map(c => c.getAttribute("data-key") ?? ""))
  const openKeys = await columnKeys(page)

  // A reload is the same person: the tab keeps its peer id, so its name stays
  // and it is not shown to itself as someone else.
  const myName = await page.inputValue("#name")
  const me = await page.evaluate(
    () => `w-${sessionStorage.getItem("pineta-peer-id")}`,
  )
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent === "connected",
    { timeout: 20_000 },
  )
  const kept = await page
    .waitForFunction(
      n =>
        (document.getElementById("name") as HTMLInputElement | null)?.value ===
        n,
      myName,
      { timeout: 10_000 },
    )
    .then(
      () => true,
      () => false,
    )
  // Another window's entries may not have expired yet; none may be mine.
  const ghosts = await page.locator(`.avatar[data-writer="${me}"]`).count()
  ok(
    myName !== "" && kept && ghosts === 0,
    `a reload keeps who you are: your name (${myName}), and no ghost of yourself`,
  )
  // The document has arrived (the name shows); give the prune after settling
  // time to run before comparing.
  await waitFor(() => false, 1_000)
  const reopened = await columnKeys(page)
  ok(
    openKeys.length >= 2 && reopened.join() === openKeys.join(),
    `a reload keeps the tab's open columns, in order (${reopened.length} of ${openKeys.length})`,
  )
  // A new tab shares the device's storage (same context; every
  // `browser.newPage()` makes a new one) and opens the layout last saved.
  const newTab = await page.context().newPage()
  try {
    await newTab.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
    await newTab.waitForFunction(
      () => document.getElementById("status")?.textContent === "connected",
      { timeout: 20_000 },
    )
    await waitFor(() => false, 1_000)
    const inNewTab = await columnKeys(newTab)
    ok(
      inNewTab.join() === openKeys.join(),
      `a new tab opens the device's last layout (${inNewTab.length} of ${openKeys.length})`,
    )
  } finally {
    await newTab.close().catch(() => {})
  }

  // Archived by someone else before a reload, the tab you were on gives way
  // to the newest open root.
  ok(
    (await selectedRoot(page)) === downRoot,
    "a reload keeps the tab you were on",
  )
  await api.archive("archive", entryId(downRoot))
  await page.reload({ waitUntil: "domcontentloaded" })
  const landed = await page
    .waitForFunction(
      r =>
        document
          .querySelector('#tabs .tab[aria-selected="true"]')
          ?.getAttribute("data-root") === r,
      thirdRoot,
      { timeout: 20_000 },
    )
    .then(
      () => true,
      () => false,
    )
  ok(
    landed,
    `after a reload, a root archived meanwhile gives way to your last open tab (${await selectedRoot(page)})`,
  )
  await api.close()

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
