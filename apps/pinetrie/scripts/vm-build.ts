// pnpm vm:build [--force] — the lane VM's image, built on the Mac in a VM of
// its own into `$XDG_STATE_HOME/pinetrie/vm/images/<key>/`. Elsewhere no
// lane VM runs, and it says so. Exits 0 when the image is there or not
// needed, 1 when it cannot be built.

import { readFile, stat } from "node:fs/promises"
import os, { homedir } from "node:os"
import path from "node:path"
import {
  BUILDER,
  buildVmImageInVm,
  checkImageDir,
  gatherBinary,
  gatherBuildFirst,
  IMAGE_OUTPUTS,
  imageDir,
  imageKey,
  planVmBuild,
  pruneVmState,
  readImageSources,
  vmBuildWords,
  vmHostRefusal,
  vmStateDir,
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
const image = imageDir(stateDir, imageKey(await readImageSources()))
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

if (plan.kind === "present") {
  console.log(`[vm:build] already built: ${image}`)
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
  console.log(`  ${name}: ${(size / 1e6).toFixed(1)} MB`)
}
process.stdout.write(await readFile(path.join(dir, "SHA256SUMS"), "utf8"))
const pruned = await pruneVmState(stateDir)
if (pruned.length > 0)
  console.log(
    `[vm:build] removed ${pruned.length} older images, binaries and downloads`,
  )
