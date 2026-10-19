// e2e/lanes/vm-image — the Mac builds the lane VM's image with no Docker
// engine, in a VM of its own, and a lease boots it. What a build decides is
// `packages/vm`'s, unit-tested; this proves the builder, its initrd and the
// guest's `/init` do it, Docker's config the image carries among it. Its own
// state directory starts with no image, and shares only the person's
// binaries and the pinned downloads.

import { rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildVmImageInVm,
  checkImageDir,
  gatherChangedFiles,
  gatherRunningVm,
  leaseExtra,
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
    // No record reads as null; a record unlike the sources lists files.
    const changed = await gatherChangedFiles(stateDir, path.basename(dir))
    check(
      "the built image records its sources' hashes",
      changed?.length === 0,
      JSON.stringify(changed),
    )
    // A lease that fails is the check's failure, not the scenario's error.
    const booted = await leaseVm({
      stateDir,
      slots: 2,
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
        const policy = await command("docker", [
          "-H",
          `unix://${lease.docker}`,
          "buildx",
          "inspect",
          "--bootstrap",
        ]).catch((error: unknown) => String(error))
        // Asked while this lease is held, so a status that took a slot
        // would count two leases.
        const status = await gatherRunningVm(stateDir).then(
          r => r,
          (error: unknown) => String(error),
        )
        const extra = await leaseExtra({
          stateDir,
          dirs: [],
          sweep: async () => {},
          log: l => lines.push(l),
        }).then(
          e => e,
          (error: unknown) => String(error),
        )
        const extraSlot = typeof extra === "string" ? extra : extra.fill.slot
        if (typeof extra !== "string") await extra.close()
        await lease.close()
        return {
          ok: os === "linux" && image === path.basename(dir),
          said: `${os} ${image}`,
          policy,
          untaken:
            typeof status !== "string" &&
            status.kind === "running" &&
            status.image === path.basename(dir) &&
            status.leases === 1 &&
            extraSlot === 1,
          status: `${JSON.stringify(status)}; the next lease: slot ${extraSlot}`,
        }
      },
      (error: unknown) => ({
        ok: false,
        said: String(error),
        policy: String(error),
        untaken: false,
        status: String(error),
      }),
    )
    check("a lease boots the image it built", booted.ok, booted.said)
    check(
      "the booted VM's Docker caps BuildKit's cache beside its images",
      /Max Used Space:\s+512MiB/.test(booted.policy),
      booted.policy
        .split("\n")
        .filter(l => /Space/.test(l))
        .join("; "),
    )
    check(
      "a status names the booted image and its one lease, and takes no slot",
      booted.untaken,
      booted.status,
    )
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
