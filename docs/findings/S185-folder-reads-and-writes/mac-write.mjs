// S185's Mac half: an accept's staged, checked writes into an APFS folder;
// what @parcel/watcher reports of them; and a writer that races a lane's read.
// Run on the Mac from pine·trie's repo root, with its node_modules installed:
//   node docs/findings/S185-folder-reads-and-writes/mac-write.mjs all
//       questions 3, 4 and 5, in a fresh folder under $HOME; writes
//       results-mac-<time>.json beside itself, and removes the folder
//   node docs/findings/S185-folder-reads-and-writes/mac-write.mjs torn <dir> <seconds>
//       question 2's writer: rewrites files in <dir> in place, same size,
//       while a lane runs `vm-read.py --torn` on the same folder
import { fork } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const here = path.dirname(new URL(import.meta.url).pathname)
const repo = path.resolve(here, "../../..")
const STAGE = ".pinetrie-stage-"
const now = () => process.hrtime.bigint()
const us = (a, b) => Number(b - a) / 1000
const stamp = p => {
  try {
    const s = fs.lstatSync(p, { bigint: true })
    return `${s.size}:${s.ctimeNs}`
  } catch {
    return null
  }
}
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1)
}

/** An accept's write of one path: staged, checked, renamed; or refused. */
function checkedWrite(dir, name, data, expected, sync) {
  const target = path.join(dir, name)
  const staged = path.join(dir, `${STAGE}${name}`)
  const fd = fs.openSync(staged, "w")
  fs.writeSync(fd, data)
  if (sync) fs.fsyncSync(fd)
  fs.closeSync(fd)
  const t0 = now()
  if (stamp(target) !== expected) {
    fs.unlinkSync(staged)
    return { written: false }
  }
  fs.renameSync(staged, target)
  const t1 = now()
  return { written: true, t0, t1, after: stamp(target) }
}

function timing(dir) {
  const out = {}
  for (const sync of [false, true]) {
    const files = 1000
    const t = now()
    for (let i = 0; i < files; i++)
      checkedWrite(
        dir,
        `small-${i}.txt`,
        Buffer.alloc(4096, i % 256),
        stamp(path.join(dir, `small-${i}.txt`)),
        sync,
      )
    out[sync ? "fsync" : "noFsync"] = {
      files,
      msPerFile: +(us(t, now()) / 1000 / files).toFixed(3),
    }
  }
  const big = Buffer.alloc(1 << 30, 7)
  for (const sync of [false, true]) {
    const t = now()
    checkedWrite(dir, "big.bin", big, stamp(path.join(dir, "big.bin")), sync)
    out[sync ? "fsync" : "noFsync"].oneGiBms = Math.round(us(t, now()) / 1000)
  }
  return out
}

/** A writer saving the target as fast as it can, while checked writes run. */
async function race(dir, mode) {
  const target = path.join(dir, `race-${mode}.txt`)
  fs.writeFileSync(target, "0".repeat(64))
  const child = fork(new URL(import.meta.url).pathname, ["racer", target, mode])
  await new Promise(r => child.once("message", r))
  const windows = []
  let refused = 0
  const attempts = 5000
  for (let i = 0; i < attempts; i++) {
    const read = stamp(target)
    const r = checkedWrite(
      dir,
      path.basename(target),
      "a".repeat(64),
      read,
      false,
    )
    if (r.written) windows.push([r.t0, r.t1])
    else refused++
  }
  child.send("stop")
  const writes = await new Promise(r => child.once("message", r))
  // A writer's save that began inside a check-to-rename window and was
  // not refused: lost, with nothing seen.
  let unseen = 0
  const starts = writes.map(BigInt).sort((a, b) => (a < b ? -1 : 1))
  for (const [a, b] of windows) if (starts.some(s => s >= a && s <= b)) unseen++
  return {
    mode,
    attempts,
    refused,
    written: windows.length,
    writerSaves: writes.length,
    writerSavesInsideAWindow: unseen,
    windowUs: {
      p50: pct(
        windows.map(([a, b]) => us(a, b)),
        0.5,
      ),
      p99: pct(
        windows.map(([a, b]) => us(a, b)),
        0.99,
      ),
    },
  }
}

function racer(target, mode) {
  let go = true
  const writes = []
  process.on("message", () => {
    go = false
  })
  process.send("ready")
  const tick = () => {
    for (let k = 0; k < 50 && go; k++) {
      const s = now()
      if (mode === "rename") {
        fs.writeFileSync(`${target}.app-tmp`, "w".repeat(64))
        fs.renameSync(`${target}.app-tmp`, target)
      } else fs.writeFileSync(target, "w".repeat(64))
      writes.push(String(s))
    }
    if (go) setImmediate(tick)
    else process.send(writes, () => process.exit(0))
  }
  tick()
}

