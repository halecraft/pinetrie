// S167's probe (docs/findings/S167-fold-turn-lands.md): does a column
// header's name, turned 90° clockwise, land on the folded strip's name?
// Disposable. It imports the e2e harness by relative path: copy it to
// `apps/pinetrie/e2e/s163-land.ts` and run it from the repo root:
//
//   node apps/pinetrie/e2e/s163-land.ts [out-dir for the overlay shots]

import { mkdirSync } from "node:fs"
import { chromium, type Page } from "@playwright/test"
import { asPerson, chooseFromMenu } from "./browser/page.ts"
import { startSuiteHost, suiteModel } from "./harness.ts"

const OUT = process.argv[2] ?? "/tmp/s163"
mkdirSync(OUT, { recursive: true })

const host = await startSuiteHost({
  model: { kind: "scripted", script: suiteModel() },
  log: () => {},
})
const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 1920, height: 1080 } })
).newPage()
await asPerson(page, "ada@s163.test", "Ada")
await page.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
await page.click("#sidebar .add-agent")
await page.waitForSelector(".column .column-head .agent-name[data-thread]", {
  timeout: 30_000,
})
await page.waitForTimeout(500)

type Box = { left: number; top: number; width: number; height: number }
type Glyphs = { chars: string; boxes: Box[]; whole: Box; font: string }

/** Each glyph's box of the text in `sel`: the last non-empty text node. */
const glyphs = (p: Page, sel: string): Promise<Glyphs | null> =>
  p.evaluate(s => {
    const el = document.querySelector(s)
    if (el === null) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Text | null = null
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      if (
        (n.textContent ?? "").trim() !== "" &&
        !n.parentElement?.closest(".thread-mark")
      )
        node = n as Text
    if (node === null) return null
    const t = node.textContent ?? ""
    const start = t.length - t.trimStart().length
    const end = t.trimEnd().length
    const box = (r: DOMRect) => ({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    })
    const boxes: Box[] = []
    for (let i = start; i < end; i++) {
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + 1)
      boxes.push(box(r.getBoundingClientRect()))
    }
    const all = document.createRange()
    all.setStart(node, start)
    all.setEnd(node, end)
    const cs = getComputedStyle(node.parentElement as Element)
    return {
      chars: t.slice(start, end),
      boxes,
      whole: box(all.getBoundingClientRect()),
      font: `${cs.fontSize} ${cs.fontWeight} ${cs.fontFamily} lh=${cs.lineHeight}`,
    }
  }, sel)

const centre = (b: Box) => ({
  x: b.left + b.width / 2,
  y: b.top + b.height / 2,
})

/**
 * Turn `h` 90° clockwise about its whole box's top-left corner, then move
 * that box onto `v`'s (its right edge on v's right, its top on v's top):
 * how far each glyph's centre lands from its vertical counterpart.
 */
function landing(h: Glyphs, v: Glyphs) {
  const o = { x: h.whole.left, y: h.whole.top }
  const tx = v.whole.left + v.whole.width - o.x
  const ty = v.whole.top - o.y
  const errs = h.boxes.map((b, i) => {
    const c = centre(b)
    // Clockwise in screen space: (dx, dy) → (−dy, dx), about o.
    const rx = o.x - (c.y - o.y) + tx
    const ry = o.y + (c.x - o.x) + ty
    const vb = v.boxes[i]
    if (vb === undefined) return { dx: Number.NaN, dy: Number.NaN }
    const vc = centre(vb)
    return { dx: rx - vc.x, dy: ry - vc.y }
  })
  const max = (k: "dx" | "dy") => Math.max(...errs.map(e => Math.abs(e[k])))
  const mean = (k: "dx" | "dy") =>
    errs.reduce((s, e) => s + e[k], 0) / errs.length
  return {
    translate: { tx, ty },
    across: { mean: mean("dx"), max: max("dx") },
    along: { mean: mean("dy"), max: max("dy") },
    hWhole: h.whole,
    vWhole: v.whole,
  }
}

