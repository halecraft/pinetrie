import {
  canvasIdFor,
  entryId,
  ROOT,
  THE_AGENT,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { PiSetup } from "@pinetrie/pi"
import { readMarks } from "@pinetrie/reads"
import { MARK, setRecord } from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  applyWrites,
  archiveCanvas,
  basics,
  CANVAS_ID,
  deferred,
  placesFor,
  putCanvas,
  putLane,
  putValue,
  ROOT_ID,
  record,
  row,
  writeDirectory,
} from "./fakes.ts"
import { createLater } from "./later.ts"
import type { Records } from "./records.ts"
import { createTitles } from "./titles.ts"

const ADA = writerId("ada@example.com")
const L1 = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
const L2 = threadIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")
const E1 = entryId("e-1")
const started = {
  root: ROOT_ID,
  lane: L1,
  at: ROOT,
  prompt: { author: "Ada", text: "fix the rail" },
}

function setUp(
  over: { readonly enabled?: boolean; readonly reply?: string | null } = {},
) {
  const b = basics()
  // L1's thread opened the canvas.
  putCanvas(b, L1)
  const reply = deferred<string | null>()
  // The setup and the scribe in one record, so the order of their calls shows.
  const pi = record<
    Pick<PiSetup, "complete" | "skill"> & Pick<Records, "writeValues">
  >({
    skill: async () => ({ path: "SKILL.md", content: "Title it.", hash: "h" }),
    complete: async () => ({
      text: await (over.reply === undefined ? reply.promise : over.reply),
      tokens: 0,
    }),
    writeValues: async w => applyWrites(b, w),
  })
  const keeper = createKeeper()
  const later = createLater({
    basics: b,
    keeper,
    records: pi.port,
    placesWriter: placesFor(b).placesWriter,
    drain: () => {},
  })
  const titles = createTitles({
    basics: b,
    later,
    enabled: over.enabled ?? true,
    piSetup: pi.port,
  })
  const title = () => readMarks(b.session).get(CANVAS_ID)
  return { b, pi, keeper, titles, reply, title }
}

test("a new root's first lane: its canvas titled by the agent", async () => {
  const { b, pi, keeper, titles, reply, title } = setUp()
  putLane(b, L1)
  await keeper.run(() => titles.laneStarted(started))
  reply.resolve("Rail layout")
  await keeper.idle()
  expect(title()).toMatchObject({ title: "Rail layout", by: THE_AGENT })
  const asked = pi.calls.find(c => c.method === "complete")?.args[0]
  expect(asked).toMatchObject({ purpose: "title", system: "Title it." })
  expect(JSON.stringify(asked)).toContain("Ada: fix the rail")
})

test("a root with a lane already, or with titles off, is not titled unasked", async () => {
  const cases = [
    { s: setUp({ reply: "Rail" }), lane: L2 },
    { s: setUp({ enabled: false, reply: "Rail" }), lane: L1 },
  ]
  for (const { s, lane } of cases) {
    const { b, pi, keeper, titles } = s
    putLane(b, lane)
    await keeper.run(() => titles.laneStarted(started))
    await keeper.idle()
    expect(pi.calls).toEqual([])
  }
})

test("a mark written while the title was asked wins over it", async () => {
  const { b, keeper, titles, reply, title } = setUp()
  putLane(b, L1)
  writeEntry(b.root, row(E1, null))
  await keeper.run(() => titles.laneStarted(started))
  putValue(
    b,
    setRecord(MARK, { canvas: CANVAS_ID, title: "Mine", by: ADA, at: 1 }),
  )
  reply.resolve("Rail layout")
  await keeper.idle()
  expect(title()?.title).toBe("Mine")
})

test("asked: answers at once, and its title replaces a person's, as theirs", async () => {
  const { b, keeper, titles, reply, title } = setUp()
  writeEntry(b.root, row(E1, null))
  putValue(
    b,
    setRecord(MARK, { canvas: CANVAS_ID, title: "Mine", by: ADA, at: 1 }),
  )
  const answer = await keeper.run(() => titles.asked(CANVAS_ID, ADA))
  expect(answer).toEqual({ kind: "retitling" })
  reply.resolve("Rail layout")
  await keeper.idle()
  expect(title()).toMatchObject({ title: "Rail layout", by: ADA })
})

test("asked, with no message yet: refused, and nothing asked", async () => {
  const { pi, keeper, titles } = setUp()
  const answer = await keeper.run(() =>
    titles.asked(canvasIdFor("01a0ffd2-0000-7000-8000-0000000000ee"), ADA),
  )
  expect(answer.kind).toBe("refused")
  expect(pi.calls).toEqual([])
})

test("a reply that is not a title, or a root archived meanwhile, writes nothing", async () => {
  const wordy = setUp({ reply: "Here is a title for the thread: Rail" })
  writeEntry(wordy.b.root, row(E1, null))
  await wordy.keeper.run(() => wordy.titles.asked(CANVAS_ID, ADA))
  await wordy.keeper.idle()
  expect(wordy.title()).toBeUndefined()
  expect(wordy.b.lines.join("\n")).toContain("the model's title is not one")

  const archived = setUp()
  writeEntry(archived.b.root, row(E1, null))
  writeDirectory(archived.b)
  await archived.keeper.run(() => archived.titles.asked(CANVAS_ID, ADA))
  archiveCanvas(archived.b)
  archived.reply.resolve("Rail layout")
  await archived.keeper.idle()
  expect(archived.title()).toBeUndefined()
})
