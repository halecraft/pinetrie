// S299's browser check: the tether's page at a mesh address, and the same
// page at a localhost origin through the forwarder.
import { chromium } from "playwright-core"
const browser = await chromium.launch({ headless: true, args: ["--proxy-server=socks5://127.0.0.1:1055", "--proxy-bypass-list=<-loopback>"] })
const page = await browser.newPage()
const check = async (url: string) => {
  const res = await page.goto(url, { timeout: 20_000 })
  const body = await page.textContent("body")
  const facts = await page.evaluate(async (u) => {
    const ws = await new Promise<string>(resolve => {
      const s = new WebSocket(u.replace("http", "ws"))
      s.onmessage = m => { resolve(`opened, first frame ${typeof m.data === "string" ? JSON.stringify(m.data) : "binary"}`); s.close() }
      s.onerror = () => resolve("error")
      setTimeout(() => resolve("timeout"), 8000)
    })
    return { isSecureContext, webLocks: "locks" in navigator, ws }
  }, url)
  console.log(JSON.stringify({ url, status: res?.status(), body, ...facts }))
}
await check("http://100.64.0.1:7000/")
await check("http://localhost:9000/")
await browser.close()
