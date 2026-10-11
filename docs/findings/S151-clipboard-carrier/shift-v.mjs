import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"

const require = createRequire(
  new URL("../../../apps/pinetrie/package.json", import.meta.url),
)
const { chromium, firefox, webkit } = require("@playwright/test")
const html = readFileSync(new URL("probe.html", import.meta.url))
const server = createServer((_, r) => {
  r.writeHead(200, { "content-type": "text/html" })
  r.end(html)
})
await new Promise(r => server.listen(0, "127.0.0.1", r))
const url = `http://127.0.0.1:${server.address().port}/`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = {}
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const b = await type.launch({ headless: false })
  const p = await (await b.newContext()).newPage()
  await p.goto(url)
  await p.evaluate(() => {
    window.nonce = "shift"
    document.getElementById("card").focus()
  })
  await p.keyboard.press("Control+c")
  await sleep(300)
  const res = {}
  for (const combo of ["Control+Shift+v", "Control+Alt+Shift+v"]) {
    for (const where of ["card", "box"]) {
      await p.evaluate(w => {
        const b = document.getElementById("box")
        b.value = ""
        document.getElementById(w).focus()
      }, where)
      const n = await p.evaluate(() => window.log.length)
      await p.keyboard.press(combo)
      await sleep(300)
      const log = await p.evaluate(n => window.log.slice(n), n)
      const paste = log.find(e => e.ev === "paste")
      res[`${combo} on ${where}`] = paste
        ? {
            types: paste.types,
            box: await p.evaluate(() => document.getElementById("box").value),
          }
        : "no paste event"
    }
  }
  out[name] = res
  await b.close()
}
server.close()
console.log(JSON.stringify(out, null, 1))