// The header's name is gone once folded, so keep a copy: measure the header
// first, then fold, then lay the turned copy over the strip.
async function overlay(
  label: string,
  hSel: string,
  vSel: string,
  fold: () => Promise<void>,
  css: string,
) {
  const h = await glyphs(page, hSel)
  if (h === null) throw new Error(`no ${hSel}`)
  // A fixed copy of the header's name, before it goes.
  await page.evaluate(sel => {
    const src = document.querySelector(sel)
    if (src === null) return
    const walker = document.createTreeWalker(src, NodeFilter.SHOW_TEXT)
    let node: Text | null = null
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      if (
        (n.textContent ?? "").trim() !== "" &&
        !n.parentElement?.closest(".thread-mark")
      )
        node = n as Text
    if (node === null) return
    const t = node.textContent ?? ""
    const r = document.createRange()
    r.setStart(node, t.length - t.trimStart().length)
    r.setEnd(node, t.trimEnd().length)
    const whole = r.getBoundingClientRect()
    const line = (node.parentElement as Element).getBoundingClientRect()
    const cs = getComputedStyle(node.parentElement as Element)
    const span = document.createElement("span")
    span.id = "s163-turned"
    span.textContent = t.trim()
    // The copy's line box is its source's line, so its glyphs sit where theirs do.
    Object.assign(span.style, {
      position: "fixed",
      left: `${whole.left}px`,
      top: `${whole.top}px`,
      display: "block",
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      whiteSpace: "nowrap",
      color: "rgb(255 60 60 / .75)",
      transformOrigin: "0 0",
      zIndex: "9999",
      pointerEvents: "none",
    })
    document.body.append(span)
    // Its glyphs where the source's are: shift by the difference.
    const r2 = document.createRange()
    r2.selectNodeContents(span)
    const g = r2.getBoundingClientRect()
    span.style.left = `${whole.left - (g.left - whole.left)}px`
    span.style.top = `${whole.top - (g.top - whole.top)}px`
    void line
  }, hSel)
  const copy = await glyphs(page, "#s163-turned")
  if (copy === null) throw new Error("no copy")
  await page.evaluate(c => {
    document.querySelector("#s163-style")?.remove()
    const s = document.createElement("style")
    s.id = "s163-style"
    s.textContent = c
    document.head.append(s)
  }, css)
  await fold()
  await page.waitForSelector(vSel)
  await page.waitForTimeout(300)
  const v = await glyphs(page, vSel)
  if (v === null) throw new Error(`no ${vSel}`)
  const l = landing(h, v)
  const lc = landing(copy, v)
  // The box formula alone, then corrected by the glyphs' mean residual.
  const results = []
  // The real animation would know only the two elements' boxes: the
  // header's name (a line box) and the strip's (a vertical line box).
  const boxes = await page.evaluate(sel => {
    const e = document.querySelector("#s163-turned")?.getBoundingClientRect()
    const f = document.querySelector(sel)?.getBoundingClientRect()
    return e === undefined || f === undefined
      ? null
      : { e: e.toJSON(), f: f.toJSON() }
  }, vSel)
  if (boxes === null) throw new Error("no boxes")
  const { e, f } = boxes as { e: DOMRect; f: DOMRect }
  console.log(
    label,
    "element boxes",
    JSON.stringify({ h: [e.width, e.height], v: [f.width, f.height] }),
  )
  let residual = { x: 0, y: 0 }
  for (const name of ["box", "corrected"] as const) {
    const dx = name === "box" ? 0 : -residual.x
    const dy = name === "box" ? 0 : -residual.y
    await page.evaluate(
      ({ tx, ty }) => {
        const s = document.querySelector<HTMLElement>("#s163-turned")
        if (s !== null)
          s.style.transform = `translate(${tx}px, ${ty}px) rotate(90deg)`
      },
      { tx: f.right - e.left + dx, ty: f.top - e.top + dy },
    )
    const turned = await glyphs(page, "#s163-turned")
    if (turned === null) throw new Error("no turned")
    const errs = turned.boxes.map((b, i) => {
      const vb = v.boxes[i] as Box
      return {
        x: centre(b).x - centre(vb).x,
        y: centre(b).y - centre(vb).y,
        w: b.width - vb.width,
        h: b.height - vb.height,
      }
    })
    const m = (k: "x" | "y" | "w" | "h") =>
      Math.max(...errs.map(e => Math.abs(e[k]))).toFixed(2)
    residual = {
      x: errs.reduce((a, q) => a + q.x, 0) / errs.length,
      y: errs.reduce((a, q) => a + q.y, 0) / errs.length,
    }
    results.push({
      name,
      meanDx: residual.x.toFixed(2),
      meanDy: residual.y.toFixed(2),
      maxDx: m("x"),
      maxDy: m("y"),
      maxDw: m("w"),
      maxDh: m("h"),
    })
    const strip = await page.evaluate(sel => {
      const r = document
        .querySelector(sel)
        ?.closest("section")
        ?.getBoundingClientRect()
      return r === undefined
        ? null
        : {
            x: r.left - 4,
            y: r.top,
            width: r.width + 8,
            height: Math.min(r.height, 260),
          }
    }, vSel)
    if (strip !== null)
      await page.screenshot({
        path: `${OUT}/${label}-${name}.png`,
        clip: strip,
      })
  }
  console.log(
    JSON.stringify(
      {
        label,
        css: css || "(as now)",
        chars: h.chars,
        hFont: h.font,
        vFont: v.font,
        hAdvance: +(h.whole.width / h.chars.length).toFixed(2),
        vAdvance: +(v.whole.height / v.chars.length).toFixed(2),
        predicted: { across: l.across, along: l.along },
        copyPredicted: { across: lc.across, along: lc.along },
        turnedByCss: results,
      },
      null,
      1,
    ),
  )
  await page.evaluate(() => {
    document.querySelector("#s163-turned")?.remove()
    document.querySelector("#s163-style")?.remove()
  })
}

