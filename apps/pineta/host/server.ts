// host/server — the entry point. `pnpm run host`
//
//   PINETA_PORT      the port (default 7391; 0 = any free port)
//   PINETA_BIND      the address (default 127.0.0.1: this machine only)
//   PINETA_KEY       the invite key off loopback (default: a fresh one)
//   PINETA_TOOLS=0   the agent has no tools. By default it reads, writes,
//                    edits and runs commands: each thread's agent in its own
//                    Linux container, on a disk cloned from where it branched,
//                    with this repo read-only at /mnt/host-working-copy (ADR-0034), so hot
//                    reload stays on
//   PINETA_LANES=0   new threads' agents work directly in this repo instead,
//                    as you, sharing it; hot reload waits while one runs
//   PINETA_STORE     the SQLite file the session is kept in
//                    (default .pineta/pineta.db in the repo)
//   PINETA_PROVIDER, PINETA_MODEL
//                    override the model; by default, pi's settings' default,
//                    with the providers your pi extensions register
import path from "node:path"
import { startHost } from "./index.ts"

const repo = path.resolve(import.meta.dirname, "../../..")
const env = process.env
const tools = env.PINETA_TOOLS === "0" ? null : { project: repo }
const host = await startHost({
  port: Number.parseInt(env.PINETA_PORT ?? "7391", 10),
  bind: env.PINETA_BIND ?? "127.0.0.1",
  ...(env.PINETA_KEY === undefined ? {} : { key: env.PINETA_KEY }),
  model: {
    kind: "configured",
    ...(env.PINETA_PROVIDER === undefined
      ? {}
      : { provider: env.PINETA_PROVIDER }),
    ...(env.PINETA_MODEL === undefined ? {} : { model: env.PINETA_MODEL }),
  },
  tools,
  lanes: env.PINETA_LANES !== "0",
  store: env.PINETA_STORE ?? path.join(repo, ".pineta", "pineta.db"),
})

console.log(`[host] listening   ${host.httpUrl}`)
for (const invite of host.invites) console.log(`[host] open        ${invite}`)
console.log(
  "[host] lanes       one per thread where agent work is wanted (ADR-0020)",
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("\n[host] shutting down")
    host.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}
