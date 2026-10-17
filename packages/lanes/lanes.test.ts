import { type RunSource, snapshotId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { execute } from "./execute.ts"
import { HELPER, helperCommand, laneHandle } from "./lane.ts"
import type { Step } from "./plan.ts"
import type { Ran, Runner } from "./run.ts"
import { runtimeNode } from "./runtime.ts"
import type { LaneRuntime } from "./runtime-port.ts"

/** A lane no observer sees: no run did anything. */
const unobserved: RunSource = {
  drain: async drain => (await drain(new Map())).result,
}

// What a lane runs against jj itself, in throwaway repos, with your repo in
// it, is `@pinetrie/jj`'s `repo.test.ts`: every such test fetches into your
// repo.

const LANE = threadIdFor("1")

/** A runtime that records each call it is asked to make, and makes none. */
function recordingRuntime(seen: string[]): LaneRuntime {
  const no = () => {
    throw new Error("not recorded")
  }
  return {
    disk: async op => {
      seen.push(`disk: ${op.kind}`)
    },
    run: async shape => {
      seen.push(`run: ${shape.name}`)
    },
    execArgv: (container, argv) => ["exec", container, ...argv],
    diskExists: no,
    snapshotExists: no,
    snapshots: no,
    diff: no,
    readLaneFile: no,
    runSpec: no,
    containerFacts: no,
    observe: no,
    start: no,
    stop: no,
    remove: no,
    imageExists: no,
    buildImage: no,
    imagePath: no,
    runInImage: no,
  }
}

describe("execute", () => {
  const ok: Ran = { ok: true, code: 0, stdout: "", stderr: "" }
  test("runs each step where it says, in order, and stops at the first lane step that fails", async () => {
    const seen: string[] = []
    const lane: Runner = async argv => {
      seen.push(`lane: ${argv.join(" ")}`)
      return argv[0] === "bad"
        ? { ok: false, code: 1, stdout: "", stderr: "no" }
        : ok
    }
    const steps: Step[] = [
      { in: "runtime", op: { kind: "create", lane: LANE } },
      { in: "lane", argv: ["sync"] },
      {
        in: "runtime",
        op: { kind: "snapshot", lane: LANE, snapshot: snapshotId("s") },
      },
      { in: "lane", argv: ["bad"] },
      { in: "runtime", op: { kind: "delete", lane: LANE } },
    ]
    const done = await execute(steps, {
      runtime: recordingRuntime(seen),
      lane,
      laneBytes: async () => ({ ...ok, stdout: new Uint8Array() }),
    })
    expect(seen).toEqual([
      "disk: create",
      "lane: sync",
      "disk: snapshot",
      "lane: bad",
    ])
    expect(done).toMatchObject({ ok: false, step: steps[3] })
  })
})

test("helperCommand: the runtime's exec of the helper on the lane runtime's Node", () => {
  expect(helperCommand(recordingRuntime([]), "pinetrie-t-1")).toEqual([
    "exec",
    "pinetrie-t-1",
    ...runtimeNode(HELPER),
  ])
})

describe("laneHandle.start", () => {
  const counting = (state: "running" | "stopped") => {
    const seen: string[] = []
    const runtime: LaneRuntime = {
      ...recordingRuntime(seen),
      containerFacts: async () => {
        seen.push("inspect")
        return { state, label: null }
      },
      start: async name => {
        seen.push(`start ${name}`)
      },
    }
    const handle = laneHandle(runtime, "pinetrie-t-1", async () => ({
      channel: null,
      runs: unobserved,
      run: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
      bytes: async () => ({
        ok: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: "",
      }),
      close: async () => {},
      closed: new Promise<void>(() => {}),
    }))
    return { seen, handle }
  }
  test("asks the container's state only when the caller does not know it", async () => {
    const asked = counting("stopped")
    await asked.handle.start()
    expect(asked.seen).toEqual(["inspect", "start pinetrie-t-1"])
    const known = counting("stopped")
    await known.handle.start("running")
    await known.handle.start("stopped")
    expect(known.seen).toEqual(["start pinetrie-t-1"])
  })
})

describe("laneHandle.link", () => {
  const link = (closed: Promise<void>) => ({
    channel: null,
    runs: unobserved,
    run: async () => ({ ok: true as const, code: 0, stdout: "", stderr: "" }),
    bytes: async () => ({
      ok: true as const,
      code: 0,
      stdout: new Uint8Array(),
      stderr: "",
    }),
    close: async () => {},
    closed,
  })
  test("a link that failed to open, or whose helper exited, is opened again", async () => {
    let opens = 0
    let exit: () => void = () => {}
    const handle = laneHandle(
      recordingRuntime([]),
      "pinetrie-t-1",
      async () => {
        opens++
        if (opens === 1) throw new Error("no helper")
        return link(new Promise<void>(r => (exit = r)))
      },
    )
    await expect(handle.link()).rejects.toThrow("no helper")
    const second = await handle.link()
    expect(await handle.link()).toBe(second)
    exit()
    await new Promise(r => setTimeout(r, 0))
    expect(await handle.link()).not.toBe(second)
    expect(opens).toBe(3)
  })
})
