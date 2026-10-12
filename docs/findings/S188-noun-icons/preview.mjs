// node preview.mjs sheet.png out.png [px]: every icon of the sheet, named, at
// px CSS pixels (24, the column header's, by default) on the page's background,
// drawn as the page would: background-position into the sheet.
import fs from "node:fs"
import { chromium } from "/workspace/node_modules/.pnpm/playwright-core@1.56.0/node_modules/playwright-core/index.mjs"

const [sheet, out, size = "24"] = process.argv.slice(2)
const px = Number(size)
const nouns = Object.keys(
  JSON.parse(fs.readFileSync(new URL("prompts.json", import.meta.url))),
)
const src = `data:image/png;base64,${fs.readFileSync(sheet).toString("base64")}`
const cell = (n, i) =>
  `<div style="display:flex;align-items:center;gap:4px;width:${px + 64}px"><span style="flex:none;width:${px}px;height:${px}px;background:url(${src}) ${-(i % 16) * px}px ${-Math.floor(i / 16) * px}px/${16 * px}px ${16 * px}px;image-rendering:${px >= 64 ? "pixelated" : "auto"}"></span><span>${n}</span></div>`
const html = `<body style="margin:0;padding:8px;background:#1b1e24;color:#c9d1dc;font:11px sans-serif;display:grid;grid-template-columns:repeat(16,auto);gap:4px 6px;width:max-content">${nouns.map(cell).join("")}</body>`
const browser = await chromium.launch()
const page = await browser.newPage({
  deviceScaleFactor: 2,
  viewport: { width: 400, height: 300 },
})
await page.setContent(html)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
