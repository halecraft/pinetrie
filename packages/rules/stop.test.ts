import {
  type EntryId,
  ERR,
  entryId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type AgentMessageLike,
  type CardRecord,
  cardIdOfKind,
  type EntryLike,
  indexAsks,
  indexTree,
  type LaneView,
} from "@pinetrie/threads"
import {
  cardIdFor,
  FIXTURE_THREAD,
  lineMessage,
  personMessage,
  toolResultMessage,
} from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { encodeFact } from "./fact.ts"
import { renderableMessage } from "./message.ts"
import { orderAfter } from "./order.ts"
import { type QueuedCard, queuedOn } from "./queue.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import { setRecord } from "./records.ts"
import {
  carryOnLine,
  carryOnState,
  decodeCarryOn,
  endedOutcome,
  planCarryOn,
  planStop,
} from "./stop.ts"

describe("planStop", () => {
  const prompt: EntryLike = {
    id: entryId("1-p"),
    parentId: null,
    thread: FIXTURE_THREAD,
    type: "message",
    message: { role: "user", content: "1-p" },
  }
  const work: EntryLike = {
    id: entryId("2-a"),
    parentId: prompt.id,
    thread: FIXTURE_THREAD,
    type: "message",
    message: { role: "assistant", content: "working" },
  }
  const i = indexTree({ [prompt.id]: prompt, [work.id]: work })
  const ada = writerId("ada")
  const bea = writerId("bea")
  const name = threadIdFor("s")
  const FACT = cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1")
  const lane = (running: boolean) => ({
    name,
    tip: entryId("2-a"),
    running,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  })
  const facts = (
    cards: readonly CardRecord[] = [],
    index = i,
    by = ada,
    id = FACT,
  ) => ({
    index,
    cards,
    holds: new Map(),
    by,
    now: 7,
    id,
  })
  const SECOND = cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f2")
  const stopped = (by = ada) => ({
    kind: "stopped" as const,
    lane: name,
    prompt: entryId("1-p"),
    by,
    at: 7,
  })
  const queued: QueuedCard = {
    kind: "text",
    id: cardIdFor("c1"),
    owner: ada,
    placer: ada,
    place: {
      kind: "queued",
      thread: name,
      order: orderAfter([]),
      by: ada,
      seen: "",
    },
    content: { command: null, unsent: null, origin: null },
  }

  test("a running lane is aborted, and a fact naming who stopped its ask is queued", () => {
    expect(planStop(lane(true), facts())).toEqual({
      kind: "abort",
      fact: [
        {
          kind: "write",
          record: {
            kind: "fact",
            id: FACT,
            owner: ada,
            placer: ada,
            place: expect.objectContaining({ kind: "queued", thread: name }),
            content: { fact: stopped() },
          },
        },
      ],
      writes: [],
    })
  })
  test("with a message card queued, a stop holds the queue, so the run's end sends nothing, and its fact goes first", () => {
    const planned = planStop(lane(true), facts([queued]))
    expect(planned).toMatchObject({
      kind: "abort",
      writes: [setRecord(QUEUE_HOLD, { lane: name, by: ada, at: 7 })],
    })
    const fact = planned.kind === "abort" ? planned.fact[0] : undefined
    expect(
      queuedOn(
        [queued, ...(fact?.kind === "write" ? [fact.record] : [])],
        name,
      ).map(c => c.id),
    ).toEqual([FACT, queued.id])
  })
  test("a spent budget stops the run, names the budget, and holds no queue", () => {
    const planned = planStop(lane(true), {
      ...facts([queued]),
      budget: entryId("m"),
    })
    expect(planned).toMatchObject({ kind: "abort", writes: [] })
    const fact = planned.kind === "abort" ? planned.fact[0] : undefined
    expect(fact?.kind === "write" && fact.record.content).toEqual({
      fact: { ...stopped(), budget: entryId("m") },
    })
  })
  test("the first press is named: a stop of the same ask queued, or one in the thread, queues no second", () => {
    const first = planStop(lane(true), facts([], i, bea))
    const queuedStop =
      first.kind === "abort" && first.fact[0]?.kind === "write"
        ? first.fact[0].record
        : undefined
    expect(
      planStop(
        lane(true),
        facts(queuedStop === undefined ? [] : [queuedStop], i, ada, SECOND),
      ),
    ).toEqual({ kind: "abort", fact: [], writes: [] })
    const appended: EntryLike = {
      id: entryId("3-f"),
      parentId: work.id,
      thread: FIXTURE_THREAD,
      type: "message",
      message: renderableMessage(encodeFact(stopped(bea), "Bea", 8)),
    }
    expect(
      planStop(
        lane(true),
        facts(
          [],
          indexTree({ ...i.entries, [appended.id]: appended }),
          ada,
          SECOND,
        ),
      ),
    ).toEqual({ kind: "abort", fact: [], writes: [] })
  })
  test("an idle lane is already stopped", () => {
    expect(planStop(lane(false), facts())).toEqual({ kind: "idle" })
  })
  test("endedOutcome: at the run's end its stop's fact is still queued, and names who stopped it", () => {
    const stoppedRun = indexTree({
      [prompt.id]: prompt,
      [work.id]: {
        ...work,
        message: { role: "assistant", content: "wo", stopReason: "aborted" },
      },
    })
    const planned = planStop(lane(true), facts([], stoppedRun, bea))
    const queue = queuedOn(
      planned.kind === "abort"
        ? planned.fact.flatMap(s => (s.kind === "write" ? [s.record] : []))
        : [],
      name,
    )
    const asks = indexAsks(stoppedRun)
    expect(endedOutcome(stoppedRun, asks, prompt.id, queue)).toEqual({
      kind: "stopped",
      by: bea,
    })
    expect(endedOutcome(stoppedRun, asks, prompt.id, [])).toEqual({
      kind: "stopped",
      by: null,
    })
  })
})

