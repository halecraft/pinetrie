import {
  entryId,
  runId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Agent } from "@pinetrie/pi"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import {
  deleteRecord,
  encodeCard,
  PARTICIPANT,
  QUEUE_HOLD,
  queuedOn,
  setRecord,
} from "@pinetrie/rules"
import { newPresenceDoc } from "@pinetrie/schema"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  applyWrites,
  basics,
  fakeLane,
  methods,
  NO_BLANK_CARDS,
  putLane,
  putValue,
  record,
  row,
} from "../fakes.ts"
import { createProvenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import type { RunStart } from "../runs.ts"
import {
  handleCarryOn,
  handleQueueHold,
  handleStop,
  recordFact,
} from "./lane.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")

/** A lane running an ask: Ada's prompt `e-1`, the agent's `e-2`. */
function running(onAbort: () => void = () => {}) {
  const b = basics()
  const lane = threadIdFor("0123456789abcdef")
  writeEntry(b.root, row(entryId("e-1"), null))
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "working" }),
  )
  writeLaneTip(b.root, lane, entryId("e-2"))
  beginRun(b.live, lane, runId("r-1"))
  const handle = fakeLane(lane, {
    abort: async () => {
      onAbort()
    },
  })
  // The agent and the scribe in one record, so the order of their calls shows.
  const pi = record<Pick<Agent, "lane"> & Pick<Records, "writeValues">>({
    lane: () => handle.lane,
    writeValues: async () => {},
  })
  return { b, lane, handle, pi }
}

/** A Stop's dependencies over `running`'s documents. */
const stopDeps = (
  r: ReturnType<typeof running>,
  cancel: (lane: ThreadId) => boolean = () => false,
) => ({
  basics: r.b,
  cards: NO_BLANK_CARDS,
  agent: r.pi.port,
  records: r.pi.port,
  cancel,
  provenance: createProvenance({
    basics: r.b,
    presence: newPresenceDoc(),
    records: { writeValues: async w => applyWrites(r.b, w) },
  }),
})

/** The stop facts queued on `lane`, as the places hold them. */
const stopFacts = (r: ReturnType<typeof running>) =>
  readPlaces(r.b.places).flatMap(c =>
    c.kind === "fact" && c.content.fact.kind === "stopped"
      ? [c.content.fact]
      : [],
  )

test("stopping a running lane queues the fact of who stopped its ask, then aborts its run", async () => {
  let queuedAtAbort = -1
  const r: ReturnType<typeof running> = running(() => {
    queuedAtAbort = stopFacts(r).length
  })
  expect(await handleStop(stopDeps(r), r.lane, ada)).toEqual({
    kind: "stopped",
  })
  expect(stopFacts(r)).toEqual([
    {
      kind: "stopped",
      lane: r.lane,
      prompt: entryId("e-1"),
      by: ada,
      at: 1_000,
    },
  ])
  expect(methods(r.pi.calls)).toEqual(["lane"])
  expect(methods(r.handle.calls)).toEqual(["abort"])
  // Queued before the abort, so the run's end finds it.
  expect(queuedAtAbort).toBe(1)
})

test("a second stop of the same ask queues nothing more: the first press is named", async () => {
  const r = running()
  await handleStop(stopDeps(r), r.lane, bea)
  await handleStop(stopDeps(r), r.lane, ada)
  expect(stopFacts(r).map(f => f.by)).toEqual([bea])
  expect(methods(r.handle.calls)).toEqual(["abort", "abort"])
})

test("a stop while a chat's run waits for its pinned cards cancels it there, and asks pi to abort nothing", async () => {
  const r = running()
  const cancelled: string[] = []
  await handleStop(
    stopDeps(r, l => {
      cancelled.push(l)
      return true
    }),
    r.lane,
    ada,
  )
  expect(cancelled).toEqual([r.lane])
  expect(stopFacts(r)).toHaveLength(1)
  expect(methods(r.handle.calls)).toEqual([])
})

test("a stop with a message card queued holds the queue before the abort", async () => {
  const r = running()
  r.b.places.cards.set(
    cardIdFor("c1"),
    encodeCard({
      kind: "text" as const,
      id: cardIdFor("c1"),
      owner: bea,
      placer: bea,
      place: {
        kind: "queued",
        thread: r.lane,
        order: "a",
        by: bea,
        seen: "",
      },
      content: { command: null, unsent: null, origin: null },
    }),
  )
  await handleStop(stopDeps(r), r.lane, ada)
  expect(r.pi.calls[0]).toEqual({
    method: "writeValues",
    args: [[setRecord(QUEUE_HOLD, { lane: r.lane, by: ada, at: 1_000 })]],
  })
  expect(queuedOn(readPlaces(r.b.places), r.lane).map(c => c.kind)).toEqual([
    "fact",
    "text",
  ])
  expect(methods(r.handle.calls)).toEqual(["abort"])
})

