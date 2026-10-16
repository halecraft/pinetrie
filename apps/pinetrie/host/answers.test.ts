import {
  type CanvasId,
  canvasIdFor,
  entryId,
  type RelayDetails,
  runId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import { readPlaces } from "@pinetrie/reads"
import { encodeRelayMessage, queuedOn } from "@pinetrie/rules"
import { beginRun, writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { createAnswers } from "./answers.ts"
import type { Budgets } from "./budgets.ts"
import {
  archiveCanvas,
  basics,
  fakeLane,
  placesFor,
  putCanvas,
  putLane,
  RUNS_ANY,
  record,
  row,
  stepKeeper,
} from "./fakes.ts"
import { createLater } from "./later.ts"

const ADA = writerId("ada@example.com")
const ASKER = threadIdFor("01a00000-0000-7000-8000-0000000000a1")
const ANSWERER = threadIdFor("01a00000-0000-7000-8000-0000000000b2")
const ASKERS: CanvasId = canvasIdFor("01a00000-0000-7000-8000-0000000000d4")

/**
 * Ada asked ANSWERER from ASKER, whose own run is still going; ANSWERER's
 * run, the relay's, has answered. Each thread on a canvas of its own.
 */
function setUp() {
  const b = basics()
  putCanvas(b, ASKER, ASKERS)
  putCanvas(b, ANSWERER)
  writeEntry(b.root, row(entryId("a-1"), null, undefined, ASKER))
  putLane(b, ASKER, entryId("a-1"))
  beginRun(b.live, ASKER, runId("r-asker"))
  const relay: RelayDetails = {
    from: ASKER,
    fromName: "slate-owl",
    source: entryId("a-1"),
    asker: { kind: "person", writer: ADA },
    askerName: "Ada",
    text: "anything?",
    budget: entryId("a-1"),
    by: ADA,
  }
  writeEntry(
    b.root,
    row(entryId("e-1"), null, encodeRelayMessage(relay, 0), ANSWERER),
  )
  writeEntry(
    b.root,
    row(
      entryId("e-2"),
      "e-1",
      { role: "assistant", content: [{ type: "text", text: "All done." }] },
      ANSWERER,
    ),
  )
  putLane(b, ANSWERER, entryId("e-2"))
  const keeper = stepKeeper(b)
  const { placesWriter } = placesFor(b)
  const later = createLater({
    basics: b,
    keeper,
    placesWriter,
    drain: () => {},
  })
  const asker = fakeLane(ASKER, {
    append: async () => ({ kind: "appended", id: entryId("a-2") }),
  })
  const answers = createAnswers({
    basics: b,
    later,
    keeper,
    runs: { docOf: () => b.root },
    relays: { deliver: async () => ({ kind: "ran" }) },
    agent: { lane: () => asker.lane } as Pick<Agent, "lane">,
    scribe: record<Pick<Scribe, "appendToTree">>().port,
    start: () => {
      throw new Error("no run starts")
    },
    runnable: RUNS_ANY.runnable,
    budgets: record<Budgets>({
      spent: () => false,
      runEnded: async () => {},
    }).port,
    piSetup: record<Pick<PiSetup, "complete" | "skill">>().port,
  })
  return { b, keeper, answers, asker }
}

test("an answer held for an asker archived meanwhile is the answering thread's undelivered fact", async () => {
  const { b, keeper, answers, asker } = setUp()
  // The asker is busy, so the answer waits for its run's end.
  await answers.ended(ANSWERER, entryId("e-1"))
  await keeper.idle()
  expect(asker.calls).toEqual([])
  archiveCanvas(b, ASKERS)
  await answers.ended(ASKER, null)
  await keeper.idle()
  const queued = queuedOn(readPlaces(b.places), ANSWERER)
  expect(
    queued.map(c => (c.kind === "fact" ? c.content.fact.kind : c.kind)),
  ).toEqual(["undelivered"])
  expect(asker.calls).toEqual([])
})

test("an answer held for an asker in reach is appended at its run's end", async () => {
  const { keeper, answers, asker } = setUp()
  await answers.ended(ANSWERER, entryId("e-1"))
  await keeper.idle()
  await answers.ended(ASKER, null)
  await keeper.idle()
  expect(asker.calls.map(c => c.method)).toEqual(["append"])
})
