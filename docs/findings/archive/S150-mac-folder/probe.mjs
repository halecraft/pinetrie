#!/usr/bin/env node
// S150's probe: what a person's folder on the Mac does, for syncing it with a
// thread (docs/findings/archive/S150-mac-folder.md). Disposable.
//
//   node probe.mjs auto [--dir D] [--files N] [--tree N] [--big MB]
//   node probe.mjs app <document> [--dir D]
//
// `auto` runs every measurement that needs no person; `app` copies a document
// into a fresh folder and guides one save, then a replace under the open app.
// Each writes results-<mode>-<time>.json beside this file (or --out).
// Dependencies install into a temporary prefix, never into the repo.

import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import readline from "node:readline/promises"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEPS = path.join(os.tmpdir(), "s150-deps")
const PINS = ["@parcel/watcher@2.6.0", "hash-wasm@4.12.0"]

function args() {
  const [mode, ...rest] = process.argv.slice(2)
  const o = { mode, positional: [], files: 10000, tree: 100000, big: 2048 }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith("--")) o[a.slice(2)] = rest[++i]
    else o.positional.push(a)
  }
  o.files = Number(o.files)
  o.tree = Number(o.tree)
  o.big = Number(o.big)
  return o
}

function deps() {
  const req = createRequire(path.join(DEPS, "x.js"))
  try {
    return { watcher: req("@parcel/watcher"), hashWasm: req("hash-wasm") }
  } catch {
    fs.mkdirSync(DEPS, { recursive: true })
    const r = spawnSync(
      "npm",
      ["install", "--no-save", "--prefix", DEPS, ...PINS],
      { stdio: "inherit" },
    )
    if (r.status !== 0) throw new Error("npm install failed")
    return { watcher: req("@parcel/watcher"), hashWasm: req("hash-wasm") }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const now = () => performance.now()
const rel = (root, p) => path.relative(root, p)

function sh(cmd, argv) {
  try {
    return execFileSync(cmd, argv, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function environment(dir) {
  const env = {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    cpus: os.cpus()[0]?.model,
    dir,
  }
  if (process.platform === "darwin") {
    env.swVers = sh("sw_vers", [])
    const mount = sh("df", [dir])?.split("\n").at(-1)?.split(/\s+/).at(-1)
    const info = mount ? sh("diskutil", ["info", mount]) : null
    env.diskutil = info
      ?.split("\n")
      .filter(l =>
        /Personality|Type \(Bundle\)|Case|Mount Point|Encrypted|Solid State/.test(
          l,
        ),
      )
      .map(l => l.trim())
  } else {
    env.fsType = sh("stat", ["-f", "-c", "%T", dir])
  }
  return env
}

// --- scans: the stand-in for what a sync engine compares ---------------------

function scan(root) {
  const out = new Map()
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const s = fs.lstatSync(p, { bigint: true })
      if (e.isDirectory()) {
        out.set(rel(root, p), "d")
        walk(p)
      } else
        out.set(rel(root, p), `f:${s.ino}:${s.size}:${s.mtimeNs}:${s.mode}`)
    }
  }
  walk(root)
  return out
}

/** Paths that differ between two scans; a directory counts only when it comes or goes. */
function changed(before, after) {
  const paths = new Set()
  for (const [p, v] of after) if (before.get(p) !== v) paths.add(p)
  for (const p of before.keys()) if (!after.has(p)) paths.add(p)
  return paths
}

/** Which changed paths no event names, on its own or through a directory above it. */
function coverage(changedPaths, eventPaths) {
  const strict = [...changedPaths].filter(p => !eventPaths.has(p))
  const viaAncestor = strict.filter(p => {
    const parts = p.split(path.sep)
    for (let i = parts.length - 1; i > 0; i--)
      if (eventPaths.has(parts.slice(0, i).join(path.sep))) return false
    return true
  })
  return {
    missingStrict: strict.length,
    missingEvenViaAncestor: viaAncestor.length,
    sample: viaAncestor.slice(0, 10),
  }
}

// --- the folder operations ----------------------------------------------------

const DIRS = 100
const filesOf = (dir, n) => {
  const per = Math.max(1, Math.ceil(n / DIRS))
  const out = []
  for (let d = 0; d < DIRS && out.length < n; d++)
    for (let f = 0; f < per && out.length < n; f++)
      out.push(path.join(dir, `d${d}`, `f${f}.txt`))
  return out
}

const ops = {
  create(dir, n) {
    for (let d = 0; d < DIRS; d++)
      fs.mkdirSync(path.join(dir, `d${d}`), { recursive: true })
    for (const f of filesOf(dir, n)) fs.writeFileSync(f, `a ${f}\n`)
  },
  modifyInPlace(dir, n) {
    for (const f of filesOf(dir, n)) fs.writeFileSync(f, `b ${f}\n`)
  },
  saveByRename(dir, n) {
    for (const f of filesOf(dir, n)) {
      const tmp = path.join(path.dirname(f), `.~${path.basename(f)}.tmp`)
      fs.writeFileSync(tmp, `c ${f}\n`)
      fs.renameSync(tmp, f)
    }
  },
  renameFiles(dir, n) {
    for (const f of filesOf(dir, n).filter((_, i) => i % 2 === 0))
      fs.renameSync(f, `${f}.moved`)
  },
  renameDirs(dir) {
    for (let d = 0; d < 10; d++)
      fs.renameSync(path.join(dir, `d${d}`), path.join(dir, `r${d}`))
  },
  caseOnlyRename(dir) {
    for (let d = 10; d < 20; d++) {
      const a = path.join(dir, `d${d}`, "f1.txt")
      if (fs.existsSync(a)) fs.renameSync(a, path.join(dir, `d${d}`, "F1.TXT"))
    }
  },
  deleteAll(dir) {
    for (const e of fs.readdirSync(dir))
      fs.rmSync(path.join(dir, e), { recursive: true, force: true })
  },
}

// --- watching -------------------------------------------------------------------

async function quiet(state, minMs = 3000, quietMs = 1500, maxMs = 60000) {
  const start = now()
  while (now() - start < maxMs) {
    await sleep(100)
    if (now() - start > minMs && now() - state.last > quietMs) return
  }
}

async function liveRounds(watcher, dir, n) {
  const state = { last: now(), events: [] }
  const sub = await watcher.subscribe(dir, (err, evs) => {
    if (err) state.events.push({ error: String(err) })
    for (const e of evs)
      state.events.push({ t: now(), type: e.type, path: rel(dir, e.path) })
    state.last = now()
  })
  const rounds = []
  for (const name of [
    "create",
    "modifyInPlace",
    "saveByRename",
    "renameFiles",
    "renameDirs",
    "caseOnlyRename",
    "deleteAll",
  ]) {
    const before = scan(dir)
    state.events = []
    const t0 = now()
    ops[name](dir, n)
    const opMs = now() - t0
    await quiet(state)
    const after = scan(dir)
    const paths = changed(before, after)
    const evPaths = new Set(
      state.events.filter(e => e.path !== undefined).map(e => e.path),
    )
    const errors = state.events.filter(e => e.error).map(e => e.error)
    const firsts = state.events.filter(e => e.t !== undefined)
    rounds.push({
      round: name,
      opMs: Math.round(opMs),
      changedPaths: paths.size,
      events: firsts.length,
      byType: Object.groupBy
        ? Object.fromEntries(
            Object.entries(Object.groupBy(firsts, e => e.type)).map(
              ([k, v]) => [k, v.length],
            ),
          )
        : null,
      firstEventAfterOpStartMs: firsts.length
        ? Math.round(firsts[0].t - t0)
        : null,
      lastEventAfterOpEndMs: firsts.length
        ? Math.round(firsts.at(-1).t - (t0 + opMs))
        : null,
      errors,
      ...coverage(paths, evPaths),
    })
    console.log("live", rounds.at(-1))
  }
  await sub.unsubscribe()
  return rounds
}

async function sinceRounds(watcher, dir, n, snapDir) {
  const rounds = []
  const sequence = [
    ["create"],
    ["modifyInPlace", "saveByRename"],
    ["renameFiles", "renameDirs", "caseOnlyRename"],
    ["deleteAll"],
  ]
  for (const names of sequence) {
    const snap = path.join(snapDir, `snap-${names.join("-")}`)
    await watcher.writeSnapshot(dir, snap)
    await sleep(1500)
    const before = scan(dir)
    for (const name of names) ops[name](dir, n)
    await sleep(3000)
    const t0 = now()
    let evs = []
    let error = null
    try {
      evs = await watcher.getEventsSince(dir, snap)
    } catch (e) {
      error = String(e)
    }
    const queryMs = now() - t0
    const after = scan(dir)
    const paths = changed(before, after)
    const evPaths = new Set(evs.map(e => rel(dir, e.path)))
    rounds.push({
      rounds: names.join("+"),
      changedPaths: paths.size,
      events: evs.length,
      queryMs: Math.round(queryMs),
      error,
      ...coverage(paths, evPaths),
    })
    console.log("since", rounds.at(-1))
  }
  return rounds
}

// --- names ----------------------------------------------------------------------

function names(dir) {
  const out = {}
  const d = path.join(dir, "case")
  fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, "Probe.txt"), "A")
  out.lowerExists = fs.existsSync(path.join(d, "probe.txt"))
  fs.writeFileSync(path.join(d, "probe.txt"), "B")
  out.afterWritingLower = {
    entries: fs.readdirSync(d),
    upperReads: fs.readFileSync(path.join(d, "Probe.txt"), "utf8"),
  }
  fs.renameSync(path.join(d, "Probe.txt"), path.join(d, "PROBE.txt"))
  out.afterCaseOnlyRename = fs.readdirSync(d)

  const nfc = "caf\u00e9.txt"
  const nfd = "cafe\u0301.txt"
  const hex = p =>
    fs.readdirSync(p, { encoding: "buffer" }).map(b => b.toString("hex"))
  for (const [label, first, second] of [
    ["nfcFirst", nfc, nfd],
    ["nfdFirst", nfd, nfc],
  ]) {
    const n = path.join(dir, label)
    fs.mkdirSync(n)
    fs.writeFileSync(path.join(n, first), "1")
    const r = {
      otherFormExists: fs.existsSync(path.join(n, second)),
      storedAs: hex(n),
    }
    try {
      fs.writeFileSync(path.join(n, second), "2", { flag: "wx" })
      r.exclusiveCreateOfOtherForm = "created"
    } catch (e) {
      r.exclusiveCreateOfOtherForm = e.code
    }
    r.entriesAfter = hex(n)
    out[label] = r
  }
  out.hexNfc = Buffer.from(nfc).toString("hex")
  out.hexNfd = Buffer.from(nfd).toString("hex")
  console.log("names", out)
  return out
}

// --- modification times ---------------------------------------------------------

function mtimes(dir) {
  const f = path.join(dir, "mtime.txt")
  let same = 0
  const deltas = []
  for (let i = 0; i < 1000; i++) {
    fs.writeFileSync(f, `x${i % 10}`)
    const a = fs.statSync(f, { bigint: true }).mtimeNs
    fs.writeFileSync(f, `y${i % 10}`)
    const b = fs.statSync(f, { bigint: true }).mtimeNs
    if (a === b) same++
    deltas.push(Number(b - a))
  }
  deltas.sort((x, y) => x - y)
  const out = {
    writesWithSameMtimeOf1000: same,
    medianDeltaNs: deltas[500],
    minDeltaNs: deltas[0],
    sampleMtimeNs: String(fs.statSync(f, { bigint: true }).mtimeNs),
  }
  console.log("mtime", out)
  return out
}

// --- a tree's stat walk, hashing and cloning ------------------------------------

function tree(dir, n) {
  const t = path.join(dir, "tree")
  const t0 = now()
  const per = 100
  for (let d = 0; d * per < n; d++) {
    const sub = path.join(t, `a${d % 50}`, `b${d}`)
    fs.mkdirSync(sub, { recursive: true })
    for (let f = 0; f < per && d * per + f < n; f++)
      fs.writeFileSync(path.join(sub, `f${f}`), "")
  }
  const createMs = now() - t0
  const walks = []
  for (let i = 0; i < 3; i++) {
    const s = now()
    const m = scan(t)
    walks.push({ ms: Math.round(now() - s), entries: m.size })
  }
  fs.rmSync(t, { recursive: true, force: true })
  const out = { files: n, createMs: Math.round(createMs), statWalks: walks }
  console.log("tree", out)
  return out
}

async function hashing(hashWasm, dir, mb) {
  const f = path.join(dir, "big.bin")
  const chunk = crypto.randomBytes(16 << 20)
  const t0 = now()
  const fd = fs.openSync(f, "w")
  for (let i = 0; i < mb / 16; i++) {
    chunk[0] = i & 255
    fs.writeSync(fd, chunk)
  }
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  const writeMs = now() - t0
  const readAll = async update => {
    const s = fs.createReadStream(f, { highWaterMark: 4 << 20 })
    for await (const c of s) update(c)
  }
  const results = { sizeMB: mb, writeMBps: Math.round(mb / (writeMs / 1000)) }
  for (const [name, make] of [
    ["sha256", () => crypto.createHash("sha256")],
    ["blake3-wasm", null],
  ]) {
    for (const pass of ["first", "second"]) {
      const s = now()
      if (make) {
        const h = make()
        await readAll(c => h.update(c))
        h.digest("hex")
      } else {
        const h = await hashWasm.createBLAKE3()
        h.init()
        await readAll(c => h.update(c))
        h.digest()
      }
      results[`${name}-${pass}MBps`] = Math.round(mb / ((now() - s) / 1000))
    }
  }
  const c = path.join(dir, "big.clone")
  const s = now()
  try {
    fs.copyFileSync(f, c, fs.constants.COPYFILE_FICLONE_FORCE)
    results.cloneMs = Math.round(now() - s)
  } catch (e) {
    results.cloneMs = e.code
  }
  fs.rmSync(f, { force: true })
  fs.rmSync(c, { force: true })
  console.log("hash", results)
  return results
}

// --- the app ------------------------------------------------------------------

function listing(dir) {
  const out = new Map()
  for (const name of fs.readdirSync(dir)) {
    try {
      const s = fs.lstatSync(path.join(dir, name), { bigint: true })
      out.set(name, `${s.ino}:${s.size}:${s.mtimeNs}`)
    } catch {}
  }
  return out
}

async function recordWhile(watcher, dir, ask) {
  const log = []
  const t0 = now()
  const sub = await watcher.subscribe(dir, (err, evs) => {
    if (err) log.push({ t: Math.round(now() - t0), error: String(err) })
    for (const e of evs)
      log.push({
        t: Math.round(now() - t0),
        src: "fsevents",
        type: e.type,
        name: rel(dir, e.path),
      })
  })
  let prev = listing(dir)
  let polling = true
  const poll = (async () => {
    while (polling) {
      await sleep(20)
      const cur = listing(dir)
      for (const [n, v] of cur)
        if (prev.get(n) !== v)
          log.push({
            t: Math.round(now() - t0),
            src: "poll",
            name: n,
            state: prev.has(n) ? "changed" : "added",
            v,
          })
      for (const n of prev.keys())
        if (!cur.has(n))
          log.push({
            t: Math.round(now() - t0),
            src: "poll",
            name: n,
            state: "removed",
          })
      prev = cur
    }
  })()
  const answer = await ask()
  polling = false
  await poll
  await sub.unsubscribe()
  return { log, answer }
}

const digest = p =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")

async function app(watcher, doc, base) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const dir = fs.mkdtempSync(path.join(base, "s150-app-"))
  const file = path.join(dir, path.basename(doc))
  fs.copyFileSync(doc, file)
  const original = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "s150-original-")),
    path.basename(doc),
  )
  fs.copyFileSync(doc, original)
  const appName = (
    await rl.question("Which app and version will you use? ")
  ).trim()
  console.log(`\nA copy is at:\n  ${file}\nOpen it in ${appName || "the app"}.`)
  await rl.question(
    "Press Enter once it is open and you have made an edit, but not saved yet. ",
  )

  console.log("\nStep 1. Save now, in the app. Wait until it has finished.")
  const save = await recordWhile(watcher, dir, () =>
    rl.question("Press Enter when the save has finished. "),
  )
  const afterSave = listing(dir)

  console.log(
    "\nStep 2. Leave the app open with the file. On Enter, this replaces the file on disk",
  )
  console.log(
    "with the original copy (written beside it, then renamed over it), as a sync would.",
  )
  await rl.question("Press Enter to replace it. ")
  const staged = path.join(dir, `.s150-staged-${path.basename(file)}`)
  fs.copyFileSync(original, staged)
  fs.renameSync(staged, file)
  const replacedDigest = digest(file)
  const notice = await recordWhile(watcher, dir, () =>
    rl.question(
      "Wait 10 s and switch to the app. Did it notice, warn or reload? Describe, then Enter: ",
    ),
  )

  console.log("\nStep 3. Make another edit in the app and save it.")
  const second = await recordWhile(watcher, dir, () =>
    rl.question("Press Enter when the save has finished. "),
  )
  const finalDigest = digest(file)
  const note = await rl.question("Anything the app said or did during step 3? ")
  const kept = await rl.question(
    "Close the file, open it again: does it still hold your step 1 edit (the app saved over the replace)? y/n: ",
  )
  rl.close()

  const summary = log => {
    const ts = log.filter(e => e.t !== undefined).map(e => e.t)
    return {
      firstMs: ts.length ? Math.min(...ts) : null,
      lastMs: ts.length ? Math.max(...ts) : null,
      namesTouched: [...new Set(log.map(e => e.name).filter(Boolean))],
    }
  }
  return {
    appName,
    document: path.basename(doc),
    sizeBytes: fs.statSync(doc).size,
    step1Save: {
      ...summary(save.log),
      entriesAfter: Object.fromEntries(afterSave),
      log: save.log,
    },
    step2Replace: { appNoticed: notice.answer, log: notice.log },
    step3SaveAfterReplace: {
      ...summary(second.log),
      fileEqualsReplacedContent: finalDigest === replacedDigest,
      step1EditSurvived: kept.trim(),
      note,
      log: second.log,
    },
    workDir: dir,
  }
}

