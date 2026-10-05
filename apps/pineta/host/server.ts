// host/server — the entry point: `pnpm run host [folder]` serves the project
// at that folder's root (ADR-0086), and without one, Pineta's own repo. A
// relative folder is read from `INIT_CWD`, which pnpm sets to Pineta's root
// (S108). `pnpm run host` sets NODE_ENV=production, so Vite serves React's
// production build; `pnpm run host:react-dev` sets NODE_ENV=development, for
// React's warnings, render timeline and Fast Refresh (S59).
//
//   PINETA_PORT      the port (default 7391; 0 = any free port)
//   PINETA_BIND      the address (default 127.0.0.1: this machine only)
//   PINETA_KEY       the invite key off loopback (default: a fresh one)
//   PINETA_TOOLS=0   the agent has no tools. By default it reads, writes,
//                    edits and runs commands: each thread's agent in its own
//                    Linux container, on a disk cloned from where it branched,
//                    with the project read-only at /mnt/host-working-copy
//                    (ADR-0034), so hot reload stays on
//   PINETA_LANES=0   new threads' agents work directly in the project
//                    instead, as you, sharing it; while one runs, hot reload
//                    holds an update to a file it could be editing
//   PINETA_STORE     the SQLite file the session and pasted images are kept in
//                    (default .pineta/pineta.db in the project's root)
//   PINETA_PROVIDER, PINETA_MODEL
//                    override the model; by default, pi's settings' default,
//                    with the providers your pi extensions register
//
// A refused folder or argument prints why and exits 2, before anything opens.
// The first SIGINT or SIGTERM shuts the host down; a second ends the process.
import path from "node:path"
import { prepareProjectDir } from "@pineta/lanes"
import { startHost } from "./index.ts"
import {
  planInvocation,
  type Refusal,
  refusalText,
  storeFile,
} from "./invocation.ts"

const env = process.env
function refuse(refusal: Refusal): never {
  console.error(refusalText(refusal))
  process.exit(2)
}
const invocation = planInvocation(
  process.argv.slice(2),
  env.INIT_CWD ?? process.cwd(),
  path.resolve(import.meta.dirname, "../../.."),
)
if (invocation.kind === "refused") refuse(invocation.refusal)
const prepared = await prepareProjectDir(invocation.folder)
if (prepared.kind === "refused")
  refuse({ kind: "project", refusal: prepared.refusal })
const { root } = prepared
console.log(`[host] project     ${root}`)
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
  project: { dir: root, tools: env.PINETA_TOOLS !== "0" },
  lanes: env.PINETA_LANES !== "0",
  store: storeFile(root, env),
})

console.log(`[host] listening   ${host.httpUrl}`)
for (const invite of host.invites) console.log(`[host] open        ${invite}`)
console.log(
  "[host] lanes       one per thread where agent work is wanted (ADR-0020)",
)

const signals = ["SIGINT", "SIGTERM"] as const
// Once the listeners are off, Node's default action ends the process.
const stop = () => {
  for (const signal of signals) process.off(signal, stop)
  console.log("\n[host] shutting down")
  host.shutdown().then(
    () => process.exit(0),
    () => process.exit(1),
  )
}
for (const signal of signals) process.on(signal, stop)
