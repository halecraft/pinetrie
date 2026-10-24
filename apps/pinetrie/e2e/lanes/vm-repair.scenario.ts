// e2e/lanes/vm-repair — a lane VM whose data disk is full is repaired
// offline: the host's own repair controls stop the VM through its launcher,
// take the launcher's lock, grow the disk, boot the repair on it, and let it
// go, and the lease the scenario keeps starts the VM again on the repaired
// disk. When a host repairs (its triggers, the shared state, the lanes it
// holds) is the machine package's, unit-tested; this proves the boot, the
// locks and the launcher do it. Its own state directory shares the person's
// image, binaries and pinned downloads, and has a 2 GiB data disk of its own,
// filled as the lane VM's was: data chunks half empty, metadata at its end.

import { rmSync } from "node:fs"
import { truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { servicesFloorBytes } from "@pinetrie/docker"
import {
  LEAVE_FREE_DEFAULT,
  planStoreCapabilities,
  planStoreSize,
  type RepairState,
  runRepairSteps,
} from "@pinetrie/machine"
import {
  ensureRepairBoot,
  keepLease,
  type Lease,
  leaseVm,
  readRepairFacts,
  vmStateDir,
} from "@pinetrie/vm"
import { laneVmRepairControls } from "../../host/machine/repair.ts"
import type { Checks } from "../checks.ts"
import { command, commandOutput } from "../command.ts"
import { waitFor } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { ownVm } from "./support.ts"

export const scenario: Scenario = {
  requires: ["lane-vm"],
  run: ({ check }) => run(check),
}

const ALPINE_IMAGE = "docker.io/library/alpine:3.23"
const GiB = 1024 ** 3

/**
 * Fills the container's own layer, on the data disk, as the lane VM's was
 * found: 1 MiB files until none fits, every other one removed so data
 * chunks are half empty, then small files until metadata refuses one.
 */
const FILL = `W=/fill; mkdir -p $W/big $W/small
i=0; while dd if=/dev/zero of=$W/big/$i bs=1M count=1 2>/dev/null; do i=$((i+1)); done; sync
j=0; while [ $j -lt $i ]; do rm -f $W/big/$j; j=$((j+2)); done; sync
n=0; while [ $n -lt 500000 ]; do mkdir -p $W/small/$((n/1000)) 2>/dev/null; head -c 1000 /dev/urandom > $W/small/$((n/1000))/$n 2>/dev/null || break; n=$((n+1)); done
sync; echo "data files $i, small files $n"`

async function run(check: Checks["check"]): Promise<void> {
  const own = ownVm({ share: ["images", "bin", "builder"] })
  if (own === null) throw new Error("the lane VM is repaired on the Mac")
  const stateDir = vmStateDir(process.env, os.homedir())
  const lines: string[] = []
  const log = (l: string) => {
    lines.push(l)
    if (process.env.PINETRIE_E2E_LOG === "1") console.log(l)
  }
  const lease = () =>
    leaseVm({
      stateDir,
      slots: 1,
      agent: null,
      log,
      servicesFloorBytes: servicesFloorBytes(),
      onStartWaiting: () => log("[vm] waiting for the repair lock"),
    })
  // Made before the first start, so the launcher makes no 256 GiB one and
  // the guest formats this.
  await writeFile(path.join(stateDir, "data.img"), "")
  await truncate(path.join(stateDir, "data.img"), 2 * GiB)
  let kept: { close(): Promise<void>; current(): Lease } | null = null
  try {
    const first = await lease()
    kept = keepLease({ first, lease, settle: async () => {}, log })
    const docker = (...args: string[]) =>
      commandOutput("docker", ["-H", `unix://${first.docker}`, ...args])
    await docker("pull", "-q", ALPINE_IMAGE)
    const filled = await docker(
      "run",
      "--name",
      "pinetrie-fill",
      ALPINE_IMAGE,
      "sh",
      "-c",
      FILL,
    )
    log(`[scenario] ${filled.trim()}`)
    await ensureRepairBoot(stateDir)

    // The host's controls, growing the disk as a host's start would.
    const controls = laneVmRepairControls({
      stateDir,
      growData: facts =>
        planStoreSize(
          facts,
          { max: null, leaveFree: LEAVE_FREE_DEFAULT },
          planStoreCapabilities("lane-vm"),
        ),
      log,
    })
    const states: RepairState[] = []
    const read = await readRepairFacts(stateDir)
    const repaired = await runRepairSteps(
      controls,
      {
        asked: {
          kind: "trigger",
          trigger: "room-spent-and-nothing-to-delete",
          plannedSize: Number.MAX_SAFE_INTEGER,
        },
        seen: read.text,
      },
      (_from, to) => states.push(to),
    ).catch((error: unknown) => String(error))
    const found = lines.find(l => l.includes("[repair] found"))
    const left = lines.find(l => l.includes("[repair] left"))
    check(
      "a full lane VM disk is repaired offline, its VM stopped for it",
      typeof repaired !== "string" &&
        repaired.kind === "ran" &&
        repaired.state.kind === "done",
      [
        typeof repaired === "string" ? repaired : JSON.stringify(repaired),
        states.map(s => s.kind).join(" → "),
        found ?? "no room found",
        left ?? "no room left",
      ].join("\n"),
    )

    // The lease kept starts the VM again, on the repaired disk.
    const isBack = await waitFor(() => kept?.current() !== first, 120_000).then(
      () => true,
      () => false,
    )
    const back = isBack ? (kept?.current() ?? null) : null
    const wrote =
      back === null
        ? "the lease was not taken again"
        : await commandOutput("docker", [
            "-H",
            `unix://${back.docker}`,
            "run",
            "--rm",
            ALPINE_IMAGE,
            "sh",
            "-c",
            "dd if=/dev/zero of=/x bs=1M count=256 2>/dev/null && echo wrote",
          ])
    check(
      "the VM starts again on the repaired disk, and a container writes to it",
      wrote.trim() === "wrote",
      wrote.trim().slice(-300),
    )
  } finally {
    await kept?.close().catch(() => {})
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