const foldThread = async () => {
  const ok = await chooseFromMenu(
    page,
    ".column .column-head .column-menu",
    'button:has-text("Fold")',
  )
  if (!ok) throw new Error("no fold")
}
const unfoldThread = async () => {
  await page.click('.folded-column[data-kind="thread"] .folded-title')
  await page.waitForSelector(".column .column-head .agent-name[data-thread]")
  await page.waitForTimeout(300)
}
const foldTask = async () => {
  await page.click(".task-column .task-column-head .fold")
}
const unfoldTask = async () => {
  await page.click(".task-column.folded-column .folded-title")
  await page.waitForSelector(".task-column .task-column-title")
  await page.waitForTimeout(300)
}

const THREAD_H = ".column .column-head .agent-name"
const THREAD_V = '.folded-column[data-kind="thread"] .folded-name'
const SAME = ".folded-name { font-size: .85rem; }"
for (const css of ["", SAME]) {
  await overlay(
    css === "" ? "thread-now" : "thread-same",
    THREAD_H,
    THREAD_V,
    foldThread,
    css,
  )
  await unfoldThread()
}

// The task column: its header's title against its strip's name.
await page.waitForSelector(".task-column", { timeout: 10_000 })
const taskUnfolded = await page.evaluate(
  () => document.querySelector(".task-column-title") !== null,
)
if (!taskUnfolded) await unfoldTask()
const TASK_H = ".task-column .task-column-title"
const TASK_V = ".task-column.folded-column .folded-name"
const taskFont = await page.evaluate(() => {
  const t = document.querySelector(".task-column-title")
  return t === null ? null : getComputedStyle(t).fontSize
})
for (const css of ["", `.folded-name { font-size: ${taskFont}; }`]) {
  await overlay(
    css === "" ? "task-now" : "task-same",
    TASK_H,
    TASK_V,
    foldTask,
    css,
  )
  await unfoldTask()
}

await browser.close()
await host.shutdown()
process.exit(0)
