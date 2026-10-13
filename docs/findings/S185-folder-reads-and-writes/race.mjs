// S185's race: does an accept's write ever destroy a save it never saw?
// Each trial, the target holds "old"; an accept replaces it expecting "old",
// while a worker thread saves "yours" once, at a random moment within the
// accept. A trial that ends with the accept's content in place after "yours"
// was saved is a loss: your save is gone, and nothing read it.
//   node race.mjs [dir] [trials]   (dir: a fresh folder under $HOME by default)
// Three protocols:
// - `check, rename`: the stamp checked, then the staged file renamed over;
// - `aside, link`: the target renamed aside, then checked by its inode, size
//   and mtime, which a rename keeps; the staged file linked into place, which
//   fails if anything is there; the aside checked once more, then deleted. A
//   check that fails puts what it found back, and refuses. It never replaces
//   a file it has not checked;
// - `aside, link, settle`: the same, the last check after a pause, so a
//   writer that opened the old file before it went aside has written.
// Two kinds of save: by rename (an app's save), and in place by path.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads"

const STAGE = ".pinetrie-stage-"
const ASIDE = ".pinetrie-aside-"
const stat = p => {
  try {
    return fs.lstatSync(p, { bigint: true })
  } catch {
    return null
  }
}
const stampOf = s => (s === null ? null : `${s.size}:${s.ctimeNs}`)
const same = (a, b) =>
  a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs

function checkRename(dir, name, staged, expected) {
  const target = path.join(dir, name)
  if (stampOf(stat(target)) !== expected) return "refused"
  fs.renameSync(staged, target)
  return "written"
}

const pause = ms =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function asideLink(dir, name, staged, expected, settleMs = 0) {
  const target = path.join(dir, name)
  const aside = path.join(dir, `${ASIDE}${name}`)
  const before = stat(target)
  if (stampOf(before) !== expected) return "refused"
  try {
    fs.renameSync(target, aside)
  } catch {
    return "refused" // gone since the check
  }
  const putBack = () => {
    try {
      fs.linkSync(aside, target)
    } catch {
      // Something newer is at the target: it stays, and so does the aside,
      // for the next read to find and keep.
      return "refused, kept aside"
    }
    fs.unlinkSync(aside)
    return "refused"
  }
  const moved = stat(aside)
  if (!same(moved, before)) return putBack()
  try {
    fs.linkSync(staged, target)
  } catch {
    fs.unlinkSync(aside) // checked: the old content, which the state keeps
    return "refused"
  }
  if (settleMs > 0) pause(settleMs)
  const last = stat(aside)
  if (!same(last, moved)) {
    // Written in place, through a file it held open, after the check: yours
    // goes back over ours.
    fs.renameSync(aside, target)
    return "refused"
  }
  fs.unlinkSync(aside)
  return "written"
}

if (!isMainThread) {
  const { flag, dir, name, kind } = workerData
  const target = path.join(dir, name)
  for (;;) {
    Atomics.wait(flag, 0, 0)
    if (Atomics.load(flag, 0) === 2) break
    const delayNs = Atomics.load(flag, 1)
    const t = process.hrtime.bigint()
    while (process.hrtime.bigint() - t < BigInt(delayNs));
    if (kind === "rename") {
      fs.writeFileSync(`${target}.app-tmp`, "yours")
      fs.renameSync(`${target}.app-tmp`, target)
    } else fs.writeFileSync(target, "yours")
    Atomics.store(flag, 0, 0)
    Atomics.notify(flag, 0)
  }
} else {
  const dir =
    process.argv[2] ?? fs.mkdtempSync(path.join(os.homedir(), ".s185-race-"))
  const trials = Number(process.argv[3] ?? 3000)
  const results = []
  for (const kind of ["rename", "in place"])
    for (const [label, write] of [
      ["check, rename", checkRename],
      ["aside, link", asideLink],
      ["aside, link, settle 5 ms", (d, n, st, e) => asideLink(d, n, st, e, 5)],
    ]) {
      const name = `t-${kind.replace(" ", "-")}-${label.replace(/[^a-z0-9]+/g, "-")}`
      const target = path.join(dir, name)
      const flag = new Int32Array(new SharedArrayBuffer(8))
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { flag, dir, name, kind },
      })
      const tally = {
        kind,
        protocol: label,
        trials,
        written: 0,
        refused: 0,
        losses: 0,
      }
      for (let i = 0; i < trials; i++) {
        fs.writeFileSync(target, "old")
        const expected = stampOf(stat(target))
        const staged = path.join(dir, `${STAGE}${name}`)
        fs.writeFileSync(staged, "accepted")
        Atomics.store(flag, 1, Math.floor(Math.random() * 300_000))
        Atomics.store(flag, 0, 1)
        Atomics.notify(flag, 0)
        const outcome = write(dir, name, staged, expected)
        while (Atomics.load(flag, 0) !== 0) Atomics.wait(flag, 0, 1, 50)
        if (outcome === "written") tally.written++
        else tally.refused++
        if (fs.existsSync(staged)) fs.unlinkSync(staged)
        for (const f of fs.readdirSync(dir))
          if (f.startsWith(ASIDE)) fs.unlinkSync(path.join(dir, f))
        if (fs.readFileSync(target, "utf8") === "accepted") tally.losses++
      }
      Atomics.store(flag, 0, 2)
      Atomics.notify(flag, 0)
      await worker.terminate()
      results.push(tally)
      console.log(JSON.stringify(tally))
    }
  if (process.argv[2] === undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  const out = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    `results-race-${os.platform()}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  )
  fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
}
