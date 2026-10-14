// host/server — the entry point: `pnpm run host [folder]` serves the project at
// that folder's root, and without one, pinetrie's own repo. A relative folder
// is read from `INIT_CWD`, which pnpm sets to pinetrie's root. `pnpm run host`
// sets NODE_ENV=production, so Vite serves React's production build;
// `pnpm run host:react-dev` sets NODE_ENV=development, for React's warnings,
// render timeline and Fast Refresh.
//
//   PINETRIE_PORT      the port (default 7391; 0 = any free port)
//   PINETRIE_BIND      the address (default 127.0.0.1: this machine only)
//   PINETRIE_KEY       the invite key off loopback (default: a fresh one)
//   PINETRIE_TOOLS=0   the agent has no tools. By default it reads, writes,
//                    edits and runs commands: each thread's agent in its own
//                    Linux container, on a disk cloned from where it branched,
//                    with the project read-only at /mnt/host-working-copy.
//                    Then the folder must be a jj repo,
//                    and Docker must run lanes: the lane VM on the Mac
//   PINETRIE_STORE     the SQLite file the session and pasted images are kept in
//                    (default .pinetrie/pinetrie.db in the project's root)
//   PINETRIE_PROVIDER, PINETRIE_MODEL
//                    override the model; by default, the default in pi's
//                    settings (the project's .pi/settings.json over
//                    ~/.pi/agent/settings.json), with the providers your pi
//                    extensions register
//
// As it starts, the host prints the project, the store, the user config it
// read, and where its model came from.
//
// A refused folder or argument prints why and exits 2, before anything opens;
// a host with tools that cannot run its lanes prints why and exits 1.
// The first SIGINT or SIGTERM shuts the host down; a second ends the process.
import path from "node:path"
import { prepareProjectDir } from "@pinetrie/jj"
import { HostRefused, startHost } from "./index.ts"
import {
  planInvocation,
  type Refusal,
  refusalText,
  storeChoice,
} from "./invocation.ts"
import {
  listeningLine,
  openLine,
  projectLine,
  storeLine,
} from "./startup-lines.ts"

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
const store = storeChoice(root, env)
console.log(projectLine(root))
console.log(storeLine(store))
const host = await startHost({
  port: Number.parseInt(env.PINETRIE_PORT ?? "7391", 10),
  bind: env.PINETRIE_BIND ?? "127.0.0.1",
  ...(env.PINETRIE_KEY === undefined ? {} : { key: env.PINETRIE_KEY }),
  model: {
    kind: "configured",
    ...(env.PINETRIE_PROVIDER === undefined
      ? {}
      : { provider: env.PINETRIE_PROVIDER }),
    ...(env.PINETRIE_MODEL === undefined ? {} : { model: env.PINETRIE_MODEL }),
  },
  project: { dir: root, tools: env.PINETRIE_TOOLS !== "0" },
  store: store.file,
}).catch(error => {
  // Lanes cannot run here: the words say how to fix it.
  if (error instanceof HostRefused) {
    console.error(`[host] lanes cannot start: ${error.message}`)
    process.exit(1)
  }
  throw error
})

console.log(listeningLine(host.httpUrl))
for (const invite of host.invites) console.log(openLine(invite))

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
