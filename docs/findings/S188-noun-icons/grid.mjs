// node grid.mjs out.png noun-dir...: each noun's candidates in an 8×8 grid,
// numbered, at 2× pixelated on the page's background, two nouns a row.
import fs from "node:fs"
import path from "node:path"
import { chromium } from "/workspace/node_modules/.pnpm/playwright-core@1.56.0/node_modules/playwright-core/index.mjs"

const [out, ...dirs] = process.argv.slice(2)
let html = `<body style="margin:0;background:#1b1e24;color:#8a93a3;font:10px sans-serif;display:grid;grid-template-columns:repeat(2,auto);gap:14px;padding:6px;width:max-content">`
for (const dir of dirs) {
  html += `<div><div style="color:#9ecbff;font:bold 16px sans-serif;margin-bottom:2px">${path.basename(dir)}</div><div style="display:grid;grid-template-columns:repeat(8,68px);gap:1px">`
  for (const f of fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".png"))
    .sort()) {
    const src = `data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString("base64")}`
    html += `<div style="position:relative;width:68px;height:68px"><img src="${src}" style="width:64px;height:64px;image-rendering:pixelated;margin:2px"><span style="position:absolute;left:1px;top:0">${f.slice(0, 2)}</span></div>`
  }
  html += "</div></div>"
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
await page.setContent(html)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
