// S169's shared pieces: the load both sides write, and a file's stamp. Disposable.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SCRATCH = path.join(HERE, "scratch")

/** A file's stamp and times, as either side reads it. */
export function stampOf(p) {
  try {
    const s = fs.lstatSync(p, { bigint: true })
    return {
      ino: String(s.ino),
      size: String(s.size),
      ctimeNs: String(s.ctimeNs),
      mtimeNs: String(s.mtimeNs),
      kind: s.isFile() ? "file" : s.isDirectory() ? "dir" : "other",
    }
  } catch {
    return null
  }
}

/** Both clocks: wall (ns, as a string) and monotonic (µs). */
export const clocks = () => ({
  realNs: String(BigInt(Date.now()) * 1_000_000n),
  monoUs: Number(process.hrtime.bigint() / 1000n),
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * The load: each step one write to a file under `dir`, then its stamp. The
 * same on both sides, so each kind of write is seen from both.
 */
export async function writeLoad(dir, record, pause = () => sleep(150)) {
  fs.mkdirSync(dir, { recursive: true })
  const at = name => path.join(dir, name)
  const step = async (op, file, write) => {
    const before = clocks()
    write()
    const after = clocks()
    record({
      op,
      file: path.relative(SCRATCH, at(file)),
      before,
      after,
      stamp: stampOf(at(file)),
    })
    await pause()
  }
  for (let i = 0; i < 10; i++) {
    await step("create", `c${i}.md`, () =>
      fs.writeFileSync(at(`c${i}.md`), `create ${i}\n`),
    )
    await step("overwrite", `c${i}.md`, () =>
      fs.writeFileSync(at(`c${i}.md`), `over ${i}\n`),
    )
    await step("append", `c${i}.md`, () =>
      fs.appendFileSync(at(`c${i}.md`), `more ${i}\n`),
    )
    await step("rename", `r${i}.md`, () => {
      fs.writeFileSync(at(`r${i}.tmp`), `renamed ${i}\n`)
      fs.renameSync(at(`r${i}.tmp`), at(`r${i}.md`))
    })
    await step("restore-mtime", `c${i}.md`, () => {
      const old = fs.statSync(at(`c${i}.md`))
      fs.writeFileSync(at(`c${i}.md`), `same size ${i}\n`.slice(0, old.size))
      fs.utimesSync(at(`c${i}.md`), old.atime, old.mtime)
    })
  }
  // Two writes within one millisecond: does ctime tell them apart?
  for (let i = 0; i < 10; i++) {
    const f = at(`fast${i}.md`)
    fs.writeFileSync(f, "one\n")
    const one = stampOf(f)
    fs.writeFileSync(f, "two\n")
    record({
      op: "fast",
      file: path.relative(SCRATCH, f),
      before: clocks(),
      after: clocks(),
      stamp: stampOf(f),
      first: one,
    })
    await pause()
  }
}

/** Every file under `scratch/` with its stamp, from this side. */
export function scanAll() {
  const out = {}
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(SCRATCH, p)] = stampOf(p)
    }
  }
  if (fs.existsSync(SCRATCH)) walk(SCRATCH)
  return out
}

export const writeJson = (name, value) =>
  fs.writeFileSync(path.join(HERE, name), `${JSON.stringify(value, null, 1)}\n`)

export const readJson = name => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, name), "utf8"))
  } catch {
    return null
  }
}

/** Wait for `file` under scratch/ to exist, up to `minutes`. */
export async function waitFor(file, minutes) {
  const until = Date.now() + minutes * 60_000
  while (!fs.existsSync(path.join(SCRATCH, file))) {
    if (Date.now() > until) throw new Error(`no ${file} after ${minutes} min`)
    await sleep(200)
  }
}
