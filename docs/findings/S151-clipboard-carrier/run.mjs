// S151's runner: drives probe.html in headed Chromium, Firefox and WebKit at
// once, under one X server (xvfb-run), so a copy in one reaches the others
// through the X clipboard, and reads that clipboard with xclip. Writes
// results.json beside itself.
//
//   xvfb-run -a node docs/findings/S151-clipboard-carrier/run.mjs
//
// Keys are Playwright's keyboard (trusted input). A sanity step checks that
// Ctrl+C in a textarea reaches the X clipboard in each engine, so the keys
// run the browser's own copy command.

import { execFileSync, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, "../../../apps/pinetrie/package.json"))
const { chromium, firefox, webkit } = require("@playwright/test")

const html = readFileSync(join(here, "probe.html"))
const server = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(html)
})
await new Promise(r => server.listen(0, "::", r))
const port = server.address().port
const ORIGIN = {
  a: `http://127.0.0.1:${port}/`,
  b: `http://localhost:${port}/`,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const X = args => {
  try {
    return execFileSync("xclip", ["-selection", "clipboard", "-o", ...args], {
      timeout: 3000,
    }).toString()
  } catch (err) {
    return `ERR ${String(err.message).split("\n")[0]}`
  }
}
const xTargets = () =>
  X(["-t", "TARGETS"])
    .split("\n")
    .filter(t => t !== "")
const xRead = t => X(["-t", t])
/** What the X clipboard holds: its targets, and the interesting ones read. */
const xClipboard = () => {
  const targets = xTargets()
  const read = {}
  for (const t of targets)
    if (/text\/|x-pinetrie|custom|chromium|moz|webkit|UTF8_STRING/i.test(t))
      read[t] = xRead(t).slice(0, 4000)
  return { targets, read }
}
const xSet = text => {
  const p = spawn("xclip", ["-selection", "clipboard", "-i"], {
    stdio: ["pipe", "ignore", "ignore"],
  })
  p.stdin.end(text)
}

const engines = { chromium, firefox, webkit }
const at = {}
for (const [name, type] of Object.entries(engines)) {
  const browser = await type.launch({ headless: false })
  const context = await browser.newContext()
  const a = await context.newPage()
  await a.goto(ORIGIN.a)
  const b = await context.newPage()
  await b.goto(ORIGIN.b)
  at[name] = { browser, context, a, b, version: browser.version() }
}

const logLength = page => page.evaluate(() => window.log.length)
const logSince = (page, n) => page.evaluate(n => window.log.slice(n), n)
const setTricks = (page, tricks) =>
  page.evaluate(t => {
    for (const id of [
      "selectionTrick",
      "catcherTrick",
      "asyncKeys",
      "beforeTrick",
    ])
      document.getElementById(id).checked = t.includes(id)
  }, tricks)
const focusCard = page =>
  page.evaluate(() => {
    getSelection().removeAllRanges()
    document.getElementById("card").focus()
  })
/** Press `combo` on `page` with focus where `focus` puts it; what it logged. */
async function press(page, combo, focus, tricks = []) {
  await page.bringToFront()
  await setTricks(page, tricks)
  await focus(page)
  const n = await logLength(page)
  await page.keyboard.press(combo)
  await sleep(400)
  return logSince(page, n)
}
const events = (log, kind) => log.filter(e => e.ev === kind)

const results = {
  port,
  versions: {},
  sanity: {},
  copy: {},
  external: {},
  asyncApi: {},
  reads: {},
  roundTrip: {},
}
for (const [name, s] of Object.entries(at)) results.versions[name] = s.version

// Sanity: the keys run each engine's own copy, which reaches X.
for (const [name, s] of Object.entries(at)) {
  const word = `sanity-${name}`
  await press(s.a, "Control+c", async p => {
    await p.evaluate(w => {
      const box = document.getElementById("box")
      box.value = w
      box.focus()
      box.select()
    }, word)
  })
  results.sanity[name] =
    xRead("UTF8_STRING") === word ? "ok" : xRead("UTF8_STRING")
}

/** Paste into every engine's card (both origins) and box; what each saw. */
async function pasteEverywhere() {
  const seen = {}
  for (const [name, s] of Object.entries(at))
    for (const origin of ["a", "b"]) {
      const page = s[origin]
      const plain = await press(page, "Control+v", focusCard)
      const caught = events(plain, "paste").length
        ? null
        : await press(page, "Control+v", focusCard, ["catcherTrick"])
      const box = await press(page, "Control+v", p =>
        p.evaluate(() => {
          const b = document.getElementById("box")
          b.value = ""
          b.focus()
        }),
      )
      const boxValue = await page.evaluate(
        () => document.getElementById("box").value,
      )
      seen[`${name}/${origin}`] = {
        card: events(plain, "paste")[0] ?? "no paste event",
        cardWithCatcher:
          caught === null
            ? undefined
            : (events(caught, "paste")[0] ?? "no paste event"),
        boxValue,
        boxTypes: events(box, "paste")[0]?.types,
      }
    }
  return seen
}

// 1 and 2: a copy and a cut from the card, nothing selected; where no event
// fires, the selection trick.
for (const [name, s] of Object.entries(at)) {
  await s.a.evaluate(n => (window.nonce = n), `${name}-copy`)
  const plain = await press(s.a, "Control+c", focusCard)
  let copy = events(plain, "copy")[0] ?? null
  let trick = null
  if (copy === null) {
    const tricked = await press(s.a, "Control+c", focusCard, ["selectionTrick"])
    copy = events(tricked, "copy")[0] ?? null
    trick =
      copy === null
        ? "selection trick: no copy event either"
        : "selection trick fired it"
  }
  const x = xClipboard()
  const pasted = copy === null ? null : await pasteEverywhere()
  const cutLog = await press(s.a, "Control+x", focusCard)
  let cut = events(cutLog, "cut")[0] ?? null
  let cutTrick = null
  if (cut === null) {
    const tricked = await press(s.a, "Control+x", focusCard, ["selectionTrick"])
    cut = events(tricked, "cut")[0] ?? null
    cutTrick =
      cut === null
        ? "selection trick: no cut event either"
        : "selection trick fired it"
  }
  results.copy[name] = {
    copy: copy ?? "no copy event",
    trick,
    x,
    pasted,
    cut: cut ?? "no cut event",
    cutTrick,
  }
}

// A rich text box's round trip: the card pasted into a contenteditable,
// then copied from it as a person would; does the carrier come back?
for (const [name, s] of Object.entries(at)) {
  await s.a.evaluate(n => (window.nonce = n), `${name}-trip`)
  await press(s.a, "Control+c", focusCard)
  const focusRich = p =>
    p.evaluate(() => {
      const r = document.getElementById("rich")
      r.innerHTML = ""
      r.focus()
    })
  await press(s.a, "Control+v", focusRich)
  const kept = await s.a.evaluate(
    () => document.getElementById("rich").innerHTML,
  )
  await press(s.a, "Control+c", p =>
    p.evaluate(() => {
      const r = document.getElementById("rich")
      r.focus()
      const range = document.createRange()
      range.selectNodeContents(r)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    }),
  )
  results.roundTrip[name] = { richInnerHTML: kept, x: xClipboard() }
}

// 3: a copy made in another app: only what that app wrote arrives.
xSet("from another app")
await sleep(300)
results.external = { x: xClipboard(), pasted: await pasteEverywhere() }

// The async Clipboard API: a write from the keydown, with web custom
// formats where the engine takes them, then what every engine pastes.
for (const [name, s] of Object.entries(at)) {
  await s.a.evaluate(n => (window.nonce = n), `${name}-async`)
  const n = await logLength(s.a)
  await press(s.a, "Control+c", focusCard, ["asyncKeys"])
  await sleep(3000)
  const write =
    events(await logSince(s.a, n), "asyncWrite")[0] ??
    "no write settled in 3.4s"
  results.asyncApi[name] = {
    write,
    x: xClipboard(),
    pasted: await pasteEverywhere(),
  }
}

// Reading with no paste: readText and read() with no gesture and no
// permission granted, and read() from Ctrl+V's keydown.
for (const [name, s] of Object.entries(at)) {
  const outcome = async (fn, why) => {
    const n = await logLength(s.a)
    await s.a.evaluate(([f, w]) => void window[f](w), [fn, why])
    await sleep(2500)
    return (await logSince(s.a, n))[0] ?? "pending after 2.5s (a prompt?)"
  }
  xSet(`read-probe-${name}`)
  await sleep(300)
  const readText = await outcome("readTextNow", "evaluate, no gesture")
  const read = await outcome("asyncRead", "evaluate, no gesture")
  const fromKey = await press(s.a, "Control+v", focusCard, ["asyncKeys"])
  await sleep(2500)
  const keyRead = [...fromKey, ...(await logSince(s.a, 0))].find(
    e => e.ev === "asyncRead" && e.why === "keydown",
  )
  results.reads[name] = {
    readText,
    read,
    fromKeydown: keyRead ?? "pending after 2.5s (a prompt?)",
  }
}

writeFileSync(join(here, "results.json"), JSON.stringify(results, null, 2))
for (const s of Object.values(at)) await s.browser.close()
server.close()
console.log(JSON.stringify(results, null, 2))
