// S249 probe: thirty images in a column, fitted (up to 2000 wide) or 512
// wide, drawn full (a column, scrolled) or compact (half-column tiles, all in
// view), in Chromium's headless shell at pixel ratio 2. Run from
// apps/pinetrie/e2e/browser, copied in, since @playwright/test resolves there:
//   cp ../../../../docs/findings/S249-a-column-of-many-images/probe.ts _probe.ts && node _probe.ts; rm _probe.ts
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { chromium, type Browser } from "@playwright/test"

const HERE = path.resolve("../../../../docs/findings/S249-a-column-of-many-images")
const DIR = "/tmp/s249"
const TILES = path.resolve("../../../../docs/findings/S190-pixellab-icons/tiles/pixen")
mkdirSync(DIR, { recursive: true })
const out: Record<string, unknown> = {}
const log = (k: string, v: unknown) => { out[k] = v; console.log(k, JSON.stringify(v)) }

// --- the images: 10 screens (PNG), 10 photos (JPEG), 10 pieces of art (PNG) ---
async function makeImages(browser: Browser): Promise<string[]> {
  const page = await (await browser.newContext({ viewport: { width: 2000, height: 1500 } })).newPage()
  const names: string[] = []
  const words = "the column holds a thread its dock and the queue below it every card is shared accepted work moves on a lane runs in a container".split(" ")
  for (let i = 0; i < 10; i++) {
    const text = (n: number) => Array.from({ length: n }, (_, k) => words[(k * 7 + i * 13) % words.length]).join(" ")
    await page.setContent(`<body style="margin:0;font:15px system-ui;display:flex;gap:12px;background:#1b1d22;color:#ddd">${
      Array.from({ length: 4 }, (_, c) => `<div style="width:480px;padding:16px;background:hsl(${(i * 37 + c * 61) % 360} 25% 18%)"><h2 style="color:hsl(${(i * 37 + c * 61) % 360} 70% 70%)">${text(3)}</h2>${Array.from({ length: 14 }, (_, r) => `<p style="margin:0 0 10px">${text(18 + ((r + c) % 9))}</p>`).join("")}</div>`).join("")
    }</body>`)
    const f = `screen-${i}.png`
    writeFileSync(path.join(DIR, f), await page.screenshot({ type: "png" }))
    names.push(f)
  }
  for (let i = 0; i < 10; i++) {
    await page.setContent(`<canvas id=c width=2000 height=1500 style="display:block"></canvas><script>{
      // A block: setContent keeps the window, and its top-level consts with it.
      const c = document.getElementById("c").getContext("2d"); let s = ${i + 1}
      const r = () => (s = (s * 16807) % 2147483647) / 2147483647
      const g = c.createLinearGradient(0, 0, 2000, 1500); g.addColorStop(0, "hsl(" + r() * 360 + " 60% 40%)"); g.addColorStop(1, "hsl(" + r() * 360 + " 50% 60%)")
      c.fillStyle = g; c.fillRect(0, 0, 2000, 1500)
      for (let k = 0; k < 400; k++) { c.fillStyle = "hsla(" + r() * 360 + " 50% " + (30 + r() * 40) + "% / 0.25)"; c.beginPath(); c.arc(r() * 2000, r() * 1500, 20 + r() * 200, 0, 7); c.fill() }
      const d = c.getImageData(0, 0, 2000, 1500); for (let p = 0; p < d.data.length; p += 4) { const n = (r() - 0.5) * 40; d.data[p] += n; d.data[p + 1] += n; d.data[p + 2] += n }
      c.putImageData(d, 0, 0)}</script>`)
    const f = `photo-${i}.jpg`
    writeFileSync(path.join(DIR, f), await page.screenshot({ type: "jpeg", quality: 85 }))
    names.push(f)
  }
  await page.setViewportSize({ width: 2000, height: 2000 })
  for (const [i, t] of readdirSync(TILES).filter(n => n.endsWith(".png")).slice(0, 10).entries()) {
    const b64 = readFileSync(path.join(TILES, t)).toString("base64")
    await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${b64}" style="width:2000px;height:2000px;image-rendering:pixelated;display:block"></body>`)
    await page.waitForFunction(() => document.images[0]?.complete)
    const f = `art-${i}.png`
    writeFileSync(path.join(DIR, f), await page.screenshot({ type: "png" }))
    names.push(f)
  }
  // 512-wide copies, drawn by the browser's own scaler.
  for (const f of names) {
    const type = f.endsWith(".jpg") ? "image/jpeg" : "image/png"
    const b64 = await page.evaluate(async ([src, t]) => {
      const img = new Image(); img.src = src; await img.decode()
      const c = document.createElement("canvas"); c.width = 512; c.height = Math.round(512 * img.naturalHeight / img.naturalWidth)
      const x = c.getContext("2d"); if (x === null) return ""; x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL(t, 0.85).split(",")[1] ?? ""
    }, [`data:${type};base64,${readFileSync(path.join(DIR, f)).toString("base64")}`, type] as const)
    writeFileSync(path.join(DIR, `512-${f}`), Buffer.from(b64, "base64"))
  }
  await page.context().close()
  return names
}

