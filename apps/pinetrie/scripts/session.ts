// pnpm session rename <old> <new> — a session renamed, in the registry
// (`$XDG_DATA_HOME/pinetrie/sessions.json`), with its data and local config
// directories, while no host serves it. A refusal prints why and exits 2.

import { homedir } from "node:os"
import { configPlaces, sessionWords } from "@pinetrie/config"
import { renameSession } from "../host/sessions.ts"

const USAGE = "pnpm session rename <old> <new>"

const [verb, old, next, ...rest] = process.argv.slice(2)
if (
  verb !== "rename" ||
  old === undefined ||
  next === undefined ||
  rest.length > 0
) {
  console.error(USAGE)
  process.exit(2)
}
const { dirs } = configPlaces(process.env, homedir(), null)
const done = await renameSession(dirs, old, next)
if ("refused" in done) {
  console.error(sessionWords(done.refused))
  process.exit(2)
}
if (done.kind === "refused") {
  console.error(sessionWords(done.why))
  process.exit(2)
}
console.log(`Session ${done.from} is now ${done.to}.`)
