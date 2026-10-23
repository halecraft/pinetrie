// e2e/lanes/memory-gate — lanes held for memory: a host given a sensor whose
// pressure the scenario sets pauses the less important of two running lanes
// at its gate, says why in the record its column reads, and lets it go on
// when the pressure clears; a run whose start is held ends at once on Stop.

import { entryId, ROOT, type ThreadId } from "@pinetrie/core"
import { treatmentWords } from "@pinetrie/interface"
import type { MachineSensor } from "@pinetrie/machine"
import { readMachineHealth, readPlaces, readRunning } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import { ancestry, messageText } from "@pinetrie/threads"
import type { Checks } from "../checks.ts"
import { type Gate, gateClose, gateCommand, newGate } from "../gate.ts"
import {
  at,
  heldEntries,
  heldTree,
  laneHolding,
  START_AGENT,
  waitFor,
} from "../harness.ts"
import { inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import { container, isRunning } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => memoryGateSection(check, lanes),
}

/** Every pressure the sensor reports, and how many samples it has given. */
interface Pressed {
  fullAvg10: number
  samples: number
}

/** The host's own sensor, its lanes real, its pressure `pressed`'s and its memory all available. */
const pressedSensor =
  (pressed: Pressed) =>
  (own: MachineSensor): MachineSensor => ({
    async sample() {
      const sample = await own.sample()
      pressed.samples++
      const { fullAvg10 } = pressed
      return {
        ...sample,
        machine: {
          ...sample.machine,
          memoryAvailable: sample.machine.memoryTotal,
          pressure: { someAvg10: fullAvg10, fullAvg10 },
        },
      }
    },
  })

