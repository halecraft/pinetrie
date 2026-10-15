// e2e/lanes/vm-image — the Mac builds the lane VM's image with no Docker
// engine, in a VM of its own, and a lease boots it. What a build decides is
// `packages/vm`'s, unit-tested; this proves the builder, its initrd and the
// guest's `/init` do it. Its own state directory starts with no image, and
// shares only the person's binaries and the pinned downloads.

import { rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildVmImageInVm,
  checkImageDir,
  leaseVm,
  vmHostRefusal,
  vmStateDir,
  vmWords,
} from "@pinetrie/vm"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import { waitFor } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { ownVm } from "./support.ts"

export const scenario: Scenario = {
  needs: async () => {
    const host = vmHostRefusal({
      platform: process.platform,
      arch: process.arch,
      darwin: Number(os.release().split(".")[0]),
    })
    return host === null ? null : vmWords(host)
  },
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const own = ownVm({ share: ["bin", "builder"] })
  if (own === null) throw new Error("the lane VM's image is built on the Mac")
  const stateDir = vmStateDir(process.env, os.homedir())
  const lines: string[] = []
  try {
    // A build that fails is the check's failure, not the scenario's error.
    const dir = await buildVmImageInVm({
      stateDir,
      force: true,
      log: l => lines.push(l),
    }).then(
      b => b.dir,
      (error: unknown) => {
        lines.push(String(error))
        return null
      },
    )
    check(
      "the Mac builds the lane VM's image with no Docker engine",
      dir !== null &&
        (await checkImageDir(dir)) === null &&
        lines.includes("[builder] built"),
      lines.slice(-5).join("\n"),
    )
    if (dir === null) return
    // A lease that fails is the check's failure, not the scenario's error.
    const booted = await leaseVm({
      stateDir,
      slots: 1,
      agent: null,
      log: l => lines.push(l),
    }).then(
      async lease => {
        const os = (
          await command("docker", [
            "-H",
            `unix://${lease.docker}`,
            "version",
            "--format",
            "{{.Server.Os}}",
          ])
        ).trim()
        const image = lease.identity.image
        await lease.close()
        return {
          ok: os === "linux" && image === path.basename(dir),
          said: `${os} ${image}`,
        }
      },
      (error: unknown) => ({ ok: false, said: String(error) }),
    )
    check("a lease boots the image it built", booted.ok, booted.said)
  } finally {
    // A lease that failed may leave its launcher holding the connection, so
    // it is stopped rather than left to idle out.
    await command("sh", [
      "-c",
      `pkill -TERM -f 'launcher-.* ${own.state}' || true`,
    ])
    await waitFor(
      async () =>
        (
          await command("sh", ["-c", `pgrep -f '${own.state}' || true`])
        ).trim() === "",
      30_000,
    ).catch(() => {})
    own.restore()
    rmSync(own.state, { recursive: true, force: true })
  }
}
