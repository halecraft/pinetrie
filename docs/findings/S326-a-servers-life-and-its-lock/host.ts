// S326's stand-in host: the real runtime (`findProject`, `ready`) on a lane
// VM of its own, its disks role opened, then it waits to be killed.
//   node host.ts ready <out.json>        opens the role, writes facts, waits
//   node host.ts long  <out.json> <n>    also two snapshots <n> files apart,
//                                        times one diff, starts another, waits
import { writeFileSync } from "node:fs"
import path from "node:path"
import { snapshotId, threadIdFor } from "../../../packages/core/index.ts"
import { thisInstall, PINETRIE_MOUNT } from "../../../packages/install/index.ts"
import {
  ensureRuntime,
  prepareImages,
  RUNTIME_MOUNT,
} from "../../../packages/lanes/index.ts"
import { findProject } from "../../../apps/pinetrie/host/work/runtime.ts"
import { PLAYWRIGHT_VERSION } from "../../../apps/pinetrie/host/work/setup.ts"
import { committedProject } from "../../../apps/pinetrie/e2e/harness.ts"
import { suiteSessionFiles } from "../../../apps/pinetrie/e2e/lane-hosts.ts"
import { inDisks, ownVm } from "../../../apps/pinetrie/e2e/lanes/support.ts"

const [mode = "ready", out = "/tmp/s326.json", files = "200000"] =
  process.argv.slice(2)
const own = ownVm({
  share: ["images", "bin", "builder"],
  data: "contract-data.img",
})
if (own === null) throw new Error("the Mac only")
// Another host keeps the VM up in life; so does this probe, after its death.
process.env.LAUNCHER_IDLE_SECONDS = "36000"
const t0 = performance.now()
const say = (s: string) =>
  console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`)

const root = await committedProject("pinetrie-s326-", { "README.md": "a\n" })
const found = await findProject({
  root,
  install: thisInstall,
  slots: 16,
  hostSocket: path.join(root, ".no-ssh.sock"),
  log: l => say(l),
  building: b => say(`building ${JSON.stringify(b)}`),
})
if (found?.kind !== "found") throw new Error("no runtime")
const { runtime } = found
const { runtimeFrom } = await prepareImages(runtime, root, PLAYWRIGHT_VERSION)
await found.ready({
  defaultImage: "",
  hostPorts: [],
  mounts: [
    { source: root, target: "/mnt/host-working-copy", readonly: true },
    { source: thisInstall.root, target: PINETRIE_MOUNT, readonly: true },
    {
      source: await ensureRuntime(
        runtime,
        suiteSessionFiles(root).lanes.runtime,
        runtimeFrom,
      ),
      target: RUNTIME_MOUNT,
      readonly: true,
    },
  ],
})
const lane = threadIdFor(`s326-${process.pid}`)
await runtime.disk({ kind: "create", lane })
say("disks role open")
const facts = {
  pid: process.pid,
  state: own.state,
  dockerSock: path.join(own.state, "pinetrie", "vm", "docker.sock"),
  root,
  lane,
}
if (mode === "long") {
  const a = snapshotId(`s326a-${process.pid}`)
  const b = snapshotId(`s326b-${process.pid}`)
  await runtime.disk({ kind: "snapshot", lane, snapshot: a })
  const lanePath = (
    await inDisks(root, "ls -d /var/lib/lanehost/projects/*/lanes/$1", lane)
  ).trim()
  await inDisks(
    root,
    `mkdir -p "$1/many" && cd "$1/many" && seq 1 "$2" | xargs -n 2000 touch`,
    lanePath,
    files,
  )
  await runtime.disk({ kind: "snapshot", lane, snapshot: b })
  const d0 = performance.now()
  const diff = await runtime.diff(a, b)
  const took = (performance.now() - d0) / 1000
  say(`one diff of ${files} files took ${took.toFixed(1)}s`)
  Object.assign(facts, { a, b, diffSeconds: took, diffSize: JSON.stringify(diff).length })
  void runtime.diff(a, b).then(
    () => say("the second diff answered"),
    e => say(`the second diff failed: ${e}`),
  )
  say("calling")
}
writeFileSync(out, JSON.stringify(facts, null, 2))
say(`ready: ${out}`)
setInterval(() => {}, 1 << 30)
