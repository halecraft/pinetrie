import {
  type EntryId,
  type EntryLike,
  entryId,
  indexTree,
  laneNameForThread,
  type StopRecord,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { planStop } from "./stop.ts"

describe("planStop", () => {
  const prompt: EntryLike = {
    id: entryId("1-p"),
    parentId: null,
    type: "message",
    message: { role: "user", content: "1-p" },
  }
  const work: EntryLike = {
    id: entryId("2-a"),
    parentId: prompt.id,
    type: "message",
    message: { role: "assistant", content: "working" },
  }
  const i = indexTree({ [prompt.id]: prompt, [work.id]: work })
  const ada = writerId("ada")
  const lane = (running: boolean) => ({
    name: laneNameForThread("s"),
    tip: entryId("2-a"),
    running,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  })
  const facts = (stops: ReadonlyMap<EntryId, StopRecord> = new Map()) => ({
    index: i,
    stops,
    by: ada,
    now: 7,
  })
  const s = laneNameForThread("s")
  test("a running lane is aborted, and its ask's stop recorded under its prompt", () => {
    expect(planStop([lane(true)], s, facts())).toEqual({
      kind: "abort",
      record: { prompt: "1-p", by: ada, at: 7 },
    })
  })
  test("the first stop recorded is kept: a second press records nothing", () => {
    const first = new Map([
      [entryId("1-p"), { prompt: entryId("1-p"), by: writerId("bea"), at: 1 }],
    ])
    expect(planStop([lane(true)], s, facts(first))).toEqual({
      kind: "abort",
      record: null,
    })
  })
  test("an idle lane is already stopped; an unknown one is refused", () => {
    expect(planStop([lane(false)], s, facts())).toEqual({ kind: "idle" })
    expect(planStop([lane(true)], laneNameForThread("other"), facts())).toEqual(
      { kind: "unknown" },
    )
  })
})
