// pnpm vm:build [--force] — the lane VM's image, built on the Mac in a VM of
// its own into `$XDG_STATE_HOME/pinetrie/vm/images/<key>/`, then what
// happens to the lane VM running: which image it runs, and whether this one
// replaces it, and when. Elsewhere no lane VM runs, and it says so. Exits 0
// when the image is there or not needed, 1 when it cannot be built.

import { readFile, stat } from "node:fs/promises"
import os, { homedir } from "node:os"
import path from "node:path"
import { sizeWords } from "@pinetrie/interface"
import {
  BUILDER,
  buildVmImageInVm,
  checkImageDir,
  gatherBinary,
  gatherBuildFirst,
  gatherChangedFiles,
  gatherRunningVm,
  IMAGE_OUTPUTS,
  imageDir,
  imageKey,
  LAUNCHER,
  otherHolders,
  planVmBuild,
  planVmVersion,
  pruneVmState,
  readImageSources,
  vmBuildWords,
  vmHostRefusal,
  vmNoneRunningWords,
  vmStateDir,
  vmVersionWords,
} from "@pinetrie/vm"

const args = process.argv.slice(2)
const unknown = args.filter(a => a !== "--force")
if (unknown.length > 0) {
  console.error(
    `[vm:build] ${unknown.join(" ")}: usage: pnpm vm:build [--force]`,
  )
  process.exit(2)
}

const stateDir = vmStateDir(process.env, homedir())
const key = imageKey(await readImageSources())
const image = imageDir(stateDir, key)
const plan = planVmBuild({
  host: vmHostRefusal({
    platform: process.platform,
    arch: process.arch,
    darwin: Number(os.release().split(".")[0]),
  }),
  image: (await checkImageDir(image)) === null,
  builder: (await gatherBinary(stateDir, BUILDER)).state,
  force: args.includes("--force"),
})

/**
 * What happens to the lane VM running, with this image: one line. A
 * launcher that cannot be asked is said, and fails nothing: the image is
 * there either way, and `pnpm build` runs this.
 */
async function sayRunningVm(): Promise<void> {
  const running = await gatherRunningVm(stateDir).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  )
  if (typeof running === "string") {
    console.log(`[vm:build] ${running}`)
    return
  }
  if (running.kind === "none") {
    console.log(`[vm:build] ${vmNoneRunningWords(key)}`)
    return
  }
  const [launcher, changedFiles] = await Promise.all([
    gatherBinary(stateDir, LAUNCHER),
    gatherChangedFiles(stateDir, running.image),
  ])
  const version = planVmVersion({
    running,
    // A launcher that refuses `status` is read as one that takes `retire`:
    // one too old for that is not told apart from it here.
    retirable: true,
    want: { image: key, launcher: path.basename(launcher.binary) },
    othersHolding: otherHolders(running.leases, "build"),
    changedFiles,
  })
  console.log(`[vm:build] ${vmVersionWords(version, "build")}`)
}

if (plan.kind === "present") {
  console.log(`[vm:build] already built: ${image}`)
  await sayRunningVm()
  process.exit(0)
}
const first =
  plan.kind === "build"
    ? await gatherBuildFirst(stateDir)
    : { compile: false, fetch: false }
const words = `[vm:build] ${vmBuildWords(plan, first)}`
if (plan.kind === "not-needed") {
  console.log(words)
  process.exit(0)
}
if (plan.kind === "refused") {
  console.error(words)
  process.exit(1)
}

console.log(words)
const started = Date.now()
const { dir, built } = await buildVmImageInVm({
  stateDir,
  force: args.includes("--force"),
  log: line => console.log(line),
})
console.log(
  built
    ? `[vm:build] built in ${((Date.now() - started) / 1000).toFixed(1)} s: ${dir}`
    : `[vm:build] built meanwhile by another process: ${dir}`,
)
for (const name of IMAGE_OUTPUTS) {
  const { size } = await stat(path.join(dir, name))
  console.log(`  ${name}: ${sizeWords(size)}`)
}
process.stdout.write(await readFile(path.join(dir, "SHA256SUMS"), "utf8"))
const pruned = await pruneVmState(stateDir)
if (pruned.length > 0)
  console.log(
    `[vm:build] removed ${pruned.length} older images, binaries and downloads`,
  )
await sayRunningVm()
