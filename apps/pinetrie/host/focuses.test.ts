import {
  type DigestRecord,
  entryId,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import { FOCUS, setRecord } from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test, vi } from "vitest"
import type { RunEndSettled } from "./digests.ts"
import {
  basics,
  deferred,
  methods,
  placesFor,
  putCanvas,
  ROOT_ID,
  record,
  row,
  stepKeeper,
  writtenValues,
} from "./fakes.ts"
import { createFocuses } from "./focuses.ts"
import { createLater } from "./later.ts"
import type { StepRecords } from "./records.ts"

/** The thread `row` writes in, as the fakes name it. */
const lane: ThreadId = threadIdFor("row")
/** A failure in a test is the test's failure. */
const failed = (error: unknown) => {
  throw error
}

/** Ada's two asks in `lane`, each answered; `e-3`'s run has just ended. */
function threaded(
  answer: () => string | null | Promise<string | null> = () =>
    "Planning the billing page",
  enabled = true,
) {
  const b = basics()
  writeEntry(
    b.root,
    row(entryId("e-1"), null, {
      role: "person",
      author: "Ada",
      content: "fix the rail",
    }),
  )
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "fixed" }),
  )
  writeEntry(
    b.root,
    row(entryId("e-3"), "e-2", {
      role: "person",
      author: "Ada",
      content: "now billing",
    }),
  )
  writeEntry(
    b.root,
    row(entryId("e-4"), "e-3", { role: "assistant", content: "planned" }),
  )
  const pi = record<
    Pick<PiSetup, "complete" | "skill"> & Pick<StepRecords, "writeValues">
  >({
    skill: async () => ({ path: "SKILL.md", content: "Name it.", hash: "h" }),
    complete: async () => ({ text: await answer(), tokens: 0 }),
    writeValues: async () => {},
  })
  putCanvas(b, lane)
  const keeper = stepKeeper(b, { records: pi.port })
  const later = createLater({
    basics: b,
    keeper,
    placesWriter: placesFor(b).placesWriter,
    drain: () => {},
  })
  const focuses = createFocuses({ basics: b, later, piSetup: pi.port, enabled })
  return { b, pi, keeper, focuses }
}

const final: DigestRecord = {
  prompt: entryId("e-3"),
  headline: "Planned the billing page",
  points: [],
  at: 1,
  final: true,
}
const settled = (ask = "e-3", digest: DigestRecord | null = final) =>
  ({ root: ROOT_ID, lane, ask: entryId(ask), digest }) as RunEndSettled

test("the focus request reads the settled run's headline", async () => {
  const { pi, keeper, focuses } = threaded()
  await focuses.ended(settled(), failed)
  await keeper.idle()
  const asked = pi.calls.find(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain(
    "- Ada: now billing\n  (came of it: Planned the billing page)",
  )
  expect(writtenValues(pi.calls)).toEqual([
    setRecord(FOCUS, {
      thread: lane,
      focus: "Planning the billing page",
      ask: entryId("e-3"),
      at: 1_000,
    }),
  ])
})

test("a failed request writes nothing", async () => {
  const { pi, keeper, focuses } = threaded(() => null)
  await focuses.ended(settled(), failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual(["skill", "complete"])
})

test("digests off asks nothing", async () => {
  const { pi, keeper, focuses } = threaded(undefined, false)
  await focuses.ended(settled(), failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual([])
})

test("a run ending while another's focus is asked asks too", async () => {
  const first = deferred<string | null>()
  let n = 0
  const { pi, keeper, focuses } = threaded(() =>
    n++ === 0 ? first.promise : "Planning the billing page",
  )
  await focuses.ended(settled("e-1", null), failed)
  await focuses.ended(settled(), failed)
  // The first is still out while the second is asked.
  await vi.waitFor(() =>
    expect(methods(pi.calls).filter(m => m === "complete")).toHaveLength(2),
  )
  first.resolve("Fixing the rail")
  await keeper.idle()
})
