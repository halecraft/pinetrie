// S250 probe: file drags from "the desktop" over the strip, and image drags
// out of a thread, in Chromium against a real host. Run from
// apps/pinetrie/e2e/browser, copied in, since its imports resolve from there:
//   cp ../../../../docs/findings/S250-image-drags-on-the-canvas/probe.ts _probe.ts && node _probe.ts; rm _probe.ts
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startSuiteHost, suiteModel } from "../harness.ts"
import { asPerson, col, launchBrowser, PANE_VIEWPORT, typeAfter } from "./page.ts"

const SHOT = path.resolve("../../../../docs/findings/S167-fold-turn-lands/thread-same-size.png")
const out: Record<string, unknown> = {}
const log = (k: string, v: unknown) => { out[k] = v; console.log(k, JSON.stringify(v, null, 1)) }

const host = await startSuiteHost({ model: { kind: "scripted", script: suiteModel() }, log: () => {} })
const browser = await launchBrowser()
try {
  const ctx = await browser.newContext({ viewport: PANE_VIEWPORT })
  const p = await ctx.newPage()
  await asPerson(p, "pia@browser.test", "Pia")
  const blobPosts: string[] = []
  p.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/blob")) blobPosts.push(r.url()) })
  await p.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
  await p.click("#sidebar .add-canvas")
  const box = `${col(0)} .composer .input`
  await typeAfter(p, box, "look at this ")
  const bytes = readFileSync(SHOT).toString("base64")
  await p.evaluate(([sel, b64]) => {
    const input = document.querySelector(sel) as HTMLTextAreaElement
    input.focus()
    const data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], "shot.png", { type: "image/png" }))
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  }, [box, bytes] as const)
  await p.waitForFunction(sel => (document.querySelector(sel) as HTMLTextAreaElement).value.includes("/blob/"), box, { timeout: 15000 })
  await p.click(`${col(0)} .composer .send`)
  const img = `${col(0)} .msg img.blob-image`
  await p.waitForFunction(sel => { const i = document.querySelector(sel) as HTMLImageElement | null; return i?.complete && i.naturalWidth > 0 }, img, { timeout: 20000 })
  await p.waitForTimeout(1500)
  blobPosts.length = 0

  // What the strip holds, left to right.
  log("strip", await p.evaluate(() => [...(document.querySelector("#strip")?.children ?? [])].map(c => {
    const r = c.getBoundingClientRect()
    return { cls: c.className, kind: (c as HTMLElement).dataset.kind ?? null, left: Math.round(r.left), right: Math.round(r.right) }
  })))

  // Record every drag and pointer event the page sees, where, and who took it.
  await p.evaluate(() => {
    const w = window as unknown as { __ev: unknown[]; __marks: string[] }
    w.__ev = []; w.__marks = []
    const where = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return String(t)
      const near = t.closest(".composer, .column-head, .msg, .canvas-column, .canvas-end, .column, .folded-column, #strip")
      const named = t.closest("[id], [class]:not([class=''])")
      const self = t.classList.length > 0 ? `${t.tagName.toLowerCase()}.${[...t.classList].join(".")}` : `${t.tagName.toLowerCase()} under ${named === null ? "-" : named.id !== "" ? `#${named.id}` : `.${[...named.classList].join(".")}`}`
      return `${self} in ${near === null ? "-" : `${near.tagName.toLowerCase()}.${[...near.classList].slice(0, 2).join(".")}`}`
    }
    for (const type of ["dragenter", "dragover", "drop", "dragstart", "dragend", "pointerdown", "pointermove", "pointerup", "pointercancel", "dragleave"]) {
      // Capture on window: first to see it. Bubble on document: after every element's handler, before the window's guard.
      window.addEventListener(type, e => {
        const d = (e as DragEvent).dataTransfer
        w.__ev.push({ phase: "capture", type, at: where(e.target), x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, types: d ? [...d.types] : null, effectAllowed: d?.effectAllowed ?? null })
      }, true)
      document.addEventListener(type, e => {
        if (!type.startsWith("drag") && type !== "drop") return
        const d = (e as DragEvent).dataTransfer
        w.__ev.push({ phase: "element-took", type, taken: e.defaultPrevented, dropEffect: d?.dropEffect ?? null })
      })
    }
    new MutationObserver(ms => { for (const m of ms) if (m.type === "attributes") w.__marks.push(`${(m.target as Element).tagName.toLowerCase()}.${(m.target as Element).className.toString().split(" ")[0]} ${m.attributeName}=${(m.target as Element).getAttribute(m.attributeName ?? "")}`) })
      .observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-card-drag", "data-dragging", "data-drop-mark", "data-reordering"] })
  })
  const take = () => p.evaluate(() => { const w = window as unknown as { __ev: unknown[]; __marks: string[] }; const r = { ev: w.__ev, marks: w.__marks }; w.__ev = []; w.__marks = []; return r })

  // 1, 2: one file drag from "the desktop", over each place, then cancelled.
  const points = await p.evaluate(([imgSel, boxSel]) => {
    const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null
    const strip = [...(document.querySelector("#strip")?.children ?? [])]
    const canvasCol = strip[0]?.getBoundingClientRect()
    const thread = rect('.column[data-position="0"]')
    const header = rect('.column[data-position="0"] .column-head')
    const msg = rect('.column[data-position="0"] .msg')
    const image = rect(imgSel)
    const composer = rect(boxSel)
    const end = rect(".canvas-end")
    const c = (r: DOMRect | null | undefined, dx = 0.5, dy = 0.5) => r ? { x: Math.round(r.left + r.width * dx), y: Math.round(r.top + r.height * dy) } : null
    return {
      "canvas column": c(canvasCol),
      "between canvas column and thread": canvasCol && thread ? { x: Math.round((canvasCol.right + thread.left) / 2), y: Math.round(thread.top + 200) } : null,
      "thread header": c(header, 0.3),
      "thread message text": msg ? { x: Math.round(msg.left + 20), y: Math.round(msg.top + 8) } : null,
      "image in message": c(image),
      composer: c(composer),
      "canvas end (+)": c(end),
      "past the last column": thread ? { x: Math.min(Math.round(thread.right + 150), 1430), y: Math.round(thread.top + 200) } : null,
    }
  }, [img, box] as const)
  log("points", points)
  const dir = mkdtempSync(path.join(tmpdir(), "s247-"))
  const file = path.join(dir, "mockup.png")
  writeFileSync(file, readFileSync(SHOT))
  const cdp = await ctx.newCDPSession(p)
  const data = { items: [], files: [file], dragOperationsMask: 1 }
  const overs: Record<string, unknown> = {}
  for (const [name, pt] of Object.entries(points)) {
    if (pt === null) continue
    // One drag per place: enter, two overs (the second is the one a page answers), cancel.
    for (const type of ["dragEnter", "dragOver", "dragOver"] as const)
      await cdp.send("Input.dispatchDragEvent", { type, x: pt.x, y: pt.y, data })
    await p.waitForTimeout(50)
    await cdp.send("Input.dispatchDragEvent", { type: "dragCancel", x: pt.x, y: pt.y, data })
    await p.waitForTimeout(50)
    const r = await take()
    const ev = r.ev as { phase: string; type: string; at?: string; taken?: boolean; dropEffect?: string; x?: number; y?: number }[]
    overs[name] = {
      at: ev.find(e => e.type === "dragover" && e.phase === "capture")?.at ?? null,
      point: ev.filter(e => e.type === "dragover" && e.phase === "capture").map(e => [e.x, e.y]),
      takenByAnElement: ev.filter(e => e.type === "dragover" && e.phase === "element-took").map(e => e.taken),
      dropEffectAfterElements: ev.filter(e => e.type === "dragover" && e.phase === "element-took").map(e => e.dropEffect),
      pointerEvents: ev.filter(e => e.type.startsWith("pointer")).length,
      marks: r.marks,
    }
  }
  log("file drag over each place", overs)

  // A drop between columns, and one past the last: refused or taken, and does the page stay?
  for (const name of ["between canvas column and thread", "past the last column"] as const) {
    const pt = points[name]
    if (pt === null) continue
    const url = p.url()
    for (const type of ["dragEnter", "dragOver", "drop"] as const)
      await cdp.send("Input.dispatchDragEvent", { type, x: pt.x, y: pt.y, data })
    await p.waitForTimeout(500)
    log(`file drop ${name}`, { ...(await take()), sameUrl: p.url() === url, blobPosts: blobPosts.length })
  }

  // 3: press on the message's image and move: the browser's own drag?
  const ib = await p.locator(img).boundingBox()
  const cb = await p.locator(box).boundingBox()
  if (ib !== null && cb !== null) {
    const before = await p.locator(box).inputValue()
    await p.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2)
    await p.mouse.down()
    for (let i = 1; i <= 8; i++) await p.mouse.move(ib.x + ib.width / 2 + i * 4, ib.y + ib.height / 2 + i * 2)
    await p.mouse.move(cb.x + 30, cb.y + 10, { steps: 6 })
    await p.mouse.up()
    await p.waitForTimeout(800)
    const r = await take()
    log("image in a message dragged onto the composer", {
      ...r,
      ev: (r.ev as { type: string }[]).filter(e => e.type !== "pointermove"),
      pointermoves: (r.ev as { type: string }[]).filter(e => e.type === "pointermove").length,
      composerBefore: before,
      composerAfter: await p.locator(box).inputValue(),
      blobPosts: blobPosts.length,
      pane: await p.locator(`${col(0)} > .pane`).count(),
    })
  }

  // 3b: the same press with the image's own dragstart prevented, as the
  // engine does inside a handle: do pointer events go on to the release?
  if (ib !== null && cb !== null) {
    await p.evaluate(sel => document.querySelector(sel)?.addEventListener("dragstart", e => e.preventDefault()), img)
    await p.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2)
    await p.mouse.down()
    for (let i = 1; i <= 8; i++) await p.mouse.move(ib.x + ib.width / 2 + i * 4, ib.y + ib.height / 2 + i * 2)
    await p.mouse.move(cb.x + 30, cb.y + 10, { steps: 6 })
    await p.mouse.up()
    await p.waitForTimeout(500)
    const r = await take()
    const ev = r.ev as { type: string; at?: string }[]
    log("image in a message, its dragstart prevented", {
      types: ev.map(e => e.type).filter((t, i, a) => t !== a[i - 1]),
      pointermoves: ev.filter(e => e.type === "pointermove").length,
      lastPointerAt: ev.filter(e => e.type.startsWith("pointer")).at(-1),
      pane: await p.locator(`${col(0)} > .pane`).count(),
      marks: r.marks,
    })
  }

  // 4: press on the thread's icon in its header, a drag handle, and move.
  const icon = await p.evaluate(() => {
    const i = document.querySelector('.column[data-position="0"] .column-head img')
    const r = i?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, src: i?.getAttribute("src"), handle: i?.closest("[data-drag-card]") !== null } : null
  })
  log("icon in header", icon)
  if (icon !== null) {
    await p.mouse.move(icon.x, icon.y)
    await p.mouse.down()
    for (let i = 1; i <= 10; i++) await p.mouse.move(icon.x - i * 6, icon.y + i)
    await p.waitForTimeout(100)
    const mid = await take()
    await p.keyboard.press("Escape")
    await p.mouse.up()
    await p.waitForTimeout(300)
    const end = await take()
    log("image inside a handle, dragged", {
      during: (mid.ev as { type: string }[]).filter(e => e.type !== "pointermove"),
      pointermoves: (mid.ev as { type: string }[]).filter(e => e.type === "pointermove").length,
      marksDuring: mid.marks,
      after: (end.ev as { type: string }[]).filter(e => e.type !== "pointermove"),
      marksAfter: end.marks,
    })
  }
  writeFileSync(path.resolve("../../../../docs/findings/S250-image-drags-on-the-canvas/output.json"), JSON.stringify(out, null, 1))
  await p.screenshot({ path: path.resolve("../../../../docs/findings/S250-image-drags-on-the-canvas/page.png") })
} finally {
  await browser.close()
  await host.shutdown()
}
