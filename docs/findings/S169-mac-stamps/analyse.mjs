#!/usr/bin/env node
// S169's answers, from results-lane.json and results-mac.json. Disposable.
//   node .plans/disk-model-probes/S169/analyse.mjs   → results-analysis.json
import { readJson, writeJson } from "./common.mjs"

const lane = readJson("results-lane.json")
const mac = readJson("results-mac.json")
if (lane === null || mac === null)
  throw new Error("both results files are needed")

const same = (a, b, k) => a !== null && b !== null && a[k] === b[k]
const quantiles = xs => {
  const s = [...xs].sort((a, b) => a - b)
  const q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))]
  return s.length === 0
    ? null
    : { n: s.length, min: s[0], median: q(0.5), p95: q(0.95), max: s.at(-1) }
}
const ms = (a, b) => Number(BigInt(a) - BigInt(b)) / 1e6

// 1. Do the two views give each file the same stamp, once both are quiet?
const files = Object.keys(lane.final).filter(
  f => f in mac.final && lane.final[f]?.kind === "file",
)
const agree = k =>
  files.filter(f => same(lane.final[f], mac.final[f], k)).length
const differs = files
  .filter(
    f =>
      !["ino", "size", "ctimeNs"].every(k =>
        same(lane.final[f], mac.final[f], k),
      ),
  )
  .slice(0, 10)
  .map(f => ({ file: f, lane: lane.final[f], mac: mac.final[f] }))

// 1b. Each write's stamp right after it, against the other side's final
// stamp, where nothing wrote the file after: by kind of write and by side.
const lastWrite = side => {
  const m = new Map()
  for (const w of side.writes) m.set(w.file, w)
  return m
}
const byOp = (writes, other) => {
  const out = {}
  for (const w of writes.values()) {
    const o = other[w.file] ?? null
    out[w.op] ??= { n: 0, ino: 0, size: 0, ctime: 0 }
    const r = out[w.op]
    r.n += 1
    if (same(w.stamp, o, "ino")) r.ino += 1
    if (same(w.stamp, o, "size")) r.size += 1
    if (same(w.stamp, o, "ctimeNs")) r.ctime += 1
  }
  return out
}

// 2. Clocks: ctime against each side's wall clock when it wrote.
const ctimeVsWriter = side =>
  quantiles(
    side.writes
      .filter(w => w.stamp !== null)
      .map(w => ms(w.stamp.ctimeNs, w.after.realNs)),
  )
// A lane's write as the Mac's watcher saw it: how long after, by the Mac's
// clock against the file's ctime; and whether the stamp it read was the lane's.
const laneByFile = lastWrite(lane)
const seen = mac.events.filter(
  e => e.file.startsWith("lane/") && e.stamp !== null,
)
const eventLag = quantiles(seen.map(e => ms(e.at.realNs, e.stamp.ctimeNs)))
const laneStamps = new Set(
  lane.writes
    .filter(w => w.stamp)
    .map(w => `${w.file}|${w.stamp.ino}|${w.stamp.size}|${w.stamp.ctimeNs}`),
)
const eventMatches = seen.filter(e =>
  laneStamps.has(`${e.file}|${e.stamp.ino}|${e.stamp.size}|${e.stamp.ctimeNs}`),
).length

// 2b. Does ctime keep each side's own order of its writes?
const ordered = side => {
  const ws = side.writes.filter(w => w.stamp !== null)
  let kept = 0
  for (let i = 1; i < ws.length; i++)
    if (BigInt(ws[i].stamp.ctimeNs) >= BigInt(ws[i - 1].stamp.ctimeNs))
      kept += 1
  return { pairs: ws.length - 1, kept }
}
// Two writes within a millisecond: told apart by ctime?
const fast = side => {
  const ws = side.writes.filter(w => w.op === "fast" && w.first && w.stamp)
  return {
    n: ws.length,
    ctimeDiffers: ws.filter(w => w.first.ctimeNs !== w.stamp.ctimeNs).length,
  }
}
// The two wall clocks: the lane's "go" seen against the Mac's.
const goOffsetMs = ms(lane.start.realNs, mac.start.realNs)

const answers = {
  views: {
    files: files.length,
    sameIno: agree("ino"),
    sameSize: agree("size"),
    sameCtime: agree("ctimeNs"),
    sameMtime: agree("mtimeNs"),
    examples: differs,
  },
  laneWriteVsMacFinal: byOp(laneByFile, mac.final),
  macWriteVsLaneFinal: byOp(lastWrite(mac), lane.final),
  clocks: {
    laneCtimeMinusLaneWallMs: ctimeVsWriter(lane),
    macCtimeMinusMacWallMs: ctimeVsWriter(mac),
    laneStartMinusMacGoMs: goOffsetMs,
    ctimeKeepsOrder: { lane: ordered(lane), mac: ordered(mac) },
    withinAMillisecond: { lane: fast(lane), mac: fast(mac) },
  },
  watcher: {
    events: mac.events.length,
    errors: mac.errors,
    laneEvents: seen.length,
    laneEventsWithALaneStamp: eventMatches,
    macWallMinusCtimeMs: eventLag,
  },
}
writeJson("results-analysis.json", answers)
console.log(JSON.stringify(answers, null, 1))
