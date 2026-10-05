import {
  atEntry,
  cardId,
  entryId,
  type LaneName,
  laneNameForThread,
  runId,
  writerId,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import { readCardHistories, readPlaces } from "@pineta/reads"
import {
  deleteRecord,
  encodeCard,
  PARTICIPANT,
  QUEUE_HOLD,
  STOP,
  setRecord,
} from "@pineta/rules"
import {
  beginRun,
  newPresenceDoc,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { expect, test } from "vitest"
import {
  applyWrites,
  basics,
  fakeLane,
  methods,
  putLane,
  putValue,
  ROOT_ID,
  record,
  row,
} from "../fakes.ts"
import { createProvenance } from "../provenance.ts"
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
function running() {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(b.root, row(entryId("e-1"), null))
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "working" }),
  )
  writeLaneTip(b.root, lane, entryId("e-2"))
  beginRun(b.live, lane, runId("r-1"))
  const handle = fakeLane(lane, { abort: async () => {} })
  const agent = record<Pick<Agent, "lane" | "writeValues">>({
    lane: () => handle.lane,
    writeValues: async () => {},
  })
  return { b, lane, handle, agent }
}

test("stopping a running lane records who stopped its ask, then aborts its run", async () => {
  const { b, lane, handle, agent } = running()
  expect(
    await handleStop(
      { basics: b, agent: agent.port, cancel: () => false },
      lane,
      ada,
    ),
  ).toEqual({ kind: "stopped" })
  expect(agent.calls).toEqual([
    {
      method: "writeValues",
      args: [
        [
          setRecord(
            STOP,
            { prompt: entryId("e-1"), by: ada, at: 1_000 },
            ROOT_ID,
          ),
        ],
      ],
    },
    { method: "lane", args: [lane] },
  ])
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a second stop of the same ask records nothing more", async () => {
  const { b, lane, handle, agent } = running()
  putValue(
    b,
    setRecord(STOP, { prompt: entryId("e-1"), by: bea, at: 1 }, ROOT_ID),
  )
  await handleStop(
    { basics: b, agent: agent.port, cancel: () => false },
    lane,
    ada,
  )
  expect(methods(agent.calls)).toEqual(["lane"])
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a stop while a chat's run waits for its pinned cards cancels it there, and asks pi to abort nothing", async () => {
  const { b, lane, handle, agent } = running()
  const cancelled: string[] = []
  await handleStop(
    {
      basics: b,
      agent: agent.port,
      cancel: l => {
        cancelled.push(l)
        return true
      },
    },
    lane,
    ada,
  )
  expect(cancelled).toEqual([lane])
  expect(methods(agent.calls)).toEqual(["writeValues"])
  expect(methods(handle.calls)).toEqual([])
})

test("a stop with a message card queued holds the queue in the same write as its stop record, before the abort (ADR-0048 step 7)", async () => {
  const { b, lane, handle, agent } = running()
  b.places.cards.set(
    "c-1",
    encodeCard({
      id: cardId("c-1"),
      owner: bea,
      placer: bea,
      place: {
        kind: "queued",
        root: ROOT_ID,
        at: atEntry(entryId("e-2")),
        lane,
        order: "a",
        by: bea,
        seen: "",
      },
      carries: { kind: "message", command: null },
      unsent: null,
    }),
  )
  await handleStop(
    { basics: b, agent: agent.port, cancel: () => false },
    lane,
    ada,
  )
  expect(agent.calls[0]).toEqual({
    method: "writeValues",
    args: [
      [
        setRecord(
          STOP,
          { prompt: entryId("e-1"), by: ada, at: 1_000 },
          ROOT_ID,
        ),
        setRecord(QUEUE_HOLD, { lane, by: ada, at: 1_000 }),
      ],
    ],
  })
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a hold is written once, its release deleted and the lane drained; an unknown lane is refused (ADR-0048 step 7)", async () => {
  const { b, lane } = running()
  const writes: unknown[] = []
  const drained: string[] = []
  const deps = {
    basics: b,
    agent: {
      writeValues: async (w: Parameters<Agent["writeValues"]>[0]) => {
        writes.push(w)
        applyWrites(b, w)
      },
    },
    drain: (l: LaneName) => void drained.push(l),
  }
  expect(await handleQueueHold(deps, lane, true, ada)).toEqual({
    kind: "moved",
  })
  expect(await handleQueueHold(deps, lane, true, bea)).toEqual({
    kind: "nothing",
  })
  expect(writes).toEqual([
    [setRecord(QUEUE_HOLD, { lane, by: ada, at: 1_000 })],
  ])
  expect(drained).toEqual([])
  expect(await handleQueueHold(deps, lane, false, bea)).toEqual({
    kind: "moved",
  })
  expect(writes.at(-1)).toEqual([deleteRecord(QUEUE_HOLD, lane)])
  expect(drained).toEqual([lane])
  expect(
    (await handleQueueHold(deps, laneNameForThread("ffff"), true, ada)).kind,
  ).toBe("refused")
})

test("an offer's fact is queued as a card at the thread's end, after the cards there, and the lane's drain asked for (ADR-0080)", async () => {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  putLane(b, lane, entryId("e-2"))
  writeEntry(b.root, row(entryId("e-2"), null))
  writeLaneTip(b.root, lane, entryId("e-2"))
  const drained: string[] = []
  const fact = {
    kind: "integrated",
    lane,
    by: ada,
    as: "kabcdefgh",
    bookmark: "pineta-onto",
    to: { kind: "line" },
  } as const
  await recordFact(
    {
      basics: b,
      drain: l => drained.push(l),
      provenance: createProvenance({
        basics: b,
        presence: newPresenceDoc(),
        agent: () => ({ writeValues: async w => applyWrites(b, w) }),
      }),
    },
    fact,
  )
  expect(readPlaces(b.places)).toMatchObject([
    {
      owner: ada,
      placer: ada,
      place: {
        kind: "queued",
        lane,
        at: atEntry(entryId("e-2")),
        by: ada,
        seen: "",
      },
      carries: { kind: "fact", fact },
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
  const lane = laneNameForThread("0123456789abcdef")
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
  expect(await handleCarryOn({ basics: b, start }, lane, ada)).toEqual({
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
          customType: "pineta.carry-on",
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
  expect(await handleCarryOn({ basics: b, start }, lane, ada)).toEqual({
    kind: "refused",
    code: "busy",
    message: "the thread is working",
  })
  expect(
    await handleCarryOn(
      { basics: b, start },
      laneNameForThread("fedcba9876543210"),
      ada,
    ),
  ).toMatchObject({ kind: "refused", code: "unknown_target" })
  expect(started).toEqual([])
})
