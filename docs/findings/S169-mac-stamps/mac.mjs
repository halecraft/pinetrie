#!/usr/bin/env node
// S169, on the Mac. Disposable.
//   node .plans/disk-model-probes/S169/mac.mjs
// Run it from your working copy first, then tell the lane's agent to run
// lane.mjs: this waits up to an hour for it. It:
// - watches scratch/ with @parcel/watcher (FSEvents), as the host would, and
//   stats each file an event names when the event arrives;
// - says scratch/go, so the lane writes its load, and writes the same load
//   of its own under scratch/mac/;
// - once the lane says scratch/lane-done, waits 10 s for the last events,
//   stats every file under scratch/ from the Mac, writes results-mac.json and
//   says scratch/mac-done.
// @parcel/watcher installs into a temporary folder, never into the repo.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import {
  clocks,
  SCRATCH,
  scanAll,
  stampOf,
  waitFor,
  writeJson,
  writeLoad,
} from "./common.mjs"

const DEPS = path.join(os.tmpdir(), "s169-deps")
function watcherModule() {
  const req = createRequire(path.join(DEPS, "x.js"))
  try {
    return req("@parcel/watcher")
  } catch {
    fs.mkdirSync(DEPS, { recursive: true })
    const r = spawnSync(
      "npm",
      ["install", "--no-save", "--prefix", DEPS, "@parcel/watcher@2.6.0"],
      { stdio: "inherit" },
    )
    if (r.status !== 0) throw new Error("npm install failed")
    return req("@parcel/watcher")
  }
}

fs.rmSync(SCRATCH, { recursive: true, force: true })
fs.mkdirSync(SCRATCH, { recursive: true })
const events = []
const errors = []
const sub = await watcherModule().subscribe(SCRATCH, (error, batch) => {
  const at = clocks()
  if (error) errors.push({ at, error: String(error) })
  for (const e of batch ?? [])
    events.push({
      at,
      type: e.type,
      file: path.relative(SCRATCH, e.path),
      stamp: stampOf(e.path),
    })
})
const start = clocks()
fs.writeFileSync(path.join(SCRATCH, "go"), JSON.stringify(start))
console.log("go: the lane writes now; writing the Mac's load too …")
const writes = []
await writeLoad(
  path.join(SCRATCH, "mac"),
  w => writes.push(w),
  () => new Promise(r => setTimeout(r, 300)),
)
console.log(
  "now tell the lane's agent to run lane.mjs; waiting up to an hour for scratch/lane-done …",
)
await waitFor("lane-done", 60)
await new Promise(r => setTimeout(r, 10_000))
await sub.unsubscribe()
writeJson("results-mac.json", {
  platform: `${os.platform()} ${os.release()}`,
  start,
  writes,
  events,
  errors,
  final: scanAll(),
  at: clocks(),
})
fs.writeFileSync(path.join(SCRATCH, "mac-done"), JSON.stringify(clocks()))
console.log(
  `results-mac.json written: ${events.length} events, ${errors.length} errors`,
)
