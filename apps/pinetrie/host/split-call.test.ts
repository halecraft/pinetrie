import { entryId, laneNameForThread, runId, writerId } from "@pinetrie/core"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import { OFFER, SPLIT_QUEUED, setRecord, splitRefusal } from "@pinetrie/rules"
import {
  beginRun,
  newPresenceDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema"
import { expect, test } from "vitest"
import { applyWrites, basics, putLane, putValue, row } from "./fakes.ts"
import { createProvenance } from "./provenance.ts"
import { createSplitCall } from "./split-call.ts"

const LANE = laneNameForThread("0123456789abcdef")
const ADA = writerId("ada@x.io")

test("split_offer queues a split card by the person behind the run, once (ADR-0080)", async () => {
  const b = basics()
  putLane(b, LANE, entryId("p-1"))
  writeEntry(
    b.root,
    row("p-1", null, { role: "chat", content: "go", writer: ADA }),
  )
  writeLaneTip(b.root, LANE, entryId("p-1"))
  beginRun(b.live, LANE, runId("r-1"))
  putValue(
    b,
    setRecord(OFFER, {
      lane: LANE,
      size: 1,
      stale: false,
      files: ["a.ts"],
      conflicts: [],
      startConflicts: [],
      yourEdits: [],
      described: true,
      edited: false,
      bookmark: "pinetrie-offer/x",
      integratedAs: null,
      commits: [],
      ledger: null,
      at: 1,
    }),
  )
  const drained: string[] = []
  const askSplit = createSplitCall({
    basics: b,
    keeper: { run: f => f() },
    drain: lane => drained.push(lane),
    provenance: createProvenance({
      basics: b,
      presence: newPresenceDoc(),
      agent: () => ({ writeValues: async w => applyWrites(b, w) }),
    }),
  })
  expect(await askSplit(LANE)).toEqual({
    text: SPLIT_QUEUED,
    isError: false,
    details: null,
  })
  expect(drained).toEqual([LANE])
  // The host's write, with a history like any card's.
  const [queued] = readPlaces(b.places)
  expect(
    queued === undefined
      ? undefined
      : readCardHistories(b.session).get(queued.id)?.events,
  ).toMatchObject([{ kind: "created", by: null }])
  expect(await askSplit(LANE)).toMatchObject({
    text: splitRefusal("queued"),
    isError: true,
  })
  expect(readPlaces(b.places)).toMatchObject([
    {
      place: { kind: "queued", lane: LANE },
      carries: { kind: "message", command: "split" },
    },
  ])
})
