// host/server — what `pnpm dev`, `pnpm serve` and `pinetrie serve` share
// (`dev.ts`, `serve.ts`, `serve-built.ts`): `[folder]` serves the project at
// that folder's root, and without one, the folder the command started in.
// A relative folder is read from `INIT_CWD`, where pnpm was started, else
// the working directory.
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
//                    (default pinetrie.db in the session's data directory,
//                    $XDG_DATA_HOME/pinetrie/sessions/<name>/)
//   PINETRIE_MODEL     the model, as provider/id, over every config file's
//                    `model` (the config's env layer)
//   XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CONFIG_DIRS
//                    where pine·trie's config, credentials and the
//                    machine's file are (`@pinetrie/config`'s places)
//
// As it starts, the host draws its steps as a checklist, redrawn in place on
// a terminal, and prints above it the project, its session, the store, each
// config file it read and what it refused, and where its model came from, or
// why it has none and where the setup page is. It listens once lanes work.
//
// A refused folder, argument or session prints why and exits 2, before
// anything opens;
// a host with tools that cannot run its lanes prints why and exits 1.
// The first SIGINT or SIGTERM shuts the host down; a second ends the process.

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import {
  configPlaces,
  registryWaitWords,
  sessionLockLostWords,
  sessionWords,
} from "@pinetrie/config"
import { prepareProjectDir } from "@pinetrie/jj"
import { sessionFiles } from "@pinetrie/lanes"
import { bindAgentDir } from "@pinetrie/pi"
import { HostRefused } from "./host-refused.ts"
import { startHost } from "./index.ts"
import {
  type HostCommand,
  planInvocation,
  type Refusal,
  refusalText,
  storeChoice,
} from "./invocation.ts"
import type { PageSource } from "./page.ts"
import { replaceFileSync } from "./replace-file.ts"
import { openSession } from "./sessions.ts"
import {
  decodeStartTimes,
  encodeStartTimes,
  laneMachine,
  planStartSteps,
} from "./start-checklist.ts"
import { startProgress } from "./start-terminal.ts"
import {
  listeningLine,
  openLine,
  projectLine,
  sessionLines,
  setupLine,
  storeLine,
} from "./startup-lines.ts"

/**
 * Start a host for `command` with its arguments, `args`, its page from
 * `page`, which runs once the invocation is accepted, before anything opens.
 * Runs until a signal.
 */
export async function runHost(
  command: HostCommand,
  args: readonly string[],
  page: () => Promise<PageSource>,
): Promise<void> {
  const env = process.env
  function refuse(refusal: Refusal): never {
    console.error(refusalText(refusal, command))
    process.exit(2)
  }
  const invocation = planInvocation(args, env.INIT_CWD ?? process.cwd())
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
    onWaiting: holder =>
      console.log(`[host] ${registryWaitWords(holder?.saidPid ?? null)}`),
  })
  if ("refused" in opened) {
    console.error(`[host] ${sessionWords(opened.refused)}`)
    process.exit(2)
  }
  const files = sessionFiles(opened.dir)
  const store = storeChoice(files.store, env)
  const tools = env.PINETRIE_TOOLS !== "0"
  const progress = startProgress(
    { out: process.stdout, err: process.stderr, isTTY: process.stdout.isTTY },
    {
      steps: planStartSteps({ tools }),
      machine: laneMachine(process.platform),
      times: decodeStartTimes(
        await readFile(files.startTimes, "utf8").catch(() => null),
      ),
      save: times => replaceFileSync(files.startTimes, encodeStartTimes(times)),
    },
  )
  const log = (line: string) => progress.log(line)
  log(projectLine(root))
  for (const l of sessionLines(opened.plan, home)) log(l)
  log(storeLine(store))
  const places = configPlaces(env, home, opened.name)
  const host = await startHost({
    port: Number.parseInt(env.PINETRIE_PORT ?? "7391", 10),
    bind: env.PINETRIE_BIND ?? "127.0.0.1",
    ...(env.PINETRIE_KEY === undefined ? {} : { key: env.PINETRIE_KEY }),
    model: { kind: "configured" },
    places,
    // Before pi loads anything: an extension finds its own config through it.
    binding: bindAgentDir(places.dirs.config),
    project: tools
      ? { dir: root, tools: true, files: files.lanes }
      : { dir: root, tools: false },
    served: { name: opened.name, path: opened.path },
    store: store.file,
    page: await page(),
    log,
    progress,
  }).catch(async error => {
    await opened.releaseLock()
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
  // Once the listeners are off, Node's default action ends the process. A
  // lost lock may follow a signal: one shutdown either way.
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    for (const signal of signals) process.off(signal, stop)
    console.log("\n[host] shutting down")
    host
      .shutdown()
      .then(() => opened.releaseLock())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      )
  }
  for (const signal of signals) process.on(signal, stop)
  // A lock gone from under the host would let a rename move its session.
  void opened.lockLost.then(() => {
    console.error(`[host] ${sessionLockLostWords(opened.name)}`)
    stop()
  })
}
