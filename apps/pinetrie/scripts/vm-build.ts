// pnpm vm:build — the lane VM's image, built in the first Linux runtime
// found (`planBuilder`), into `$XDG_STATE_HOME/pinetrie/vm/images/<key>/`.

import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { hostBytesRunner, run } from "@pinetrie/lanes"
import { buildVmImage, IMAGE_OUTPUTS, vmStateDir } from "@pinetrie/vm"
import {
  type Builder,
  builderWords,
  planBuilder,
} from "../host/work/runtime.ts"

const stateDir = vmStateDir(process.env, homedir())
const vmSocket = path.join(stateDir, "docker.sock")

const answers = async (program: string, args: readonly string[]) =>
  (await run(program, args)).ok

const builder = planBuilder({
  platform: process.platform,
  vmDocker:
    existsSync(vmSocket) &&
    (await answers("docker", ["-H", `unix://${vmSocket}`, "version"])),
  hostDocker:
    process.platform === "linux" && (await answers("docker", ["version"])),
  container: await answers("container", ["system", "status"]),
})

/** The CLI and its leading arguments that run a throwaway container. */
function runner(b: Exclude<Builder, { kind: "none" }>): readonly string[] {
  switch (b.kind) {
    case "docker-vm":
      return ["docker", "-H", `unix://${vmSocket}`, "run", "--rm"]
    case "docker-host":
      return ["docker", "run", "--rm"]
    case "container":
      return ["container", "run", "--rm"]
  }
}

if (builder.kind === "none") {
  console.error(`[vm:build] ${builderWords(builder)}`)
  process.exit(1)
}
const cli = runner(builder)
console.log(`[vm:build] building with ${builder.kind}`)
const started = Date.now()
const { dir, built } = await buildVmImage({
  stateDir,
  run: (image, argv) => hostBytesRunner()([...cli, image, ...argv]),
  log: line => console.log(`[vm:build] ${line}`),
})
console.log(
  built
    ? `[vm:build] built in ${((Date.now() - started) / 1000).toFixed(1)} s: ${dir}`
    : `[vm:build] already built: ${dir}`,
)
for (const name of IMAGE_OUTPUTS) {
  const { size } = await stat(path.join(dir, name))
  console.log(`  ${name}: ${(size / 1e6).toFixed(1)} MB`)
}
process.stdout.write(await readFile(path.join(dir, "SHA256SUMS"), "utf8"))