// --- main ---------------------------------------------------------------------

async function main() {
  const o = args()
  if (o.mode !== "auto" && o.mode !== "app") {
    console.error(
      "usage: node probe.mjs auto [--dir D] [--files N] [--tree N] [--big MB]\n       node probe.mjs app <document> [--dir D]",
    )
    process.exit(2)
  }
  const { watcher, hashWasm } = deps()
  const base = o.dir ?? os.homedir()
  const out = o.out ?? HERE
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  let result
  if (o.mode === "app") {
    if (!o.positional[0]) throw new Error("app needs a document to copy")
    result = {
      environment: environment(base),
      app: await app(watcher, path.resolve(o.positional[0]), base),
    }
  } else {
    const work = fs.mkdtempSync(path.join(base, ".s150-probe-"))
    const snaps = fs.mkdtempSync(path.join(os.tmpdir(), "s150-snaps-"))
    const live = path.join(work, "live")
    const since = path.join(work, "since")
    const misc = path.join(work, "misc")
    for (const d of [live, since, misc]) fs.mkdirSync(d)
    result = {
      environment: environment(work),
      options: { files: o.files, tree: o.tree, big: o.big },
    }
    try {
      result.names = names(misc)
      result.mtime = mtimes(misc)
      result.live = await liveRounds(watcher, live, o.files)
      result.since = await sinceRounds(watcher, since, o.files, snaps)
      result.tree = tree(misc, o.tree)
      result.hash = await hashing(hashWasm, misc, o.big)
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
      fs.rmSync(snaps, { recursive: true, force: true })
    }
  }
  const file = path.join(
    out,
    `results-${o.mode}-${process.platform}-${stamp}.json`,
  )
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`\nwrote ${file}`)
}

await main()
