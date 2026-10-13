// S192's probe: an accept that keeps what it moved aside until the folder's
// next read, against S185's two protocols, and five kinds of save.
//   node keep-aside.mjs [dir] [trials]   (dir: a fresh folder under $HOME by default)
// Each trial: the target holds "old"; a worker thread saves once; an accept
// replaces the target expecting "old". Then the folder's next read: once
// nothing (asides included) has changed for QUIET_MS, a kept aside is deleted
// if it is as the accept left it, and otherwise surfaced, its content kept.
// A trial whose save is neither in the target nor surfaced is a loss.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { isMainThread, Worker, workerData } from "node:worker_threads"

const STAGE = ".pinetrie-stage-"
const ASIDE = ".pinetrie-aside-"
/** The folder's quiet window (10 s, S149 rule 6), scaled down. */
const QUIET_MS = 20
const sleep = ms =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const stat = p => {
  try {
    return fs.lstatSync(p, { bigint: true })
  } catch {
    return null
  }
}
const stampOf = s => (s === null ? null : `${s.size}:${s.ctimeNs}`)
const same = (a, b) =>
  a !== null &&
  b !== null &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs

// ── the protocols ────────────────────────────────────────────────────────────

/** S185's baseline: the stamp checked, then the staged file renamed over. */
function checkRename(target, staged, expected) {
  if (stampOf(stat(target)) !== expected) return { outcome: "refused" }
  fs.renameSync(staged, target)
  return { outcome: "written" }
}

/** Rename aside, check, link in; then a pause, a last check, and a delete. */
function asidePause(target, staged, expected) {
  const r = asideLink(target, staged, expected)
  if (r.aside === null) return r
  sleep(5)
  if (!same(stat(r.aside), r.recorded)) {
    fs.renameSync(r.aside, target) // a write came: it goes back over ours
    return { outcome: "refused" }
  }
  fs.unlinkSync(r.aside)
  return { outcome: r.outcome }
}

/**
 * Rename aside, check, link in, and keep the aside for the next read. Returns
 * the aside and the stat it had when checked: null `recorded` means whatever
 * is in it is yours.
 */
function asideLink(target, staged, expected) {
  const aside = path.join(
    path.dirname(target),
    `${ASIDE}${path.basename(target)}`,
  )
  const before = stat(target)
  if (stampOf(before) !== expected) return { outcome: "refused", aside: null }
  if (before === null) {
    try {
      fs.linkSync(staged, target)
      return { outcome: "written", aside: null }
    } catch {
      return { outcome: "refused", aside: null }
    }
  }
  try {
    fs.renameSync(target, aside)
  } catch {
    return { outcome: "refused", aside: null }
  }
  const moved = stat(aside)
  if (!same(moved, before)) {
    try {
      fs.linkSync(aside, target)
      fs.unlinkSync(aside)
      return { outcome: "refused", aside: null }
    } catch {
      return { outcome: "refused", aside, recorded: null }
    }
  }
  try {
    fs.linkSync(staged, target)
  } catch {
    return { outcome: "refused", aside, recorded: moved }
  }
  return { outcome: "written", aside, recorded: moved }
}

/** The folder's next read, for a kept aside: after quiet, delete or surface. */
function nextRead(r) {
  if (r.aside === undefined || r.aside === null) return null
  let last = stat(r.aside)
  let quietSince = Date.now()
  while (Date.now() - quietSince < QUIET_MS) {
    sleep(1)
    const s = stat(r.aside)
    if (!same(s, last)) {
      last = s
      quietSince = Date.now()
    }
  }
  if (r.recorded !== null && same(last, r.recorded)) {
    fs.unlinkSync(r.aside)
    return null
  }
  const kept = fs.readFileSync(r.aside)
  fs.unlinkSync(r.aside)
  return kept
}

const PROTOCOLS = [
  ["check, rename", (t, s, e) => ({ ...checkRename(t, s, e), aside: null })],
  [
    "aside, link, pause 5 ms",
    (t, s, e) => ({ ...asidePause(t, s, e), aside: null }),
  ],
  ["aside, link, kept to the next read", asideLink],
]

// ── the writers ──────────────────────────────────────────────────────────────

