// host/server — what `pnpm dev` and `pnpm serve` share (`dev.ts`,
// `serve.ts`): `[folder]` serves the project at that folder's root, and
// without one, pinetrie's own repo. A relative folder is read from
// `INIT_CWD`, which pnpm sets to pinetrie's root.
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
//   PINETRIE_SESSION   the session to serve the folder as, by name: a moved
//                    folder's, attached to it again (default: the folder's
//                    own, found by its real path, or a new one)
//   PINETRIE_STORE     the SQLite file the session and pasted images are kept in
//                    (default .pinetrie/pinetrie.db in the project's root)
//   PINETRIE_MODEL     the model, as provider/id, over every config file's
//                    `model` (the config's env layer)
//   XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CONFIG_DIRS
//                    where pine·trie's config, credentials and the
//                    machine's file are (`@pinetrie/config`'s places)
//
// As it starts, the host prints the project, its session, the store, each config file it
// read and what it refused, and where its model came from, or why it has
// none and where the setup page is.
//
// A refused folder, argument or session prints why and exits 2, before
// anything opens;
// a host with tools that cannot run its lanes prints why and exits 1.
// The first SIGINT or SIGTERM shuts the host down; a second ends the process.
import { homedir } from "node:os"
import path from "node:path"
import { configPlaces, sessionWords } from "@pinetrie/config"
import { prepareProjectDir } from "@pinetrie/jj"
import { bindAgentDir } from "@pinetrie/pi"
import { HostRefused, startHost } from "./index.ts"
import {
  type HostCommand,
  planInvocation,
  type Refusal,
  refusalText,
  storeChoice,
} from "./invocation.ts"
import type { PageSource } from "./page.ts"
import { openSession } from "./sessions.ts"
import {
  listeningLine,
  openLine,
  projectLine,
  sessionLines,
  setupLine,
  storeLine,
} from "./startup-lines.ts"

/**
 * Start a host for `command`, its page from `page`, which runs once the
 * invocation is accepted, before anything opens. Runs until a signal.
 */
export async function runHost(
  command: HostCommand,
  page: () => Promise<PageSource>,
): Promise<void> {
  const env = process.env
  function refuse(refusal: Refusal): never {
    console.error(refusalText(refusal, command))
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
  const home = homedir()
  const opened = await openSession({
    root,
    env,
    dirs: configPlaces(env, home, null).dirs,
  })
  if ("refused" in opened) {
    console.error(`[host] ${sessionWords(opened.refused)}`)
    process.exit(2)
  }
  const store = storeChoice(root, env)
  console.log(projectLine(root))
  for (const l of sessionLines(opened.plan, home, command)) console.log(l)
  console.log(storeLine(store))
  const places = configPlaces(env, home, opened.name)
  const host = await startHost({
    port: Number.parseInt(env.PINETRIE_PORT ?? "7391", 10),
    bind: env.PINETRIE_BIND ?? "127.0.0.1",
    ...(env.PINETRIE_KEY === undefined ? {} : { key: env.PINETRIE_KEY }),
    model: { kind: "configured" },
    places,
    // Before pi loads anything: an extension finds its own config through it.
    binding: bindAgentDir(places.dirs.config),
    project: { dir: root, tools: env.PINETRIE_TOOLS !== "0" },
    served: { name: opened.name, path: opened.path },
    store: store.file,
    page: await page(),
  }).catch(async error => {
    await opened.release()
    // Lanes cannot run here: the words say how to fix it.
    if (error instanceof HostRefused) {
      console.error(`[host] lanes cannot start: ${error.message}`)
      process.exit(1)
    }
    throw error
  })

  console.log(listeningLine(host.httpUrl))
  if (host.model.kind === "none") console.log(setupLine(host.httpUrl))
  for (const invite of host.invites) console.log(openLine(invite))

  const signals = ["SIGINT", "SIGTERM"] as const
  // Once the listeners are off, Node's default action ends the process.
  const stop = () => {
    for (const signal of signals) process.off(signal, stop)
    console.log("\n[host] shutting down")
    host
      .shutdown()
      .then(() => opened.release())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      )
  }
  for (const signal of signals) process.on(signal, stop)
}
