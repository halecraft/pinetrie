// S191's probe: a host with lanes in this process, its heap sampled each
// second while a scripted agent makes four bash calls in one thread.
//
//   node --expose-gc docs/findings/S191-host-notices-oom/probe.ts
//
// Needs what `pnpm run e2e:lanes` needs (the lane VM on the Mac). Writes
// `samples.jsonl` beside itself.

import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  idleNow,
  START_AGENT,
  waitFor,
} from "../../../apps/pinetrie/e2e/harness.ts"
import { laneHosts } from "../../../apps/pinetrie/e2e/lane-hosts.ts"
import { ROOT, shellWord } from "../../../packages/core/index.ts"
import { readStreamRecords } from "../../../packages/schema/live.ts"

const gc = (globalThis as { gc?: () => void }).gc
if (gc === undefined) throw new Error("run with --expose-gc")

const out = path.join(import.meta.dirname, "samples.jsonl")
writeFileSync(out, "")
const t0 = Date.now()
const note = (o: object) =>
  appendFileSync(
    out,
    `${JSON.stringify({ t: (Date.now() - t0) / 1000, ...o })}\n`,
  )

// The project: pine·trie's tracked files as this repo's `@` holds them,
// committed afresh in a colocated repo of its own, so its lane can run
// `pnpm mutate` as brave-llama's did. The host needs git beside jj, which a
// jj workspace lacks; the copy runs no git against this repo.
const repo = path.resolve(import.meta.dirname, "../../..")
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-s191-")))
chmodSync(dir, 0o755)
const files = execFileSync("jj", ["--no-pager", "file", "list", "-r", "@"], {
  cwd: repo,
  maxBuffer: 64 * 2 ** 20,
})
execFileSync("sh", ["-c", `tar -cf - -T - | tar -xf - -C ${dir}`], {
  cwd: repo,
  input: files,
})
const jj = (...args: string[]) =>
  execFileSync("jj", ["--no-pager", ...args], { cwd: dir, stdio: "pipe" })
jj("git", "init", "--colocate")
jj("config", "set", "--repo", "user.name", "pinetrie s191")
jj("config", "set", "--repo", "user.email", "s191@pinetrie.invalid")
jj("commit", "-m", "pine·trie, for S191")
note({ project: dir, files: files.toString().split("\n").length - 1 })

const MUTATIONS = [
  "a lane read in a batch takes every base for a WIP's",
  "a stale base working copy is not recovered",
  "a turn that changed nothing is committed",
]
const CALLS = {
  baseline: "sleep 30",
  calibrate:
    "mkdir -p /tmp/s191 && for i in $(seq 1000); do echo x > /tmp/s191/$i; done && " +
    "for r in $(seq 1000); do cat /tmp/s191/* > /dev/null; done && echo calibrated",
  install: "cd /workspace && pnpm install --frozen-lockfile 2>&1 | tail -3",
  mutate:
    "cd /workspace && " +
    MUTATIONS.map(
      n =>
        `timeout 900 pnpm mutate scripts/mutations/repo.ts ${shellWord(n)} 2>&1 | tail -4`,
    ).join("; "),
}

const logs: string[] = []
const h = await laneHosts.sectionHost({ dir, logs })
let logged = 0
const named = new Map<string, string>()
const order = Object.keys(CALLS)
const timer = setInterval(() => {
  gc()
  const m = process.memoryUsage()
  // Streams are in id order, so the last tool stream is the newest call's.
  const tool = readStreamRecords(h.host.live)
    .filter(s => s.kind === "tool")
    .at(-1)
  let call: string | null = null
  if (tool?.kind === "tool") {
    if (!named.has(tool.callId))
      named.set(tool.callId, order[named.size] ?? "?")
    call = named.get(tool.callId) ?? null
  }
  for (; logged < logs.length; logged++) note({ log: logs[logged] })
  note({
    heapMB: Math.round(m.heapUsed / 2 ** 20),
    rssMB: Math.round(m.rss / 2 ** 20),
    call,
  })
}, 1000)

try {
  h.script.use([
    ...Object.values(CALLS).map(command => ({
      tool: "bash",
      args: { command },
    })),
    { text: "measured" },
  ])
  await h.user.chat("@agent run the probe's calls", ROOT, START_AGENT)
  await waitFor(() => idleNow(h.host), 3_600_000)
  await h.host.quiet()
  // The last turn's drain, and the heap after it.
  await new Promise(r => setTimeout(r, 15_000))
  note({ results: await h.results("measured") })
} finally {
  clearInterval(timer)
  await h.close()
}
// The host leaves handles open (the VM's lease among them) after its shutdown.
process.exit(0)