describe("carrying on", () => {
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
      entries[id] = {
        id,
        parentId: parent,
        thread: FIXTURE_THREAD,
        type: "message",
        message,
      }
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
  const ask: AgentMessageLike = personMessage("fix it")
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
  const result: AgentMessageLike = toolResultMessage({
    content: "Command aborted",
  })
  const state = (o: ReturnType<typeof over>) => carryOnState(o.view, o.facts)
  const refusedWith = (code: string) => ({ kind: "refused", code })

  test("a lane whose last ask was stopped mid-reply or mid-command may carry on", () => {
    expect(state(over([ask, aborted]))).toEqual({ kind: "ok" })
    expect(state(over([ask, call, result]))).toEqual({ kind: "ok" })
  })
  test("a stop's fact at the tip is no ask: the stopped ask still carries on, and names who stopped it", () => {
    const o = over([ask, aborted])
    const prompt = entryId("1-e")
    const fact = renderableMessage(
      encodeFact(
        { kind: "stopped", lane: s, prompt, by: writerId("bea"), at: 3 },
        "Bea",
        3,
      ),
    )
    if (fact === undefined) throw new Error("the stop's fact does not decode")
    const withFact = over([ask, aborted, fact])
    expect(state(withFact)).toEqual({ kind: "ok" })
    expect(withFact.facts.asks.stoppedBy.get(prompt)).toBe(writerId("bea"))
    expect(o.facts.asks.stoppedBy.size).toBe(0)
  })
  test("an update after the stop is no ask: the lane may still carry on", () => {
    const update = lineMessage("update", "caught up")
    expect(state(over([ask, aborted, update]))).toEqual({ kind: "ok" })
  })
  test("a lane with no tip is unknown, and so, to the planner, is no lane", () => {
    const o = over([ask, aborted])
    expect(carryOnState({ ...o.view, tip: null }, o.facts)).toEqual(
      refusedWith(ERR.UNKNOWN_TARGET),
    )
    expect(
      planCarryOn(null, { by: ada, names: new Map(), timestamp: 9 }),
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
  test("held cards wait for a release, not for this turn: the lane may carry on", () => {
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
    const after = personMessage("to Bea only")
    expect(state(over([ask, aborted, after]))).toEqual(refusedWith(ERR.REFUSED))
  })
  test("planCarryOn: a run whose prompt names who resumed, read back as its line", () => {
    const o = over([ask, aborted])
    const planned = planCarryOn(
      { lane: o.view, index: o.facts.index },
      {
        by: ada,
        names: new Map([[ada, "Ada"]]),
        timestamp: 9,
      },
    )
    if (planned.kind !== "start") throw new Error("expected a start")
    expect(planned.message.content).toContain("Ada asked you to carry on")
    expect(decodeCarryOn(planned.message)).toEqual({
      lane: s,
      by: ada,
      name: "Ada",
      reason: { kind: "stopped" },
    })
    expect(renderableMessage(planned.message)).toEqual({
      role: "carry-on",
      content: "↻ resumed by Ada",
    })
  })
  test("a carry-on says why it resumed", () => {
    expect(
      carryOnLine({
        lane: s,
        by: ada,
        name: "Ada",
        reason: { kind: "ssh-allowed", host: "hql" },
      }),
    ).toBe("↻ resumed by Ada: allowed ssh for hql")
  })
  test("planCarryOn: a refusal is worded", () => {
    const o = over([ask, aborted], { running: true })
    expect(
      planCarryOn(
        { lane: o.view, index: o.facts.index },
        { by: ada, names: new Map(), timestamp: 9 },
      ),
    ).toEqual({
      kind: "refused",
      code: ERR.BUSY,
      message: "the thread is working",
    })
  })
})
