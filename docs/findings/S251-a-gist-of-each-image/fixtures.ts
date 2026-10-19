// S251 fixtures: the images the gist probe sends. pine·trie's own page
// (a thread, the same thread with its image in the pane, the board), three
// generators' drawings of one noun scaled up, and a diagram. Run from
// apps/pinetrie/e2e/browser, copied in:
//   cp ../../../../docs/findings/S251-a-gist-of-each-image/fixtures.ts _fx.ts && node _fx.ts; rm _fx.ts
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { startSuiteHost, suiteModel } from "../harness.ts"
import { asPerson, col, launchBrowser, PANE_VIEWPORT, typeAfter } from "./page.ts"

const FINDINGS = path.resolve("../../../../docs/findings")
const OUT = path.join(FINDINGS, "S251-a-gist-of-each-image/images")
mkdirSync(OUT, { recursive: true })

const host = await startSuiteHost({ model: { kind: "scripted", script: suiteModel() }, log: () => {} })
const browser = await launchBrowser()
try {
  const ctx = await browser.newContext({ viewport: PANE_VIEWPORT })
  const p = await ctx.newPage()
  await asPerson(p, "pia@browser.test", "Pia")
  await p.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
  await p.click("#sidebar .add-canvas")
  const box = `${col(0)} .composer .input`
  await typeAfter(p, box, "Which of these icons reads best at 16 px? ")
  const sheet = readFileSync(path.join(FINDINGS, "S188-noun-icons/noun-icons.png")).toString("base64")
  await p.evaluate(([sel, b64]) => {
    const input = document.querySelector(sel) as HTMLTextAreaElement
    input.focus()
    const data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], "noun-icons.png", { type: "image/png" }))
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  }, [box, sheet] as const)
  await p.waitForFunction(sel => (document.querySelector(sel) as HTMLTextAreaElement).value.includes("/blob/"), box, { timeout: 15000 })
  await p.click(`${col(0)} .composer .send`)
  const img = `${col(0)} .msg img.blob-image`
  await p.waitForFunction(sel => { const i = document.querySelector(sel) as HTMLImageElement | null; return i?.complete && i.naturalWidth > 0 }, img, { timeout: 20000 })
  await p.waitForTimeout(2000)
  await p.screenshot({ path: path.join(OUT, "ui-thread.png") })
  await p.click(img)
  await p.waitForSelector(`${col(0)} > .pane img`, { timeout: 10000 })
  await p.waitForTimeout(1000)
  await p.screenshot({ path: path.join(OUT, "ui-thread-pane.png") })
  await p.keyboard.press("Escape")
  await p.click("#bottom .board-toggle, #bottom [aria-label='board']").catch(() => {})
  await p.waitForTimeout(1500)
  await p.screenshot({ path: path.join(OUT, "ui-board.png") })

  // One noun, three generators: alternatives a person would compare.
  const page = await (await browser.newContext({ viewport: { width: 512, height: 512 } })).newPage()
  for (const [tag, kind] of [["a", "pixen"], ["b", "pixen-described"], ["c", "pixen-icon"]] as const) {
    const b64 = readFileSync(path.join(FINDINGS, `S190-pixellab-icons/tiles/${kind}/anvil.png`)).toString("base64")
    await page.setContent(`<body style="margin:0;background:#fff"><img src="data:image/png;base64,${b64}" style="width:512px;height:512px;image-rendering:pixelated;display:block"></body>`)
    await page.waitForFunction(() => document.images[0]?.complete)
    await page.screenshot({ path: path.join(OUT, `art-anvil-${tag}.png`) })
  }
  // A diagram: boxes and arrows, as a design discussion would share.
  await page.setViewportSize({ width: 900, height: 420 })
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" font-family="system-ui" font-size="18">
    <rect width="900" height="420" fill="#fff"/>
    <defs><marker id="a" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z"/></marker></defs>
    <g fill="#eef3ff" stroke="#335">
      <rect x="30" y="60" width="200" height="80" rx="8"/><rect x="350" y="60" width="200" height="80" rx="8"/>
      <rect x="670" y="60" width="200" height="80" rx="8"/><rect x="350" y="280" width="200" height="80" rx="8"/></g>
    <g text-anchor="middle"><text x="130" y="106">Browser</text><text x="450" y="106">Host</text>
      <text x="770" y="106">Lane container</text><text x="450" y="326">Blob store</text></g>
    <g stroke="#335" stroke-width="2" marker-end="url(#a)">
      <line x1="230" y1="100" x2="348" y2="100"/><line x1="550" y1="100" x2="668" y2="100"/><line x1="450" y1="140" x2="450" y2="278"/></g>
    <g font-size="14" fill="#555" text-anchor="middle"><text x="290" y="90">WebSocket</text><text x="610" y="90">ssh</text><text x="500" y="215">POST /blob</text></g>
  </svg>`)
  await page.screenshot({ path: path.join(OUT, "diagram.png") })
} finally {
  await browser.close()
  await host.shutdown()
}
