import { entryId, runId, threadIdFor, writerId } from "@pinetrie/core"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import {
  PROPOSED_CHANGES,
  SPLIT_QUEUED,
  setRecord,
  splitRefusal,
} from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  basics,
  placesFor,
  putLane,
  putValue,
  row,
  stepKeeper,
} from "./fakes.ts"
import { createSplitCall } from "./split-call.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")

/** A running lane, its prompt by Ada, with open proposed changes: what `split_proposed_changes` splits. */
function runningWithProposed() {
  const b = basics()
  putLane(b, LANE, entryId("p-1"))
  writeEntry(
    b.root,
    row("p-1", null, { role: "person", content: "go", writer: ADA }),
  )
  writeLaneTip(b.root, LANE, entryId("p-1"))
  beginRun(b.live, LANE, runId("r-1"))
  putValue(
    b,
    setRecord(PROPOSED_CHANGES, {
      kind: "jj",
      lane: LANE,
      size: 1,
      stale: false,
      files: ["a.ts"],
      conflicts: [],
      startConflicts: [],
      workingCopyEdits: [],
      described: true,
      edited: false,
      bookmark: "pinetrie-proposed/x",
      acceptedAs: null,
      commits: [],
      ledger: null,
      at: 1,
    }),
  )
  return b
}

test("split_proposed_changes queues a split card by the person behind the run, once", async () => {
  const b = runningWithProposed()
  const askSplit = createSplitCall({
    basics: b,
    keeper: { run: f => f(b.roots) },
    placesWriter: placesFor(b).placesWriter,
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
  const b = runningWithProposed()
  const keeper = stepKeeper(b)
  const askSplit = createSplitCall({
    basics: b,
    keeper,
    placesWriter: placesFor(b).placesWriter,
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
