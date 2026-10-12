#!/usr/bin/env node
// S169, in a lane. Disposable.
//   node .plans/disk-model-probes/S169/lane.mjs
// Run once mac.mjs is waiting on the Mac. Waits (up to 20 min) for its scratch/go, writes the load under
// scratch/lane/, then says scratch/lane-done. Then waits for the Mac's
// scratch/mac-done and stats every file under scratch/ from the lane:
// results-lane.json.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  clocks,
  SCRATCH,
  scanAll,
  waitFor,
  writeJson,
  writeLoad,
} from "./common.mjs"

console.log("waiting for the Mac's scratch/go …")
await waitFor("go", 20)
const writes = []
const start = clocks()
await writeLoad(path.join(SCRATCH, "lane"), w => writes.push(w))
fs.writeFileSync(path.join(SCRATCH, "lane-done"), JSON.stringify(clocks()))
console.log(`wrote ${writes.length}; waiting for the Mac's scratch/mac-done …`)
await waitFor("mac-done", 20)
writeJson("results-lane.json", {
  host: os.hostname(),
  platform: `${os.platform()} ${os.release()}`,
  start,
  writes,
  final: scanAll(),
  at: clocks(),
})
console.log("results-lane.json written")
