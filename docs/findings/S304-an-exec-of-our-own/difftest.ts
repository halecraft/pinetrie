// S304, Q1 and Q2: each case through pi's `NodeExecutionEnv.exec` and
// through `own-exec.ts`, as pi's bash tool calls it (pi's default limits,
// tail, spill on). Compares the view the updates leave, the result's
// metadata, the spill file's bytes and the error's code; and checks that
// the raw log holds what each pipe was given.
//   node docs/findings/S304-an-exec-of-our-own/difftest.ts
// Run from packages/pi, which declares pi.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { type Chunk, ownExec, type Pi } from "./own-exec.ts"

// pi's exports map has only an `import` condition: load its files by path.
const piDir = path.join(process.cwd(), "node_modules/@earendil-works/pi-agent-core/dist")
const piMain = await import(pathToFileURL(path.join(piDir, "index.js")).href)
const { NodeExecutionEnv } = await import(pathToFileURL(path.join(piDir, "harness/env/nodejs.js")).href)
const pi = piMain as unknown as Pi & {
  applyShellOutputUpdate: (v: unknown, u: unknown) => { text: string; [k: string]: unknown }
}

const dir = "/tmp/s288"
mkdirSync(dir, { recursive: true })
// Bytes for each pipe, invalid UTF-8 and control bytes included.
const out = new Uint8Array(70000).map((_, i) => (i % 97 === 0 ? 10 : (i * 37) % 256))
const errb = new Uint8Array(30000).map((_, i) => (i % 61 === 0 ? 10 : (i * 13 + 7) % 256))
writeFileSync(`${dir}/out.bin`, out)
writeFileSync(`${dir}/err.bin`, errb)

interface Case {
  readonly name: string
  readonly command: string
  readonly timeout?: number
  readonly abortAfterMs?: number
  // Two pipes written at once interleave as they happen to be read, for
  // pi's exec as for ours: compare their lines as a multiset.
  readonly racy?: boolean
}
const CASES: readonly Case[] = [
  { name: "empty", command: "true" },
  { name: "short", command: "echo hello; echo world" },
  { name: "no final newline", command: "printf 'a\\nb'" },
  { name: "long by lines", command: "seq 1 5000" },
  { name: "long by bytes", command: "head -c 200000 /dev/zero | tr '\\0' a | fold -w 100" },
  { name: "one long line", command: "head -c 100000 /dev/zero | tr '\\0' x" },
  { name: "long, last line partial", command: "seq 1 3000; head -c 80000 /dev/zero | tr '\\0' y" },
  { name: "control bytes", command: "printf '\\x00\\x01\\x1b[31mred\\x7f\\x0b\\x0c\\r\\n'" },
  { name: "invalid UTF-8", command: "printf '\\xff\\xfe abc \\xc3\\x28\\n'" },
  { name: "character split across writes", command: "printf '\\xc3'; sleep 0.1; printf '\\xa9\\n'" },
  { name: "CRLF", command: "printf 'a\\r\\nb\\r\\n'" },
  { name: "stderr alone", command: "echo err >&2" },
  { name: "both pipes, in turn", command: "echo a; sleep 0.05; echo b >&2; sleep 0.05; echo c" },
  { name: "both pipes, at once", command: "seq 1 3000 & seq 1 3000 >&2; wait", racy: true },
  { name: "binary on both pipes", command: `cat ${dir}/out.bin; sleep 0.1; cat ${dir}/err.bin >&2` },
  { name: "exit 3", command: "echo x; exit 3" },
  { name: "killed by a signal", command: "echo x; kill -9 $$" },
  { name: "timeout", command: "echo before; sleep 5", timeout: 1 },
  { name: "abort", command: "echo before; sleep 5", abortAfterMs: 300 },
  { name: "background job holds the pipes", command: "(sleep 1; echo late) & echo now" },
  { name: "huge, spilled", command: "seq 1 300000" },
]

const OPTIONS = {
  capture: { limits: { maxBytes: pi.DEFAULT_MAX_BYTES, maxLines: pi.DEFAULT_MAX_LINES, retain: "tail" }, spill: true },
  env: {},
  inheritEnv: true,
}

const run = async (exec: (c: string, o: unknown, x: unknown) => Promise<unknown>, c: Case) => {
  const ac = new AbortController()
  if (c.abortAfterMs) setTimeout(() => ac.abort(), c.abortAfterMs)
  let view: { text: string; [k: string]: unknown } | undefined
  const result = (await exec(
    c.command,
    { ...OPTIONS, timeout: c.timeout, onUpdate: (u: unknown) => (view = pi.applyShellOutputUpdate(view, u)) },
    { abortSignal: ac.signal },
  )) as { ok: boolean; value?: Record<string, unknown>; error?: { code: string } }
  const spillPath = (result.value?.spillPath ?? view?.spillPath) as string | undefined
  const spill = spillPath ? readFileSync(spillPath) : null
  const { spillPath: _a, ...value } = result.value ?? {}
  const { spillPath: _b, ...shown } = view ?? { text: "" }
  return { ok: result.ok, code: result.error?.code, value, shown, spill }
}

const env = new NodeExecutionEnv({ cwd: dir })
let log: Chunk[] = []
const ours = ownExec(pi, "bash", dir, env, c => log.push(c))
const piExec = (c: string, o: unknown, x: unknown) => env.exec(c, o, x)

const lines = (t: string) => t.split("\n").sort().join("\n")
let same = 0
for (const c of CASES) {
  log = []
  const [a, b] = [await run(piExec, c), await run(ours, c)]
  const ourLog = log
  const strip = (r: typeof a) =>
    JSON.stringify({ ...r, spill: r.spill ? r.spill.length : null, shown: c.racy ? { ...r.shown, text: lines(r.shown.text) } : r.shown })
  const spillSame = (a.spill === null) === (b.spill === null) && (a.spill === null || c.racy || Buffer.compare(a.spill, b.spill as Buffer) === 0)
  const ok = strip(a) === strip(b) && spillSame
  same += ok ? 1 : 0
  console.log(`${ok ? "same" : "DIFF"}  ${c.name}${a.spill ? ` (spilled ${a.spill.length} bytes)` : ""}`)
  if (!ok) {
    console.log(`  pi:   ${strip(a).slice(0, 600)}`)
    console.log(`  ours: ${strip(b).slice(0, 600)}`)
  }
  if (c.name === "binary on both pipes") {
    const join = (p: 1 | 2) => Buffer.concat(ourLog.filter(x => x.pipe === p).map(x => x.bytes))
    console.log(`  raw log: stdout ${Buffer.compare(join(1), Buffer.from(out)) === 0 ? "equals" : "DIFFERS FROM"} what it was given (${join(1).length} bytes), stderr ${Buffer.compare(join(2), Buffer.from(errb)) === 0 ? "equals" : "DIFFERS FROM"} (${join(2).length} bytes)`)
  }
}
console.log(`${same} of ${CASES.length} the same`)
