import {
  type AgentMessageLike,
  atEntry,
  type EntryId,
  type EntryLike,
  ERR,
  entryId,
  indexAsks,
  indexTree,
  type LaneView,
  type StopRecord,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { QueuedCard } from "./card.ts"
import { renderableMessage } from "./chat.ts"
import { carryOnState, decodeCarryOn, planCarryOn, planStop } from "./stop.ts"

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
    name: threadIdFor("s"),
    tip: entryId("2-a"),
    running,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  })
  const facts = (
    stops: ReadonlyMap<EntryId, StopRecord> = new Map(),
    queue: readonly QueuedCard[] = [],
  ) => ({
    index: i,
    stops,
    queue,
    holds: new Map(),
    by: ada,
    now: 7,
  })
  test("a running lane is aborted, and its ask's stop recorded under its prompt", () => {
    expect(planStop(lane(true), facts())).toEqual({
      kind: "abort",
      record: { prompt: "1-p", by: ada, at: 7 },
      hold: null,
    })
  })
  test("with a message card queued, a stop holds the queue, so the run's end sends nothing (ADR-0048 step 7)", () => {
    const name = threadIdFor("s")
    const queued: QueuedCard = {
      kind: "text",
      id: textCardId("c0000000-0000-7000-8000-000000000001"),
      owner: ada,
      placer: ada,
      place: {
        kind: "queued",
        at: atEntry(entryId("2-a")),
        thread: name,
        order: "a",
        by: ada,
        seen: "",
      },
      carries: { kind: "message", command: null },
      unsent: null,
    }
    expect(planStop(lane(true), facts(new Map(), [queued]))).toMatchObject({
      kind: "abort",
      hold: { lane: name, by: ada, at: 7 },
    })
  })
  test("the first stop recorded is kept: a second press records nothing", () => {
    const first = new Map([
      [entryId("1-p"), { prompt: entryId("1-p"), by: writerId("bea"), at: 1 }],
    ])
    expect(planStop(lane(true), facts(first))).toEqual({
      kind: "abort",
      record: null,
      hold: null,
    })
  })
  test("an idle lane is already stopped", () => {
    expect(planStop(lane(false), facts())).toEqual({ kind: "idle" })
  })
})

describe("carrying on (ADR-0082)", () => {
  const s = threadIdFor("s")
  const ada = writerId("ada")
  /** A lane over a chain of messages, oldest first: its tip is the last. */
  const over = (
    messages: readonly AgentMessageLike[],
    lane: Partial<LaneView> = {},
  ) => {
    const entries: Record<EntryId, EntryLike> = {}
    let parent: EntryId | null = null
    for (const [n, message] of messages.entries()) {
      const id = entryId(`${n + 1}-e`)
      entries[id] = { id, parentId: parent, type: "message", message }
      parent = id
    }
    const index = indexTree(entries)
    return {
      view: {
        name: s,
        tip: parent,
        running: false,
        waiting: 0,
        askedBy: null,
        lastWaiting: null,
        heldBy: null,
        ...lane,
      },
      facts: { index, asks: indexAsks(index) },
    }
  }
  const ask: AgentMessageLike = { role: "chat", content: "fix it" }
  const aborted: AgentMessageLike = {
    role: "assistant",
    content: [{ type: "text", text: "half a reply" }],
    stopReason: "aborted",
  }
  const call: AgentMessageLike = {
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
    stopReason: "toolUse",
  }
  const result: AgentMessageLike = {
    role: "toolResult",
    content: "Command aborted",
  }
  const state = (o: ReturnType<typeof over>) => carryOnState(o.view, o.facts)
  const refusedWith = (code: string) => ({ kind: "refused", code })

  test("a lane whose last ask was stopped mid-reply or mid-command may carry on", () => {
    expect(state(over([ask, aborted]))).toEqual({ kind: "ok" })
    expect(state(over([ask, call, result]))).toEqual({ kind: "ok" })
  })
  test("an update after the stop is no ask: the lane may still carry on", () => {
    const update = { role: "update", content: "caught up" }
    expect(state(over([ask, aborted, update]))).toEqual({ kind: "ok" })
  })
  test("a lane with no tip is unknown, and so, to the planner, is no lane", () => {
    const o = over([ask, aborted])
    expect(carryOnState({ ...o.view, tip: null }, o.facts)).toEqual(
      refusedWith(ERR.UNKNOWN_TARGET),
    )
    expect(
      planCarryOn(null, { by: ada, name: "Ada", timestamp: 9 }),
    ).toMatchObject(refusedWith(ERR.UNKNOWN_TARGET))
  })
  test("a running lane, or one with a card queued, is busy", () => {
    expect(state(over([ask, aborted], { running: true }))).toEqual(
      refusedWith(ERR.BUSY),
    )
    expect(state(over([ask, aborted], { waiting: 1 }))).toEqual(
      refusedWith(ERR.BUSY),
    )
  })
  test("held cards wait for a release, not for this turn: the lane may carry on (ADR-0048 step 7)", () => {
    expect(
      state(over([ask, aborted], { waiting: 1, heldBy: writerId("bea") })),
    ).toEqual({ kind: "ok" })
    expect(
      state(
        over([ask, aborted], {
          running: true,
          waiting: 1,
          heldBy: writerId("bea"),
        }),
      ),
    ).toEqual(refusedWith(ERR.BUSY))
  })
  test("an answered ask, or a message after the stop, refuses", () => {
    const answered = { ...aborted, stopReason: "stop" }
    expect(state(over([ask, answered]))).toEqual(refusedWith(ERR.REFUSED))
    const after = { role: "chat", content: "to Bea only" }
    expect(state(over([ask, aborted, after]))).toEqual(refusedWith(ERR.REFUSED))
  })
  test("planCarryOn: a run whose prompt names who resumed, read back as its line", () => {
    const o = over([ask, aborted])
    const planned = planCarryOn(
      { lane: o.view, ...o.facts },
      {
        by: ada,
        name: "Ada",
        timestamp: 9,
      },
    )
    if (planned.kind !== "start") throw new Error("expected a start")
    expect(planned.message.content).toContain("Ada asked you to carry on")
    expect(decodeCarryOn(planned.message)).toEqual({
      lane: s,
      by: ada,
      name: "Ada",
    })
    expect(renderableMessage(planned.message)).toEqual({
      role: "carry-on",
      content: "↻ resumed by Ada",
    })
  })
  test("planCarryOn: a refusal is worded", () => {
    const o = over([ask, aborted], { running: true })
    expect(
      planCarryOn(
        { lane: o.view, ...o.facts },
        { by: ada, name: "Ada", timestamp: 9 },
      ),
    ).toEqual({
      kind: "refused",
      code: ERR.BUSY,
      message: "the thread is working",
    })
  })
})
