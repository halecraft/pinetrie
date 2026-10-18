import { chromium } from "/workspace/apps/pinetrie/node_modules/@playwright/test/index.mjs"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } })
for (const h of ["3.6rem", "4.1rem"]) {
  await page.goto(`file:///tmp/spk/compact.html?h=${h}`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `/tmp/spk/s241-${h}.png`, fullPage: true })
  const m = await page.evaluate(() => {
    const out = {}
    for (const mode of ["a","b"]) {
      const cs = [...document.querySelectorAll(`.compact.${mode}`)]
      out[mode] = cs.map(c => {
        const b = c.getBoundingClientRect()
        const body = [...c.children].slice(1)
        const overflow = c.scrollHeight > c.clientHeight + 1
        const headWrap = c.firstElementChild.getBoundingClientRect().height
        return { kind: c.dataset.kind, w: +b.width.toFixed(1), h: +b.height.toFixed(1), overflow, head: +headWrap.toFixed(1),
          bodyBottom: Math.round(Math.max(...body.map(e => e.getBoundingClientRect().bottom)) - b.top) }
      })
    }
    // characters per line: measure an average latin line
    const probe = document.createElement("div"); probe.className = "compact a"; probe.style.cssText = "position:absolute;visibility:hidden;width:var(--compact-w)"
    probe.innerHTML = '<div class="lead" style="white-space:nowrap;display:inline-block"></div>'; document.body.append(probe)
    const lead = probe.firstChild; const inner = probe.getBoundingClientRect().width - 0.9*16 - 2
    const s = "the quick brown fox jumps over the lazy dog and keeps running past the "
    let n = 0; for (; n < s.length; n++) { lead.textContent = s.slice(0, n); if (lead.getBoundingClientRect().width > inner) break }
    out.charsPerLine = n - 1
    out.compactW = getComputedStyle(document.documentElement).getPropertyValue("--compact-w")
    out.bagH = document.querySelector(".bag").getBoundingClientRect().height
    return out
  })
  console.log(h, JSON.stringify({ chars: m.charsPerLine, bagHeightFor12px: m.bagH, a: m.a.map(x => [x.kind, x.w, x.h, x.overflow, x.bodyBottom]), b: m.b.map(x => [x.kind, x.h, x.overflow, x.bodyBottom]) }))
}
await browser.close()