async function memoryGateSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const pressed: Pressed = { fullAvg10: 0, samples: 0 }
  const h = await lanes.sectionHost({
    files: { "a.txt": "a\n" },
    machine: { wrapSensor: pressedSensor(pressed), sampleEveryMs: 100 },
  })
  try {
    const { host, script, user } = h
    const running = (lane: ThreadId | undefined) =>
      lane !== undefined && readRunning(host.live, lane)
    const treatmentOf = (lane: ThreadId | undefined) =>
      readMachineHealth(host.session)?.treatments.find(t => t.lane === lane)
        ?.treatment ?? null
    /** The tool results on the path to `lane`'s tip, oldest first. */
    const resultsIn = (text: string) => {
      const tip = laneHolding(host, readPlaces(host.places), text)?.tip ?? null
      const onPath = new Set(ancestry(heldTree(host), tip).path)
      return Object.values(heldEntries(host))
        .filter(r => onPath.has(entryId(r.id)))
        .map(r => rowMessage(r) as { role?: string })
        .filter(m => m.role === "toolResult")
    }
    /** Samples taken from now until `count` more have been. */
    const samplesPast = async (count: number) => {
      const from = pressed.samples
      return (await waitFor(() => pressed.samples >= from + count, 30_000)) >= 0
    }

    /** `text`'s run, its lane holding its command at `gate`: its lane, once that command runs. */
    const holding = async (text: string, gate: Gate) => {
      script.use([{ tool: "bash", args: { command: gateCommand(gate) } }])
      await user.send(text, ROOT, START_AGENT)
      let lane: ThreadId | undefined
      const ran = await waitFor(async () => {
        lane = h.laneWith(text)?.name
        return (
          lane !== undefined &&
          (await inLaneQuiet(lane, `test -p ${gate.fifo} && echo held`)) ===
            "held\n"
        )
      }, 120_000)
      return { lane, ran }
    }
    // Two runs, each holding a command in its lane: both lanes run. The
    // second is scripted only once the first's command runs, as the model
    // answers each request from the one script.
    const gates = { a: newGate("mem-a"), b: newGate("mem-b") }
    const a = await holding("start a", gates.a)
    const b = await holding("start b", gates.b)
    const laneA = a.lane
    const laneB = b.lane
    const bothRunning = Math.min(a.ran, b.ran)

    // Pressure past rung 3: once it holds, one lane of the two is paused.
    pressed.fullAvg10 = 15
    await waitFor(
      () =>
        treatmentOf(laneA)?.kind === "paused" ||
        treatmentOf(laneB)?.kind === "paused",
      60_000,
    )
    const [paused, going] =
      treatmentOf(laneA)?.kind === "paused"
        ? ([
            { lane: laneA, gate: gates.a, text: "start a" },
            { lane: laneB, gate: gates.b, text: "start b" },
          ] as const)
        : ([
            { lane: laneB, gate: gates.b, text: "start b" },
            { lane: laneA, gate: gates.a, text: "start a" },
          ] as const)
    // The paused lane's command ends; its next one waits at the gate.
    script.use([
      { tool: "bash", args: { command: "echo after-the-pause" } },
      { text: "done" },
    ])
    if (paused.lane !== undefined)
      await inLaneQuiet(paused.lane, gateClose(paused.gate))
    const firstEnded = await waitFor(
      () => resultsIn(paused.text).length >= 1,
      60_000,
    )
    const waited = firstEnded >= 0 && (await samplesPast(10))
    const heldResults = resultsIn(paused.text).length
    const treatment = treatmentOf(paused.lane)
    pressed.fullAvg10 = 0
    const wentOn = await waitFor(
      () => resultsIn(paused.text).length >= 2,
      120_000,
    )
    check(
      "a paused lane's call waits at its gate",
      bothRunning >= 0 && waited && heldResults === 1 && wentOn >= 0,
      `both running ${bothRunning}, results while paused ${heldResults}, went on ${wentOn}; ${JSON.stringify(["start a", "start b"].map(t => resultsIn(t).map(m => messageText(m as never).slice(0, 80))))}`,
    )
    check(
      "a paused lane's column says why it waits",
      treatment !== null &&
        treatmentWords(treatment) ===
          "paused for memory: its next tool call waits for room",
      `${treatment?.kind ?? "none"}; ${JSON.stringify(readMachineHealth(host.session)?.treatments)}; ${laneA} ${laneB}`,
    )
    // A run's start held for room, its first call behind it: Stop ends it.
    // Its lane's container stopped first, and memory calm again, so the
    // start meets a rung entered afresh.
    const memoryShort = () =>
      readMachineHealth(host.session)?.causes.some(
        c => c.kind === "memory-short",
      ) === true
    await waitFor(
      async () =>
        !running(paused.lane) &&
        paused.lane !== undefined &&
        !(await isRunning(container(paused.lane))) &&
        !memoryShort(),
      120_000,
    )
    pressed.fullAvg10 = 15
    await waitFor(memoryShort, 60_000)
    script.use([
      { tool: "bash", args: { command: "echo never-ran" } },
      { text: "stopped" },
    ])
    const tip = laneHolding(host, readPlaces(host.places), paused.text)?.tip
    await user.send("once more", at(tip ?? null), { thread: paused.lane })
    const held = await waitFor(
      () => treatmentOf(paused.lane)?.kind === "waiting-to-start",
      60_000,
    )
    // Not awaited: a Stop that waits for room would never answer.
    let stopped: { readonly kind: string } | undefined
    if (paused.lane !== undefined)
      void user.request({ kind: "stop", lane: paused.lane }).then(answer => {
        stopped = answer
      })
    const ended = await waitFor(
      () => stopped !== undefined && !running(paused.lane),
      30_000,
    )
    const last = resultsIn(paused.text).at(-1)
    const lastText = last === undefined ? "" : messageText(last as never)
    check(
      "Stop is never held",
      held >= 0 &&
        stopped?.kind === "stopped" &&
        ended >= 0 &&
        !lastText.includes("never-ran"),
      `held ${held}, stop ${stopped?.kind ?? "none"}, ended ${ended}, last result ${lastText.slice(0, 60)}`,
    )
    pressed.fullAvg10 = 0
    if (going.lane !== undefined)
      await inLaneQuiet(going.lane, gateClose(going.gate))
    await h.idle()
  } finally {
    await h.close()
  }
}