function names(dir) {
  const out = {}
  const cases = [
    ["case", "foo.txt", "Foo.txt"],
    ["unicode form", "caf\u00e9.txt", "cafe\u0301.txt"],
  ]
  for (const [label, there, incoming] of cases) {
    const d = fs.mkdtempSync(path.join(dir, "names-"))
    fs.writeFileSync(path.join(d, there), "theirs\n")
    const seen = stamp(path.join(d, incoming))
    const refused = !checkedWrite(d, incoming, "incoming\n", null, false)
      .written
    const forced = (() => {
      fs.writeFileSync(path.join(d, `${STAGE}x`), "forced\n")
      fs.renameSync(path.join(d, `${STAGE}x`), path.join(d, incoming))
      return fs
        .readdirSync(d)
        .map(n => [n, fs.readFileSync(path.join(d, n), "utf8").trim()])
    })()
    out[label] = {
      there,
      incoming,
      incomingLooksPresent: seen !== null,
      checkedWriteRefused: refused,
      renameAnywayLeaves: forced,
    }
  }
  return out
}

async function echo(dir) {
  const require = createRequire(path.join(repo, "apps/pinetrie/package.json"))
  const watcher = require("@parcel/watcher")
  const d = fs.mkdtempSync(path.join(dir, "echo-"))
  const events = []
  const sub = await watcher.subscribe(d, (err, evs) => {
    if (err) events.push({ error: String(err) })
    else for (const e of evs) events.push({ ...e, at: now() })
  })
  await new Promise(r => setTimeout(r, 300))
  const ours = new Map()
  for (let i = 0; i < 200; i++) {
    const r = checkedWrite(d, `ours-${i}.txt`, `accepted ${i}\n`, null, false)
    ours.set(path.join(d, `ours-${i}.txt`), r.after)
  }
  for (let i = 0; i < 200; i++)
    fs.writeFileSync(path.join(d, `yours-${i}.txt`), `yours ${i}\n`)
  for (let i = 0; i < 50; i++) {
    const r = checkedWrite(d, `both-${i}.txt`, `accepted ${i}\n`, null, false)
    ours.set(path.join(d, `both-${i}.txt`), r.after)
    fs.writeFileSync(path.join(d, `both-${i}.txt`), `then yours ${i}!\n`)
  }
  await new Promise(r => setTimeout(r, 2000))
  await sub.unsubscribe()
  const byPath = new Map()
  for (const e of events) if (e.path) byPath.set(e.path, e)
  const classed = {
    stagingNames: 0,
    ours: 0,
    yours: 0,
    error: events.filter(e => e.error).length,
  }
  const wrong = []
  for (const [p] of byPath) {
    const base = path.basename(p)
    if (base.startsWith(STAGE)) {
      classed.stagingNames++
      continue
    }
    const isOurs = ours.has(p) && ours.get(p) === stamp(p)
    if (isOurs) classed.ours++
    else classed.yours++
    const truth = base.startsWith("ours-") ? "ours" : "yours"
    if ((isOurs ? "ours" : "yours") !== truth) wrong.push(base)
  }
  const missed = [
    ...ours.keys(),
    ...Array.from({ length: 200 }, (_, i) => path.join(d, `yours-${i}.txt`)),
  ].filter(p => !byPath.has(p)).length
  return {
    events: events.length,
    paths: byPath.size,
    classed,
    misclassified: wrong,
    pathsWithNoEvent: missed,
  }
}

async function torn(dir, seconds) {
  fs.mkdirSync(dir, { recursive: true })
  const size = 4 << 20
  const files = Array.from({ length: 20 }, (_, i) =>
    path.join(dir, `torn-${i}.bin`),
  )
  for (const f of files) fs.writeFileSync(f, Buffer.alloc(size, 65))
  const end = Date.now() + seconds * 1000
  let n = 0
  while (Date.now() < end) {
    const f = files[n % files.length]
    const token = 66 + (n % 50)
    const fd = fs.openSync(f, "r+")
    for (let off = 0; off < size; off += 65536) {
      fs.writeSync(fd, Buffer.alloc(65536, token), 0, 65536, off)
      if (off % (1 << 20) === 0) await new Promise(r => setImmediate(r))
    }
    fs.closeSync(fd)
    n++
  }
  console.log(
    JSON.stringify({ rewrites: n, files: files.length, bytesEach: size }),
  )
}

const [mode, a, b] = process.argv.slice(2)
if (mode === "racer") racer(a, b)
else if (mode === "torn") await torn(path.resolve(a), Number(b ?? 60))
else if (mode === "all") {
  const dir = fs.mkdtempSync(path.join(os.homedir(), ".s185-"))
  try {
    const result = {
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
      timing: timing(dir),
      race: [await race(dir, "in place"), await race(dir, "rename")],
      names: names(dir),
      echo: await echo(dir),
    }
    const out = path.join(
      here,
      `results-mac-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    )
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
} else console.error("usage: mac-write.mjs all | torn <dir> <seconds>")
