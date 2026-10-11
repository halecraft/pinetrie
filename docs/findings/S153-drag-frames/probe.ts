// S153's probe (docs/findings/S153-drag-frames.md): the per-frame work of
// ADR-0134's drag engine, injected into pine·trie's own page, timed against
// the same pointer path with no drag. Disposable.
//
// It imports the e2e harness by relative path: copy it to
// `apps/pinetrie/e2e/s153-probe.ts` to run it, from the repo root:
//
//   node apps/pinetrie/e2e/s153-probe.ts [columns] [per-branch] [trunk]
//
// S153_RATES (default 1,4,6) and S153_MODES choose the runs; S153_CHROME=1
// runs the Chrome installed on the machine, headed, with its GPU.

import { atEntry, entryId, ROOT } from "@pinetrie/core"
import { DROP_ZONE } from "@pinetrie/interface"
import { chromium, type Page } from "@playwright/test"
import { asPerson, openFromBoard } from "./browser/page.ts"
import {
  BRANCH,
  join,
  START_CHAT,
  startSuiteHost,
  suiteModel,
  taskAt,
} from "./harness.ts"

const COLUMNS = Number(process.argv[2] ?? 10)
const PER = Number(process.argv[3] ?? 120)
const TRUNK = Number(process.argv[4] ?? 200)

const text = (i: number) =>
  i % 4 === 0
    ? `Step ${i}: here is **why** the parser fails on \`foo\`, and a list:\n\n- first, the tokenizer\n- then the grammar, rule ${i}\n- then [the docs](https://example.com/${i})`
    : i % 4 === 1
      ? `\`\`\`ts\nexport function parse${i}(input: string): Tree {\n  const tokens = lex(input)\n  return build(tokens, ${i})\n}\n\`\`\``
      : i % 4 === 2
        ? `A longer paragraph ${i}. ${"The quick brown fox jumps over the lazy dog. ".repeat(6)}`
        : `| a | b |\n|---|---|\n| ${i} | ${i * 2} |\n| x | y |`

const host = await startSuiteHost({
  model: { kind: "scripted", script: suiteModel() },
  log: () => {},
})
const t0 = Date.now()
const ada = await join(host, "ada", "s153")
const first = await ada.chat(text(0), ROOT, START_CHAT)
if (first.kind !== "appended") throw new Error(JSON.stringify(first))
const trunk = [first.id]
for (let i = 1; i < TRUNK; i++) {
  const r = await ada.chat(
    text(i),
    atEntry(trunk[trunk.length - 1] ?? first.id),
  )
  if (r.kind !== "appended") throw new Error(JSON.stringify(r))
  trunk.push(r.id)
}
for (let b = 1; b < COLUMNS; b++) {
  const from = trunk[Math.floor((b * TRUNK) / (COLUMNS + 1))] ?? first.id
  let tip = await ada.chat(text(b), atEntry(from), BRANCH)
  if (tip.kind !== "appended") throw new Error(JSON.stringify(tip))
  for (let i = 1; i < PER; i++) {
    const at: string = tip.kind === "appended" ? tip.id : ""
    tip = await ada.chat(text(i + b), atEntry(entryId(at)))
    if (tip.kind !== "appended") throw new Error(JSON.stringify(tip))
  }
}
const task = taskAt(ada, first.id)
if (task === undefined) throw new Error("no task")
console.log(
  `seeded ${TRUNK} + ${COLUMNS - 1}×${PER} messages in ${Date.now() - t0} ms`,
)

// S153_CHROME=1: the Chrome installed on this machine, headed, with its GPU,
// in place of the headless shell's software rendering.
const browser = await chromium.launch(
  process.env.S153_CHROME === "1" ? { channel: "chrome", headless: false } : {},
)
const page = await (
  await browser.newContext({ viewport: { width: 1920, height: 1080 } })
).newPage()
await asPerson(page, "ada@s153.test", "Ada")
await page.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
await openFromBoard(page, task)
// Unfold every column.
for (let tries = 0; tries < 40; tries++) {
  const folded = page.locator(
    '.folded-column[data-kind="thread"] .folded-title',
  )
  if ((await folded.count()) === 0) break
  await folded.first().click()
  await page.waitForTimeout(200)
}
await page.waitForFunction(
  n => document.querySelectorAll("#strip .column[data-card]").length >= n,
  COLUMNS,
  { timeout: 60_000 },
)
await page.waitForTimeout(3000)
const shape = await page.evaluate(() => ({
  nodes: document.querySelectorAll("*").length,
  columns: document.querySelectorAll("#strip .column[data-card]").length,
  messages: document.querySelectorAll(".msg").length,
  strip: document.querySelector("#strip")?.getBoundingClientRect().toJSON(),
}))
console.log("page", JSON.stringify(shape))

