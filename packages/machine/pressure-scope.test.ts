import { describe, expect, test } from "vitest"
import { pressureScope } from "./pressure-scope.ts"
import type { MachineSample } from "./sample.ts"

type Machine = MachineSample["machine"]
const GiB = 1024 ** 3
const pressure = { someAvg10: 20, fullAvg10: 18 }
const before = { allocStalls: 10, scannedDirect: 500, scannedByKswapd: 9000 }

const machine = (over: Partial<Machine> = {}): Machine => ({
  memoryTotal: 8 * GiB,
  memoryAvailable: 7 * GiB,
  pressure,
  counters: null,
  reclaim: before,
  limitHits: null,
  source: "whole-machine",
  ...over,
})

describe("pressureScope", () => {
  test("a host's own cgroup's pressure is the machine's, whatever reclaim it is given", () => {
    const own = machine({ source: "own-cgroup" })
    expect(pressureScope({ machine: own, reclaimBefore: before })).toEqual({
      kind: "machine",
      pressure,
    })
  })

  test("a stall with the machine's tasks stalled to reclaim is the machine's", () => {
    const now = machine({ reclaim: { ...before, allocStalls: 11 } })
    expect(pressureScope({ machine: now, reclaimBefore: before }).kind).toBe(
      "machine",
    )
  })

  test("a stall with direct reclaim scanning is the machine's", () => {
    const now = machine({ reclaim: { ...before, scannedDirect: 501 } })
    expect(pressureScope({ machine: now, reclaimBefore: before }).kind).toBe(
      "machine",
    )
  })

  test("a stall with only kswapd scanning is contained", () => {
    const now = machine({ reclaim: { ...before, scannedByKswapd: 99_000 } })
    expect(pressureScope({ machine: now, reclaimBefore: before })).toEqual({
      kind: "contained",
      pressure,
    })
  })

  test("a stall with no reclaim before to compare is the machine's", () => {
    expect(
      pressureScope({ machine: machine(), reclaimBefore: null }).kind,
    ).toBe("machine")
    const unread = machine({ reclaim: null })
    expect(pressureScope({ machine: unread, reclaimBefore: before }).kind).toBe(
      "machine",
    )
  })

  test("a machine without PSI is unmeasured", () => {
    const now = machine({ pressure: null })
    expect(pressureScope({ machine: now, reclaimBefore: before })).toEqual({
      kind: "unmeasured",
    })
  })
})
