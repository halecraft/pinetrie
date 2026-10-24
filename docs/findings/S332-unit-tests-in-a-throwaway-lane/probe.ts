// S332's disposable probe: the repo's unit tests in a throwaway lane on the
// Mac's lane VM, from a copy of this checkout. Run from apps/pinetrie:
//   copy to apps/pinetrie/s332-probe.ts, then node s332-probe.ts <out dir>

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { threadIdFor } from "@pinetrie/core"
import { PINETRIE_MOUNT, thisInstall } from "@pinetrie/install"
import {
  ensureRuntime,
  laneContainer,
  prepareImages,
  RUNTIME_MOUNT,
  sessionFiles,
} from "@pinetrie/lanes"
import { findProject } from "./host/work/runtime.ts"
import { PLAYWRIGHT_VERSION } from "./host/work/setup.ts"

const out = process.argv[2] ?? "/tmp/s332"
const repo = path.resolve(import.meta.dirname, "../..")
const log = (l: string) => console.log(l)
const project = mkdtempSync(path.join(tmpdir(), "s332-project-"))
const { execFileSync } = await import("node:child_process")
execFileSync("git", ["init", "-q"], { cwd: project })
writeFileSync(path.join(project, "README.md"), "s332\n")
execFileSync("git", ["add", "."], { cwd: project })
execFileSync(
  "git",
  ["-c", "user.name=s", "-c", "user.email=s@s", "commit", "-qm", "s"],
  { cwd: project },
)

const found = await findProject({
  root: project,
  install: thisInstall,
  slots: 16,
  hostSocket: path.join(project, ".no-ssh.sock"),
  log,
  working: w => log(`working ${JSON.stringify(w)}`),
  manage: "manage",
})
if (found?.kind !== "found") throw new Error(`no runtime: ${JSON.stringify(found)}`)
const { runtime } = found
const nested = process.env.S332_NESTED === "1"
const name = threadIdFor(`s332-${process.pid}`)
const timeline: string[] = []
const mark = (what: string) => {
  timeline.push(`${new Date().toISOString()} ${what}`)
  log(`== ${what}`)
}
try {
  mark("images")
  const { lane, runtimeFrom } = await prepareImages(
    runtime,
    project,
    PLAYWRIGHT_VERSION,
  )
  const files = sessionFiles(path.join(project, ".s332-session"))
  await found.ready({
    defaultImage: runtimeFrom,
    hostPorts: [],
    mounts: [
      { source: project, target: "/mnt/host-working-copy", readonly: true },
      { source: repo, target: "/mnt/src", readonly: true },
      { source: thisInstall.root, target: PINETRIE_MOUNT, readonly: true },
      {
        source: await ensureRuntime(runtime, files.lanes.runtime, runtimeFrom),
        target: RUNTIME_MOUNT,
        readonly: true,
      },
    ],
  })
  mark("lane")
  await runtime.disk({ kind: "create", lane: name })
  await runtime.run({
    name: laneContainer(name),
    lane: name,
    image: lane,
    memory: "6g",
    mounts: [{ source: repo, target: "/mnt/src", readonly: true }],
    env: {},
    hostSocket: null,
    starts: [],
    nested,
    hostPorts: [],
    states: false,
  })
  const sh = (script: string, file: string) =>
    new Promise<number>(resolve => {
      const [p = "docker", ...rest] = runtime.execArgv(laneContainer(name), [
        "bash",
        "-lc",
        script,
      ])
      const child = spawn(p, rest, { stdio: ["ignore", "pipe", "pipe"] })
      let text = ""
      child.stdout.on("data", d => {
        text += d
      })
      child.stderr.on("data", d => {
        text += d
      })
      child.on("close", code => {
        writeFileSync(path.join(out, file), text)
        resolve(code ?? -1)
      })
    })
  mark("facts")
  await sh(
    "id; uname -a; stat -f -c '%T' /workspace; df -h /workspace; node -v; corepack pnpm -v; nproc; free -m; cat /proc/self/status | grep -i cap",
    "facts.txt",
  )
  mark("copy")
  log(
    `copy exit ${await sh(
      "set -e; mkdir -p /workspace/src && tar -C /mnt/src --exclude=./node_modules --exclude='*/node_modules' --exclude=./.jj --exclude=./.git --exclude=./dist --exclude=./.plans -cf - . | tar -xf - -C /workspace/src && du -sh /workspace/src",
      "copy.txt",
    )}`,
  )
  mark("install")
  log(
    `install exit ${await sh(
      "cd /workspace/src && CI=1 corepack pnpm install --frozen-lockfile 2>&1 | tail -40",
      "install.txt",
    )}`,
  )
  mark("vitest")
  log(
    `vitest exit ${await sh(
      "cd /workspace/src && npx vitest run --reporter json --outputFile=/workspace/vitest.json > /workspace/vitest.log 2>&1; echo exit $?; tail -30 /workspace/vitest.log",
      "vitest.txt",
    )}`,
  )
  await sh("cat /workspace/vitest.json", "vitest.json")
  mark("proofs")
  log(
    `proofs exit ${await sh(
      "cd /workspace/src && node scripts/unit-proofs.ts 2>&1 | tail -20",
      "proofs.txt",
    )}`,
  )
  mark("done")
} finally {
  writeFileSync(path.join(out, "timeline.txt"), `${timeline.join("\n")}\n`)
  await runtime.remove(laneContainer(name)).catch(() => {})
  await runtime.disk({ kind: "delete", lane: name }).catch(() => {})
  await found.close()
  rmSync(project, { recursive: true, force: true })
}
