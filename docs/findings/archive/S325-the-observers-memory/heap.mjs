// The observer server's heap after a forced collection, read through its
// inspector: run inside the role's container (`docker exec`), it opens the
// server's inspector by SIGUSR1, collects garbage, prints
// process.memoryUsage() and V8's heap limit, and closes the inspector again.
import { readdirSync, readFileSync } from "node:fs"

const server = readdirSync("/proc").find(p => {
  try { return /observer-server/.test(readFileSync(`/proc/${p}/cmdline`, "utf8")) } catch { return false }
})
process.kill(Number(server), "SIGUSR1")
let list
for (let i = 0; i < 50 && list === undefined; i++) {
  await new Promise(r => setTimeout(r, 100))
  list = await fetch("http://127.0.0.1:9229/json/list").then(r => r.json()).catch(() => undefined)
}
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener("open", r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data)
  pending.get(m.id)?.(m)
})
const send = (method, params = {}) =>
  new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
const usage = async () => JSON.parse((await send("Runtime.evaluate", { expression: "JSON.stringify({ ...process.memoryUsage(), heapLimit: process.getBuiltinModule('node:v8').getHeapStatistics().heap_size_limit })" })).result.result.value)
const before = await usage()
await send("HeapProfiler.collectGarbage")
const after = await usage()
const mb = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / 1e6).toFixed(1)]))
console.log(`server pid ${server} before gc ${JSON.stringify(mb(before))}`)
console.log(`server pid ${server} after gc  ${JSON.stringify(mb(after))}`)
await send("Runtime.evaluate", { expression: "process.getBuiltinModule('node:inspector').close()" }).catch(() => {})
ws.close()
process.exit(0)