test("a hold is written once, its release deleted and the lane drained, each answered with how the queue is now", async () => {
  const { b, lane } = running()
  const writes: unknown[] = []
  const drained: string[] = []
  const deps = {
    basics: b,
    records: {
      writeValues: async (w: Parameters<Records["writeValues"]>[0]) => {
        writes.push(w)
        applyWrites(b, w)
      },
    },
    drain: (l: ThreadId) => void drained.push(l),
    cards: NO_BLANK_CARDS,
  }
  expect(await handleQueueHold(deps, lane, true, ada)).toEqual({
    kind: "held",
  })
  expect(await handleQueueHold(deps, lane, true, bea)).toEqual({
    kind: "held",
  })
  expect(writes).toEqual([
    [setRecord(QUEUE_HOLD, { lane, by: ada, at: 1_000 })],
  ])
  expect(drained).toEqual([])
  expect(await handleQueueHold(deps, lane, false, bea)).toEqual({
    kind: "released",
  })
  expect(writes.at(-1)).toEqual([deleteRecord(QUEUE_HOLD, lane)])
  expect(drained).toEqual([lane])
  expect(
    (await handleQueueHold(deps, threadIdFor("ffff"), true, ada)).kind,
  ).toBe("refused")
})

test("an offer's fact is queued as a card at the thread's end, and the lane's drain asked for", async () => {
  const b = basics()
  const lane = threadIdFor("0123456789abcdef")
  putLane(b, lane, entryId("e-2"))
  writeEntry(b.root, row(entryId("e-2"), null))
  writeLaneTip(b.root, lane, entryId("e-2"))
  const drained: string[] = []
  const fact = {
    kind: "accepted",
    lane,
    by: ada,
    as: "kabcdefgh",
    bookmark: "pinetrie-accepted",
    to: { kind: "accepted" },
  } as const
  await recordFact(
    {
      basics: b,
      drain: l => drained.push(l),
      provenance: createProvenance({
        basics: b,
        presence: newPresenceDoc(),
        records: { writeValues: async w => applyWrites(b, w) },
      }),
    },
    fact,
  )
  expect(readPlaces(b.places)).toMatchObject([
    {
      kind: "fact" as const,
      owner: ada,
      placer: ada,
      place: {
        kind: "queued",
        thread: lane,
        by: ada,
        seen: "",
      },
      content: { fact },
    },
  ])
  const [card] = readPlaces(b.places)
  expect(
    card === undefined
      ? undefined
      : readCardHistories(b.session).get(card.id)?.events,
  ).toMatchObject([{ kind: "created", by: null }])
  expect(drained).toEqual([lane])
})

/** A lane whose ask Ada stopped mid-reply: her prompt `e-1`, the partial `e-2`. */
function stopped() {
  const b = basics()
  const lane = threadIdFor("0123456789abcdef")
  writeEntry(b.root, row(entryId("e-1"), null))
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", {
      role: "assistant",
      content: [{ type: "text", text: "half a reply" }],
      stopReason: "aborted",
    }),
  )
  writeLaneTip(b.root, lane, entryId("e-2"))
  putValue(b, setRecord(PARTICIPANT, { writer: ada, name: "Ada" }))
  const started: [string, RunStart][] = []
  const start = (l: string, s: RunStart) => {
    started.push([l, s])
    return runId("r-2")
  }
  return { b, lane, started, start }
}

test("carrying on a stopped lane starts a run whose prompt is the carry-on message", async () => {
  const { b, lane, started, start } = stopped()
  expect(
    await handleCarryOn({ basics: b, start, cards: NO_BLANK_CARDS }, lane, ada),
  ).toEqual({
    kind: "started",
    runId: runId("r-2"),
  })
  expect(started).toMatchObject([
    [
      lane,
      {
        kind: "prompt",
        pinnedSeen: [],
        message: {
          customType: "pinetrie.carry-on",
          details: { lane, by: ada, name: "Ada" },
          timestamp: 1_000,
        },
      },
    ],
  ])
})

test("a carry-on the rule refuses is answered with its refusal, and starts nothing", async () => {
  const { b, lane, started, start } = stopped()
  beginRun(b.live, lane, runId("r-1"))
  expect(
    await handleCarryOn({ basics: b, start, cards: NO_BLANK_CARDS }, lane, ada),
  ).toEqual({
    kind: "refused",
    code: "busy",
    message: "the thread is working",
  })
  expect(
    await handleCarryOn(
      { basics: b, start, cards: NO_BLANK_CARDS },
      threadIdFor("fedcba9876543210"),
      ada,
    ),
  ).toMatchObject({ kind: "refused", code: "unknown_target" })
  expect(started).toEqual([])
})
