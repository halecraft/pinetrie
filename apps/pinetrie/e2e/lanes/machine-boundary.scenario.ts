// e2e/lanes/machine-boundary — the machine's boundary, in a lane VM of the
// scenario's own, built from this checkout's launcher and image: the
// kernel holds the observer and a lane to their kinds' process limits and
// CPU weights, and the services' parent to its floor, as the Machine page
// says; then a lane thrashing at its own memory limit is a cause naming its
// thread, while the gate, reading no machine-wide reclaim, holds nothing.

import { rmSync } from "node:fs"
import {
  type Containment,
  type MachinePageFacts,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import {
  CONTAINER_LIMITS,
  cpuWeightOfShares,
  HOST_CGROUP,
  LANEHOST_LABEL,
  servicesFloorBytes,
} from "@pinetrie/docker"
import { SERVICES_CGROUP } from "@pinetrie/lanehost"
import { readMachineHealth } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import { gateClose, gateCommand, newGate } from "../gate.ts"
import { START_AGENT, waitFor } from "../harness.ts"
import { inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import { cli, container } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"
import { ownVm } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  requires: ["lane-vm"],
  run: ({ check }, { lanes }) => run(check, lanes),
}

/**
 * A process thrashing at its own cgroup's memory limit while the machine
 * has room: anonymous memory near the lane's 4 GiB, and files read over and
 * over through one buffer, so its page cache is what the kernel reclaims
 * and reads back, inside the lane's limit alone.
 */
const THRASH = `import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs"
const [seconds, anonMiB, fileMiB] = process.argv.slice(2).map(Number)
const dir = "/workspace/.thrash"
mkdirSync(dir, { recursive: true })
for (let i = 0; i < fileMiB / 16; i++) writeFileSync(dir + "/f" + i, Buffer.alloc(16 << 20, i + 1))
const held = []
for (let i = 0; i < anonMiB / 16; i++) held.push(Buffer.alloc(16 << 20).fill(i + 1))
const chunk = Buffer.alloc(1 << 20)
const end = Date.now() + seconds * 1000
while (Date.now() < end)
  for (let i = 0; i < fileMiB / 16; i++) {
    const fd = openSync(dir + "/f" + i, "r")
    while (readSync(fd, chunk, 0, chunk.length, null) > 0);
    closeSync(fd)
  }
console.log("held", held.length)
`

/**
 * The samples read while the lane thrashes: two minutes at the scenario's
 * sample of a second. The lane thrashes past them, and is stopped after.
 */
const WATCHED_SAMPLES = 120
const THRASH_SECONDS = 600

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // Nothing new lands in the person's state: the launcher and the image
  // are built under the scenario's own, only the builder shared.
  const own = ownVm({ share: ["builder"] })
  if (own === null) throw new Error("the lane VM runs on the Mac")
  try {
    let sampled = 0
    const h = await lanes.sectionHost({
      files: { "a.txt": "a\n" },
      machine: {
        // The host's own sensor, its samples counted.
        wrapSensor: own => ({
          async sample() {
            const sample = await own.sample()
            sampled++
            return sample
          },
        }),
        sampleEveryMs: 1000,
        readingOverdueAfterTicks: 300,
      },
    })
    const gate = newGate("boundary")
    let lane: ThreadId | undefined
    try {
      const { host, script, user } = h
      const facts = async (): Promise<MachinePageFacts | null> => {
        const answered = await fetch(new URL("/machine", host.httpUrl)).catch(
          () => null,
        )
        return answered?.ok === true
          ? ((await answered.json()) as MachinePageFacts | null)
          : null
      }

      // A run holding a command in its lane: the lane's container runs.
      script.use([{ tool: "bash", args: { command: gateCommand(gate) } }])
      await user.send("hold the lane", ROOT, START_AGENT)
      await waitFor(async () => {
        lane = h.laneWith("hold the lane")?.name
        return (
          lane !== undefined &&
          (await inLaneQuiet(lane, `test -p ${gate.fifo} && echo held`)) ===
            "held\n"
        )
      }, 600_000)
      const running = lane
      if (running === undefined) throw new Error("no lane held the run")

      // 1. What the kernel was asked, read back from the cgroups through the
      // disks role's tree, and what the page says of it.
      const id = async (name: string) =>
        (await cli(["inspect", "-f", "{{.Id}}", name])).trim()
      const disks = (
        await cli([
          "ps",
          "--filter",
          `label=${LANEHOST_LABEL}=disks`,
          "--format",
          "{{.Names}}",
        ])
      ).trim()
      const observer = (
        await cli([
          "ps",
          "--filter",
          "name=pinetrie-observer-",
          "--format",
          "{{.Names}}",
        ])
      ).trim()
      const laneId = await id(container(running))
      const observerId = await id(observer)
      const read = (file: string) =>
        cli(["exec", disks, "cat", `${HOST_CGROUP}/${file}`]).then(
          t => t.trim(),
          () => "unread",
        )
      const services = `${SERVICES_CGROUP}/${observerId}`
      const readBack = {
        floor: await read(`${SERVICES_CGROUP}/memory.low`),
        observerProcesses: await read(`${services}/pids.max`),
        observerWeight: await read(`${services}/cpu.weight`),
        laneProcesses: await read(`docker/${laneId}/pids.max`),
        laneWeight: await read(`docker/${laneId}/cpu.weight`),
      }
      const wanted = {
        floor: String(servicesFloorBytes()),
        observerProcesses: String(CONTAINER_LIMITS.observer.processesMax),
        observerWeight: String(
          cpuWeightOfShares(CONTAINER_LIMITS.observer.cpuShares),
        ),
        laneProcesses: String(CONTAINER_LIMITS.lane.processesMax),
        laneWeight: String(cpuWeightOfShares(CONTAINER_LIMITS.lane.cpuShares)),
      }
      // A sample that read the lane running, each read once as it ends.
      let containment: Containment | null = null
      let pageSeen = sampled
      await waitFor(async () => {
        if (sampled === pageSeen) return false
        pageSeen = sampled
        const f = await facts()
        containment =
          f?.reading.kind === "sampled" &&
          f.reading.lanes.some(l => l.lane === running)
            ? f.reading.containment
            : null
        return containment?.kind === "contained"
      }, 60_000)
      const contained =
        (containment as Containment | null)?.kind === "contained"
      check(
        "the kernel holds each container to its kind's limits",
        JSON.stringify(readBack) === JSON.stringify(wanted) && contained,
        JSON.stringify({ readBack, wanted, containment }),
      )

      // 2. The lane thrashing at its own limit, sample after sample.
      await inLaneQuiet(
        running,
        `cat > /workspace/.thrash.mjs <<'EOF'\n${THRASH}EOF\nnohup node /workspace/.thrash.mjs ${THRASH_SECONDS} 3584 512 > /tmp/thrash.log 2>&1 < /dev/null &`,
      )
      let rungMost = 0
      let named = false
      const from = sampled
      let seen = from
      await waitFor(async () => {
        // Each sample's page read once, as it ends.
        if (sampled === seen) return false
        seen = sampled
        const f = await facts()
        if (f?.reading.kind === "sampled")
          rungMost = Math.max(rungMost, f.reading.memory.rung)
        named ||=
          readMachineHealth(host.session)?.causes.some(
            c =>
              c.kind === "cgroup-at-limit" &&
              c.subject.kind === "lane" &&
              c.subject.lane === running,
          ) ?? false
        return sampled >= from + WATCHED_SAMPLES
      }, 900_000)
      const samples = sampled - from
      const thrashed = await inLaneQuiet(
        running,
        "cat /tmp/thrash.log; pkill -f thrash.mjs; true",
      )
      check(
        "a lane stuck at its limit is a cause, and holds nothing",
        named && rungMost === 0,
        `named ${named}, highest rung ${rungMost} in ${samples} samples; ${thrashed.trim()}; health ${JSON.stringify(readMachineHealth(host.session)?.causes)}`,
      )
    } finally {
      if (lane !== undefined)
        await inLaneQuiet(lane, `pkill -f thrash.mjs; ${gateClose(gate)}`)
      await h.close()
    }
  } finally {
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
