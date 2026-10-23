// session rename <old> <new> — a session renamed, in the registry
// (`$XDG_DATA_HOME/pinetrie/sessions.json`), with its data and local config
// directories, while no host serves it. A refusal prints why and exits 2.

import { homedir } from "node:os"
import { configPlaces, registryWaitWords, sessionWords } from "@pinetrie/config"
import { renameSession } from "../host/sessions.ts"

const USAGE = "usage: pinetrie session rename <old> <new>"

/** `session rename <old> <new>`: its exit code. */
export async function main(args: readonly string[]): Promise<number> {
  const [verb, old, next, ...rest] = args
  if (
    verb !== "rename" ||
    old === undefined ||
    next === undefined ||
    rest.length > 0
  ) {
    console.error(USAGE)
    return 2
  }
  const { dirs } = configPlaces(process.env, homedir(), null)
  const done = await renameSession(dirs, old, next, holder =>
    console.error(registryWaitWords(holder?.saidPid ?? null)),
  )
  if ("refused" in done) {
    console.error(sessionWords(done.refused))
    return 2
  }
  if (done.kind === "refused") {
    console.error(sessionWords(done.why))
    return 2
  }
  console.log(`Session ${done.from} is now ${done.to}.`)
  return 0
}
