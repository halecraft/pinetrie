import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { CONFLICT_ASK, planConflictAsk } from "./conflict-ask.ts"
import { setRecord } from "./records.ts"

const LANE = threadIdFor("0123456789abcdef")

describe("planConflictAsk", () => {
  test("a copy with a conflict is asked about, and the ask recorded at now", () => {
    expect(planConflictAsk(LANE, ["a.txt"], 7)).toEqual({
      asked: true,
      writes: [setRecord(CONFLICT_ASK, { lane: LANE, at: 7 })],
    })
  })

  test("a copy with no conflict asks nothing and records nothing", () => {
    expect(planConflictAsk(LANE, [], 7)).toEqual({ asked: false, writes: [] })
  })

  test("the record decodes as it was written", () => {
    const [write] = planConflictAsk(LANE, ["a.txt"], 7).writes
    expect(
      write?.kind === "set"
        ? CONFLICT_ASK.decode(write.value, write.key)
        : undefined,
    ).toEqual({
      lane: LANE,
      at: 7,
    })
  })
})