const dims = (f: string): [number, number] => {
  const b = readFileSync(path.join(DIR, f))
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)]
  for (let o = 2; o < b.length;) { // JPEG: the first SOF marker
    const m = b[o + 1] ?? 0, len = b.readUInt16BE(o + 2)
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)]
    o += 2 + len
  }
  return [0, 0]
}

const PAGE = (files: string[], layout: "full" | "compact") => `<!doctype html><html><body style="margin:0;background:#15161a;font:14px system-ui;color:#ccc">
<div id=col style="${layout === "full" ? "width:448px;height:860px;overflow-y:auto;margin:20px" : "display:grid;grid-template-columns:repeat(6,216px);gap:8px;padding:12px"}">
${files.map((f, i) => { const [w, h] = dims(f); return `<figure style="margin:0 0 ${layout === "full" ? 16 : 0}px">${layout === "compact" ? `<figcaption style="height:20px">alt ${i}</figcaption>` : ""}<img src="/${f}?n=${i}" width=${w} height=${h} loading=lazy decoding=async style="display:block;width:100%;height:${layout === "full" ? "auto" : "96px"};object-fit:cover"></figure>` }).join("\n")}
</div></body></html>`

// The browser's memory: the PSS of every headless_shell process, in MB.
function browserMb(): number {
  let kb = 0
  for (const pid of readdirSync("/proc").filter(d => /^\d+$/.test(d))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("headless_shell")) continue
      const m = /^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))
      kb += Number(m?.[1] ?? 0)
    } catch {}
  }
  return Math.round(kb / 1024)
}

const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => Math.round((s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0) * 10) / 10
  return { frames: s.length, p50: q(0.5), p95: q(0.95), max: q(1), over50: s.filter(x => x > 50).length }
}

const gen = await chromium.launch()
const names = await makeImages(gen)
await gen.close()
const bytes = (fs: string[]) => Math.round(fs.reduce((a, f) => a + statSync(path.join(DIR, f)).size, 0) / 1e5) / 10
log("images", { count: names.length, fittedMB: bytes(names), w512MB: bytes(names.map(f => `512-${f}`)), sizes: names.map(f => `${f} ${dims(f).join("x")} ${Math.round(statSync(path.join(DIR, f)).size / 1024)}KB`) })

let pageHtml = ""
const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x")
  if (u.pathname === "/") { res.setHeader("content-type", "text/html"); res.end(pageHtml); return }
  const f = path.join(DIR, path.basename(u.pathname))
  res.setHeader("content-type", f.endsWith(".jpg") ? "image/jpeg" : "image/png")
  res.end(readFileSync(f))
}).listen(0)
const port = (server.address() as { port: number }).port

