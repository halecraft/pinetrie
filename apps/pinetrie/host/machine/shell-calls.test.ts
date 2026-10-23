import { threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { createShellCalls, type ShellCallEnded } from "./shell-calls.ts"

const lane = threadIdFor("t-1")

test("a call's program is in flight from its start to its end, and its end is timed", () => {
  let now = 100
  const ended: ShellCallEnded[] = []
  const calls = createShellCalls({ now: () => now, ended: c => ended.push(c) })
  const end = calls.shellStarted(lane, "cd packages/x && pnpm test --run")
  expect(calls.programInFlight(lane)).toBe("pnpm")
  now = 1600
  end("exited")
  end("exited")
  expect(calls.programInFlight(lane)).toBeNull()
  expect(ended).toEqual([
    {
      lane,
      program: "pnpm",
      startedAt: 100,
      durationMs: 1500,
      outcome: "exited",
    },
  ])
})

test("with two calls in flight, the latest started is the lane's program", () => {
  const calls = createShellCalls({ now: () => 0, ended: () => {} })
  const first = calls.shellStarted(lane, "tsc --noEmit")
  const second = calls.shellStarted(lane, "vitest run")
  expect(calls.programInFlight(lane)).toBe("vitest")
  second("exited")
  expect(calls.programInFlight(lane)).toBe("tsc")
  first("aborted")
  expect(calls.programInFlight(lane)).toBeNull()
})