const SLOW = 8 << 20
/** Each kind of save: what it writes, whether it opens the file before the accept, and when. */
const WRITERS = {
  "by rename, during": { held: false, startUs: [0, 300] },
  "in place by path, during": { held: false, startUs: [0, 300] },
  "slow, through a file held from before": { held: true, startUs: [0, 300] },
  "late, through a file held from before": {
    held: true,
    startUs: [10_000, 10_000],
  },
  "after the next read, through a held file": {
    held: true,
    startUs: [QUIET_MS * 3000, QUIET_MS * 3000],
  },
}
const contentOf = kind =>
  kind.startsWith("slow") ? Buffer.alloc(SLOW, 121) : Buffer.from("yours")

if (!isMainThread) {
  // flag[0]: 1 prepare, 2 ready, 3 go, 4 done, 9 stop; flag[1]: delay in µs.
  const { flag, target, kind } = workerData
  const data = contentOf(kind)
  for (;;) {
    Atomics.wait(flag, 0, 0)
    if (Atomics.load(flag, 0) === 9) break
    const fd = WRITERS[kind].held ? fs.openSync(target, "r+") : null
    Atomics.store(flag, 0, 2)
    Atomics.notify(flag, 0)
    while (Atomics.load(flag, 0) !== 3) Atomics.wait(flag, 0, 2)
    const t = process.hrtime.bigint()
    const delay = BigInt(Atomics.load(flag, 1)) * 1000n
    if (delay > 2_000_000n) sleep(Number(delay / 1_000_000n))
    else while (process.hrtime.bigint() - t < delay);
    if (kind.startsWith("by rename")) {
      fs.writeFileSync(`${target}.app-tmp`, data)
      fs.renameSync(`${target}.app-tmp`, target)
    } else if (fd === null) fs.writeFileSync(target, data)
    else if (kind.startsWith("slow")) {
      for (let off = 0; off < data.length; off += 65536) {
        fs.writeSync(fd, data, off, 65536, off)
        sleep(0.2)
      }
    } else fs.writeSync(fd, data, 0, data.length, 0)
    if (fd !== null) fs.closeSync(fd)
    Atomics.store(flag, 0, 4)
    Atomics.notify(flag, 0)
    while (Atomics.load(flag, 0) === 4) Atomics.wait(flag, 0, 4)
  }
} else {
  const dir =
    process.argv[2] ?? fs.mkdtempSync(path.join(os.homedir(), ".s188-"))
  const trials = Number(process.argv[3] ?? 300)
  fs.mkdirSync(dir, { recursive: true })
  const results = []
  for (const kind of Object.keys(WRITERS))
    for (const [label, accept] of PROTOCOLS) {
      const target = path.join(dir, "doc.txt")
      const staged = path.join(dir, `${STAGE}doc.txt`)
      const flag = new Int32Array(new SharedArrayBuffer(8))
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { flag, target, kind },
      })
      const want = contentOf(kind)
      const n = kind.startsWith("slow") ? Math.max(20, trials / 5) : trials
      const tally = {
        save: kind,
        protocol: label,
        trials: n,
        written: 0,
        refused: 0,
        surfaced: 0,
        losses: 0,
      }
      for (let i = 0; i < n; i++) {
        fs.writeFileSync(target, "old")
        const expected = stampOf(stat(target))
        fs.writeFileSync(staged, "accepted")
        const [lo, hi] = WRITERS[kind].startUs
        Atomics.store(flag, 1, lo + Math.floor(Math.random() * (hi - lo + 1)))
        Atomics.store(flag, 0, 1)
        Atomics.notify(flag, 0)
        while (Atomics.load(flag, 0) !== 2) Atomics.wait(flag, 0, 1)
        Atomics.store(flag, 0, 3)
        Atomics.notify(flag, 0)
        const r = accept(target, staged, expected)
        const surfaced = nextRead(r)
        while (Atomics.load(flag, 0) !== 4) Atomics.wait(flag, 0, 3, 50)
        if (r.outcome === "written") tally.written++
        else tally.refused++
        if (surfaced !== null) tally.surfaced++
        const inFolder = fs.readFileSync(target)
        if (!inFolder.equals(want) && !(surfaced?.equals(want) ?? false))
          tally.losses++
        for (const f of fs.readdirSync(dir))
          if (f !== "doc.txt") fs.rmSync(path.join(dir, f))
        Atomics.store(flag, 0, 0)
        Atomics.notify(flag, 0)
      }
      Atomics.store(flag, 0, 9)
      Atomics.notify(flag, 0)
      await worker.terminate()
      results.push(tally)
      console.log(JSON.stringify(tally))
    }
  if (process.argv[2] === undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  const out = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    `results-${os.platform()}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  )
  fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
}
