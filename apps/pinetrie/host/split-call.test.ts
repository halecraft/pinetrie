import { entryId, runId, threadIdFor, writerId } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import { OFFER, SPLIT_QUEUED, setRecord, splitRefusal } from "@pinetrie/rules"
import { newPresenceDoc } from "@pinetrie/schema"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import type { HostKey } from "./basics.ts"
import { applyWrites, basics, putLane, putValue, row } from "./fakes.ts"
import { createProvenance } from "./provenance.ts"
import { createSplitCall } from "./split-call.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")

/** A running lane, its prompt by Ada, with an open offer: what `split_offer` splits. */
function runningWithOffer() {
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
      acceptedAs: null,
      commits: [],
      ledger: null,
      at: 1,
    }),
  )
  return b
}

test("split_offer queues a split card by the person behind the run, once", async () => {
  const b = runningWithOffer()
  const askSplit = createSplitCall({
    basics: b,
    keeper: { run: f => f() },
    provenance: createProvenance({
      basics: b,
      presence: newPresenceDoc(),
      records: { writeValues: async w => applyWrites(b, w) },
    }),
  })
  expect(await askSplit(LANE)).toEqual({
    text: SPLIT_QUEUED,
    isError: false,
    details: null,
  })
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
      place: { kind: "queued", thread: LANE },
      content: { command: "split", unsent: null, origin: null },
    },
  ])
})

test("a split asked as its run is stopped is popped by the run's end", async () => {
  const b = runningWithOffer()
  const keeper = createKeeper<HostKey>()
  const askSplit = createSplitCall({
    basics: b,
    keeper,
    provenance: createProvenance({
      basics: b,
      presence: newPresenceDoc(),
      records: { writeValues: async w => applyWrites(b, w) },
    }),
  })
  // The tool's call queues its step; a Stop ends the run before it runs,
  // and the run's end queues the lane's drain (`settle.ts`).
  const asked = askSplit(LANE)
  let found: unknown[] = []
  await keeper.once(`drain:${LANE}`, async () => {
    found = readPlaces(b.places).flatMap(c =>
      c.kind === "text" ? [c.content.command] : [],
    )
  })
  expect(found).toEqual(["split"])
  expect(await asked).toMatchObject({ text: SPLIT_QUEUED })
})