for (const layout of ["full", "compact"] as const)
  for (const size of ["fitted", "512"] as const) {
    const files = size === "fitted" ? names : names.map(f => `512-${f}`)
    pageHtml = PAGE(files, layout)
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto("about:blank")
    await page.waitForTimeout(500)
    const blank = browserMb()
    await page.goto(`http://127.0.0.1:${port}/`)
    // Scroll the column through once, so every lazy image loads and decodes.
    let cold = null
    if (layout === "full") {
      // The first scroll, at 4x throttling, while each image loads and decodes.
      const cdp0 = await ctx.newCDPSession(page)
      await cdp0.send("Emulation.setCPUThrottlingRate", { rate: 4 })
      await page.evaluate(() => {
        const w = window as unknown as { __c: number[]; __con: boolean }
        w.__c = []; w.__con = true
        let last = performance.now()
        const tick = (t: number) => { if (!w.__con) return; w.__c.push(t - last); last = t; requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })
      await page.mouse.move(250, 400)
      for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(16) }
      cold = quantiles(await page.evaluate(() => { const w = window as unknown as { __c: number[]; __con: boolean }; w.__con = false; return w.__c.slice(1) }))
      await cdp0.send("Emulation.setCPUThrottlingRate", { rate: 1 })
      for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(30) }
    }
    const decodeMs = await page.evaluate(async () => {
      const t = performance.now()
      await Promise.all([...document.images].map(i => i.decode().catch(() => {})))
      return Math.round(performance.now() - t)
    })
    await page.waitForTimeout(1000)
    const loaded = browserMb()
    let scroll = null
    if (layout === "full") {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
      await page.evaluate(() => { const c = document.getElementById("col"); if (c) c.scrollTop = 0 })
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const w = window as unknown as { __d: number[]; __on: boolean }
        w.__d = []; w.__on = true
        let last = performance.now()
        const col = document.getElementById("col")
        const w2 = window as unknown as { __top: number[] }
        w2.__top = []
        const tick = (t: number) => { if (!w.__on) return; w.__d.push(t - last); w2.__top.push(col?.scrollTop ?? 0); last = t; requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })
      for (let i = 0; i < 120; i++) { await page.mouse.wheel(0, i < 60 ? 250 : -250); await page.waitForTimeout(16) }
      const d = await page.evaluate(() => { const w = window as unknown as { __d: number[]; __on: boolean }; w.__on = false; return w.__d.slice(1) })
      const tops = await page.evaluate(() => (window as unknown as { __top: number[] }).__top)
      scroll = { ...quantiles(d), scrollTopMax: Math.max(...tops), scrollTopDistinct: new Set(tops).size, columnHeight: await page.evaluate(() => document.getElementById("col")?.scrollHeight) }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }
    const after = browserMb()
    log(`${layout} ${size}`, { blankMB: blank, loadedMB: loaded, afterScrollMB: after, addedMB: loaded - blank, decodeAllMs: decodeMs, firstScrollAt4x: cold, scrollAt4x: scroll })
    await browser.close()
  }

// The cost of decoding one image, by kind and size, unthrottled.
{
  const browser = await chromium.launch()
  const page = await (await browser.newContext()).newPage()
  pageHtml = "<!doctype html><body></body>"
  await page.goto(`http://127.0.0.1:${port}/`)
  const per = await page.evaluate(async (fs: string[]) => {
    const r: Record<string, number> = {}
    for (const prefix of ["", "512-"]) for (const kind of ["screen", "photo", "art"]) {
      const mine = fs.filter(f => f.startsWith(kind))
      const blobs = await Promise.all(mine.map(f => fetch(`/${prefix}${f}`).then(x => x.blob())))
      const t = performance.now()
      for (const b of blobs) (await createImageBitmap(b)).close()
      r[`${prefix || "fitted "}${kind}`] = Math.round(((performance.now() - t) / blobs.length) * 10) / 10
    }
    return r
  }, names)
  log("decode ms per image (createImageBitmap, unthrottled)", per)
  await browser.close()
}
server.close()
writeFileSync(path.join(HERE, "output.json"), JSON.stringify(out, null, 1))
