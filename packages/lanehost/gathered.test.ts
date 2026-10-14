import type {
  FoldNotices,
  PathTrace,
  RunNotice,
  RunTrace,
  RunTraces,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  drainEnded,
  drainStarted,
  foldedWith,
  type Gathered,
  isBatchFull,
  MIN_BATCH,
  newGathered,
} from "./gathered.ts"

const READ: PathTrace = {
  before: true,
  wrote: false,
  read: true,
  missed: false,
  dir: false,
  reportedWrite: false,
  reportedRead: false,
  reportedMissing: false,
}

/** A run's trace with `paths`, for a fold that only records what it was given. */
const traceOf = (id: string, paths: readonly string[]): RunTrace => ({
  id,
  command: null,
  exit: null,
  ended: false,
  lost: 0,
  paths: new Map(paths.map(p => [p, READ])),
  dirty: new Set(),
  accesses: [],
  changed: true,
})

/** A fold that records each notice's run as a path of run "all". */
const counting: FoldNotices = (traces, batch) => {
  const before = [...(traces.get("all")?.paths.keys() ?? [])]
  return new Map(traces).set(
    "all",
    traceOf("all", [...before, ...batch.map(n => n.run)]),
  )
}
const notice = (run: string): RunNotice => ({
  run,
  event: { kind: "end", at: 0 },
})
const pathsOf = (traces: RunTraces) => [
  ...(traces.get("all")?.paths.keys() ?? []),
]
const sized = (size: number): Gathered => ({
  ...newGathered(),
  size,
})

describe("gathered", () => {
  test("a batch is folded once it holds as many notices as the traces, and never fewer than the least", () => {
    expect(isBatchFull(sized(0), MIN_BATCH - 1)).toBe(false)
    expect(isBatchFull(sized(0), MIN_BATCH)).toBe(true)
    expect(isBatchFull(sized(10 * MIN_BATCH), MIN_BATCH)).toBe(false)
    expect(isBatchFull(sized(10 * MIN_BATCH), 10 * MIN_BATCH)).toBe(true)
  })

  test("no batch is folded while a drain runs", () => {
    const draining = drainStarted(sized(0), [], counting)
    expect(isBatchFull(draining, 100 * MIN_BATCH)).toBe(false)
  })

  test("notices that arrive during a drain are folded onto what it returns", () => {
    const g = drainStarted(newGathered(), [notice("a")], counting)
    expect(pathsOf(g.traces)).toEqual(["a"])
    const returned: RunTraces = new Map([["all", traceOf("all", ["kept"])]])
    const after = drainEnded(g, returned, [notice("late")], counting)
    expect(pathsOf(after.traces)).toEqual(["kept", "late"])
    expect(after.draining).toBe(false)
  })

  test("a drain that throws leaves the traces it was given, with what arrived since", () => {
    const g = drainStarted(newGathered(), [notice("a")], counting)
    const after = drainEnded(g, null, [notice("late")], counting)
    expect(pathsOf(after.traces)).toEqual(["a", "late"])
  })

  test("a transition leaves the state it was given as it was", () => {
    const g = foldedWith(newGathered(), [notice("a")], counting)
    const snapshot = { ...g, traces: new Map(g.traces) }
    foldedWith(g, [notice("b")], counting)
    drainEnded(drainStarted(g, [notice("c")], counting), null, [], counting)
    expect(g).toEqual(snapshot)
  })
})