// The engine's per-frame work, as a stand-in (ADR-0134, One drag engine).
await page.evaluate(zones => {
  type W = Window & { __probe: unknown }
  const state = {
    mode: "off" as string,
    drag: null as null | {
      col: HTMLElement
      cols: HTMLElement[]
      from: number
      mids: number[]
      width: number
      sx: number
      sy: number
      gap: number
      zone: Element | null
      face: HTMLElement
      cached: { el: Element; r: DOMRect }[]
      lx: number
      off: boolean
      sr: DOMRect
      ghost: HTMLElement | null
    },
    x: 0,
    y: 0,
    frames: [] as number[],
    work: [] as number[],
    last: 0,
    recording: false,
    long: [] as number[],
    gaps: 0,
    zones: [] as string[],
    offs: 0,
    event: "",
    eventAt: 0,
    slow: [] as string[],
  }
  const mark = (e: string) => {
    state.event = e
    state.eventAt = performance.now()
  }
  new PerformanceObserver(l => {
    if (state.recording)
      for (const e of l.getEntries()) state.long.push(e.duration)
  }).observe({ type: "longtask", buffered: false })
  const strip = document.querySelector<HTMLElement>("#strip")
  if (strip === null) throw new Error("no strip")
  addEventListener(
    "pointerdown",
    e => {
      if (state.mode === "off") return
      const head = (e.target as Element).closest(".column-head")
      const col = head?.closest<HTMLElement>(".column[data-card]")
      if (head == null || col == null) return
      e.stopPropagation()
      e.preventDefault()
      const cols = [
        ...strip.querySelectorAll<HTMLElement>(":scope .column[data-card]"),
      ]
      const box = col.getBoundingClientRect()
      const face = document.createElement("div")
      face.textContent = "✦ amber-fox · Fix the parser"
      Object.assign(face.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "220px",
        height: "64px",
        borderRadius: "10px",
        background: "#2a2d33",
        color: "#eee",
        boxShadow: "0 12px 32px rgba(0,0,0,.45)",
        pointerEvents: "none",
        zIndex: "9999",
        display: "none",
        willChange: "transform",
        padding: "12px",
      })
      document.body.appendChild(face)
      const layers = state.mode.includes("layers")
      const ghosted = state.mode.includes("ghost")
      for (const c of cols) {
        c.style.transition = "transform 160ms cubic-bezier(.2,.8,.2,1)"
        if (layers) c.style.willChange = "transform"
      }
      let ghost: HTMLElement | null = null
      if (ghosted) {
        ghost = document.createElement("div")
        Object.assign(ghost.style, {
          position: "fixed",
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: getComputedStyle(col).backgroundColor || "#1d1f23",
          boxShadow: "0 20px 48px rgba(0,0,0,.5)",
          borderRadius: "8px",
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: "9998",
          willChange: "transform",
        })
        ghost.appendChild(head.cloneNode(true))
        document.body.appendChild(ghost)
        col.style.opacity = "0.35"
      } else {
        col.style.transition = "none"
        col.style.willChange = "transform"
        col.style.zIndex = "50"
        if (!state.mode.includes("flat"))
          col.style.boxShadow = "0 20px 48px rgba(0,0,0,.5)"
      }
      col.style.pointerEvents = "none"
      state.drag = {
        col,
        cols,
        from: cols.indexOf(col),
        mids: cols.map(c => {
          const r = c.getBoundingClientRect()
          return r.left + r.width / 2
        }),
        width: box.width,
        sx: e.clientX,
        sy: e.clientY,
        gap: cols.indexOf(col),
        zone: null,
        face,
        cached:
          state.mode === "cached"
            ? [...document.querySelectorAll(zones)].map(el => ({
                el,
                r: el.getBoundingClientRect(),
              }))
            : [],
        lx: e.clientX,
        off: false,
        sr: strip.getBoundingClientRect(),
        ghost,
      }
      mark("the press")
    },
    true,
  )
  addEventListener(
    "pointermove",
    e => {
      state.x = e.clientX
      state.y = e.clientY
    },
    true,
  )
  const end = () => {
    const d = state.drag
    if (d === null) return
    for (const c of d.cols) {
      c.style.transform = ""
      c.style.transition = ""
      c.style.pointerEvents = ""
      c.style.zIndex = ""
      c.style.boxShadow = ""
      c.style.opacity = ""
      c.style.willChange = ""
      delete c.dataset.probeTarget
    }
    if (d.zone instanceof HTMLElement) delete d.zone.dataset.probeTarget
    d.face.remove()
    d.ghost?.remove()
    state.drag = null
  }
  addEventListener("pointerup", end, true)
  addEventListener("keydown", e => e.key === "Escape" && end(), true)

  const tick = (now: number) => {
    if (state.recording && state.last !== 0) {
      state.frames.push(now - state.last)
      if (now - state.last > 50)
        state.slow.push(
          `${Math.round(now - state.last)}ms after ${now - state.eventAt < 400 ? state.event : "nothing"}`,
        )
    }
    state.last = now
    const d = state.drag
    if (d !== null) {
      const t = performance.now()
      const { x, y } = state
      const vx = x - d.lx
      d.lx = x
      const sr = state.mode.includes("layers")
        ? d.sr
        : strip.getBoundingClientRect()
      const moving = d.ghost ?? d.col
      const off = x < sr.left || x > sr.right || y < sr.top || y > sr.bottom
      if (off !== d.off) {
        d.off = off
        if (state.recording) state.offs++
        mark(off ? "leaving the strip" : "back on the strip")
        moving.style.opacity = off ? "0" : d.ghost === null ? "" : "1"
        d.face.style.display = off ? "block" : "none"
      }
      if (off)
        d.face.style.transform = `translate(${x - 110}px, ${y - 32}px) scale(1.04)`
      else
        moving.style.transform = state.mode.includes("flat")
          ? `translate(${x - d.sx}px, ${(y - d.sy) * 0.15}px)`
          : `translate(${x - d.sx}px, ${(y - d.sy) * 0.15}px) scale(1.02) rotate(${Math.max(-3, Math.min(3, vx * 0.15))}deg)`
      // The target under the pointer.
      let hit: Element | null = null
      if (state.mode === "efp") {
        hit = document.elementFromPoint(x, y)?.closest(zones) ?? null
      } else {
        for (const z of d.cached)
          if (
            x >= z.r.left &&
            x <= z.r.right &&
            y >= z.r.top &&
            y <= z.r.bottom
          )
            hit = z.el
      }
      if (hit !== d.zone) {
        if (d.zone instanceof HTMLElement) delete d.zone.dataset.probeTarget
        if (hit instanceof HTMLElement) hit.dataset.probeTarget = ""
        d.zone = hit
        if (state.recording && hit !== null)
          state.zones.push(
            [...hit.attributes]
              .map(a => a.name)
              .find(
                n =>
                  n.startsWith("data-put") ||
                  n.startsWith("data-root") ||
                  n.startsWith("data-list"),
              ) ?? hit.tagName,
          )
      }
      // The gap it would land in, and the neighbours slid apart.
      if (!off) {
        let gap = d.mids.findIndex(m => x < m)
        if (gap < 0) gap = d.mids.length
        if (gap !== d.gap) {
          d.gap = gap
          if (state.recording) state.gaps++
          mark("a gap change")
          d.cols.forEach((c, i) => {
            if (c === d.col) {
              if (d.ghost !== null) {
                const to = gap > d.from ? gap - 1 : gap
                const shift = (to - d.from) * d.width
                c.style.transform = shift === 0 ? "" : `translateX(${shift}px)`
              }
              return
            }
            const shift =
              i > d.from && i < gap
                ? -d.width
                : i < d.from && i >= gap
                  ? d.width
                  : 0
            c.style.transform = shift === 0 ? "" : `translateX(${shift}px)`
          })
        }
      }
      if (state.recording) state.work.push(performance.now() - t)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  ;(window as unknown as W).__probe = state
}, DROP_ZONE)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** One pass of the pointer: along the strip and back, out to the sidebar, back. */
async function path(p: Page, press: boolean) {
  const strip = shape.strip as { left: number; right: number; top: number }
  const hy = strip.top + 20
  const head = await p.evaluate(() => {
    document.querySelector("#strip")?.scrollTo({ left: 0 })
    const cols = [...document.querySelectorAll("#strip .column[data-card]")]
    const c = cols[1] ?? cols[0]
    const name = c?.querySelector(".column-head .head-space")
    const r = (name ?? c)?.getBoundingClientRect()
    return r === undefined
      ? null
      : { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (press)
    console.log(
      "press at",
      JSON.stringify(head),
      await p.evaluate(h => {
        const el = h === null ? null : document.elementFromPoint(h.x, h.y)
        return el === null ? "none" : `${el.tagName}.${el.className}`
      }, head),
    )
  const sx = head?.x ?? strip.left + 300
  const sy = head?.y ?? hy
  await p.mouse.move(sx, sy)
  if (press) await p.mouse.down()
  const points: [number, number][] = []
  const line = (ax: number, ay: number, bx: number, by: number, n: number) => {
    for (let i = 1; i <= n; i++)
      points.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n])
  }
  const right = Math.min(strip.right - 40, 1880)
  line(sx, sy, right, sy + 200, 90)
  line(right, sy + 200, strip.left + 40, sy + 400, 120)
  line(strip.left + 40, sy + 400, 60, 300, 40)
  line(60, 300, 60, 700, 40)
  line(60, 700, sx, sy + 300, 60)
  for (const [x, y] of points) {
    await p.mouse.move(x, y)
    await sleep(16)
  }
  if (press) {
    await p.keyboard.press("Escape")
    await p.mouse.up()
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (f: number) =>
    s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0
  return {
    n: s.length,
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    max: +(s.at(-1) ?? 0).toFixed(2),
    over20: s.filter(x => x > 20).length,
    over50: s.filter(x => x > 50).length,
  }
}

const cdp = await page.context().newCDPSession(page)
const results: Record<string, unknown>[] = []
for (const rate of (process.env.S153_RATES ?? "1,4,6").split(",").map(Number)) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate })
  for (const mode of (
    process.env.S153_MODES ??
    "off,efp,cached,efp+ghost,efp+layers,efp+layers+ghost"
  ).split(",")) {
    for (let run = 0; run < 3; run++) {
      await page.evaluate(m => {
        const s = (window as unknown as { __probe: Record<string, unknown> })
          .__probe
        s.mode = m
        s.frames = []
        s.work = []
        s.long = []
        s.gaps = 0
        s.zones = []
        s.offs = 0
        s.slow = []
        s.last = 0
        s.recording = true
      }, mode)
      await path(page, mode !== "off")
      const got = await page.evaluate(() => {
        const s = (
          window as unknown as {
            __probe: {
              frames: number[]
              work: number[]
              long: number[]
              recording: boolean
              gaps: number
              zones: string[]
              offs: number
              slow: string[]
            }
          }
        ).__probe
        s.recording = false
        return {
          frames: s.frames,
          work: s.work,
          long: s.long,
          gaps: s.gaps,
          zones: [...new Set(s.zones)],
          offs: s.offs,
          slow: s.slow,
        }
      })
      const row = {
        rate,
        mode,
        run,
        frames: stats(got.frames),
        work: stats(got.work),
        long: got.long.length,
        longMax: Math.max(0, ...got.long),
        gaps: got.gaps,
        zones: got.zones,
        offs: got.offs,
        slow: got.slow,
      }
      results.push(row)
      console.log(JSON.stringify(row))
      await sleep(500)
    }
  }
}
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
console.log("RESULTS", JSON.stringify({ shape, results }))
await browser.close()
await host.shutdown()
process.exit(0)
