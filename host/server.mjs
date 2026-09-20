// host/server — the entry point. `npm run host`
import { startHost } from "./index.mjs"

const port = Number.parseInt(process.env.PINETA_PORT ?? "7391", 10)
const host = await startHost({
  port,
  provider: process.env.PINETA_PROVIDER ?? "cerebras",
  model: process.env.PINETA_MODEL ?? "qwen-3.8-27b",
})

console.log(`[host] listening   ${host.httpUrl}`)
console.log(`[host] websocket   ${host.wsUrl}`)
console.log(`[host] lane        ${host.laneName}`)
console.log("[host] open the http url in a browser, or run `npm run e2e`")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\n[host] shutting down")
    host.shutdown().then(() => process.exit(0), () => process.exit(1))
  })
}
