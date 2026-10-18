import { chromium } from "/workspace/apps/pinetrie/node_modules/@playwright/test/index.mjs"
const browser = await chromium.launch()
console.log("chromium", browser.version())
for (const how of ["A", "B", "C"]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto("file:///tmp/spk/motion.html")
  if (how === "A") console.log(await page.evaluate(() => window.supports))
  await page.evaluate(h => window.run(h), how)
  await page.waitForTimeout(800)
  const r = await page.evaluate(h => ({ last: window["last" + h], frames: window.frames ?? null }), how)
  const fr = await page.evaluate(() => JSON.parse(JSON.stringify(window.__f ?? null)))
  const all = await page.evaluate(() => { return (typeof frames !== "undefined") ? frames : [] })
  const fly = all.filter(f => f.label === how), pan = all.filter(f => f.label === "panel")
  const first = fly[0], last = fly.at(-1)
  console.log(how, "measured to", r.last.to.map(Math.round), "from", r.last.from.map(Math.round))
  console.log(how, "first frame", first, "error vs from:", first && [first.x - Math.round(r.last.from[0]), first.y - Math.round(r.last.from[1])])
  console.log(how, "last frame", last, "slot settled at", await page.evaluate(() => window.slotFinal()))
  console.log(how, "panel frames", pan.slice(0, 4).map(f => `${f.t}ms w${f.w}`).join(" "), "…", pan.at(-1) && `${pan.at(-1).t}ms w${pan.at(-1).w}`)
  if (how === "C") {
    await page.evaluate(() => window.close())
    await page.waitForTimeout(500)
    const cl = await page.evaluate(() => frames)
    console.log("close frames", cl.slice(0, 6).map(f => `${f.t}ms w${f.w}`).join(" "), "…", cl.at(-1) && `${cl.at(-1).t}ms w${cl.at(-1).w}`)
    console.log("display after close", await page.evaluate(() => getComputedStyle(document.getElementById("panel")).display))
  }
  await page.close()
}
await browser.close()
