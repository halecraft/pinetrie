// host/server — the entry point. `npm run host`
import { startHost } from "./index.ts"

const port = Number.parseInt(process.env.PINETA_PORT ?? "7391", 10)
const host = await startHost({
  port,
  provider: process.env.PINETA_PROVIDER ?? "cerebras",
  model: process.env.PINETA_MODEL ?? "qwen-3.8-27b",
})

console.log(`[host] listening   ${host.httpUrl}`)
console.log(`[host] websocket   ${host.wsUrl}`)
console.log(
  "[host] lanes       one per thread where agent work is wanted (ADR-0020)",
)
console.log("[host] open the http url in a browser, or run `pnpm run e2e`")

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("\n[host] shutting down")
    host.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}
