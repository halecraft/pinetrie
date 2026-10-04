import {
  entryId,
  laneNameForThread,
  ROOT,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { createKeeper } from "@pineta/keeper"
import { ARCHIVE, MARK, setRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readMarks } from "@pineta/reads"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import {
  applyWrites,
  basics,
  deferred,
  putLane,
  putValue,
  ROOT_ID,
  record,
  row,
  writeDirectory,
} from "./fakes.ts"
import { createTitles } from "./titles.ts"

const ADA = writerId("ada@example.com")
const L1 = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
const L2 = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a3067862240")
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
  const reply = deferred<string | null>()
  const agent = record<Pick<Agent, "complete" | "skill" | "writeValues">>({
    skill: async () => ({ path: "SKILL.md", content: "Title it.", hash: "h" }),
    complete: async () =>
      over.reply === undefined ? reply.promise : over.reply,
    writeValues: async w => applyWrites(b, w),
  })
  const keeper = createKeeper()
  const titles = createTitles({
    basics: b,
    keeper,
    enabled: over.enabled ?? true,
    agent: () => agent.port,
    rootedWait: 50,
  })
  const title = () => readMarks(b.root).get(E1)
  return { b, agent, keeper, titles, reply, title }
}

test("a new root's first lane: titled by the agent once the run writes its prompt", async () => {
  const { b, agent, keeper, titles, reply, title } = setUp()
  putLane(b, L1)
  await keeper.run(() => titles.laneStarted(started))
  reply.resolve("Rail layout")
  await new Promise(r => setTimeout(r, 5))
  expect(title()).toBeUndefined()
  writeEntry(b.root, row(E1, null))
  await keeper.idle()
  expect(title()).toMatchObject({ title: "Rail layout", by: THE_AGENT })
  const asked = agent.calls.find(c => c.method === "complete")?.args[0]
  expect(asked).toMatchObject({ purpose: "title", system: "Title it." })
  expect(JSON.stringify(asked)).toContain("Ada: fix the rail")
})

test("a root with a lane already, or with titles off, is not titled unasked", async () => {
  const cases = [
    { s: setUp({ reply: "Rail" }), lane: L2 },
    { s: setUp({ enabled: false, reply: "Rail" }), lane: L1 },
  ]
  for (const { s, lane } of cases) {
    const { b, agent, keeper, titles } = s
    putLane(b, lane)
    await keeper.run(() => titles.laneStarted(started))
    await keeper.idle()
    expect(agent.calls).toEqual([])
  }
})

test("a mark written while the title was asked wins over it", async () => {
  const { b, keeper, titles, reply, title } = setUp()
  putLane(b, L1)
  writeEntry(b.root, row(E1, null))
  await keeper.run(() => titles.laneStarted(started))
  putValue(
    b,
    setRecord(MARK, { entry: E1, title: "Mine", by: ADA, at: 1 }, ROOT_ID),
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
    setRecord(MARK, { entry: E1, title: "Mine", by: ADA, at: 1 }, ROOT_ID),
  )
  const answer = await keeper.run(() => titles.asked(ROOT_ID, ADA))
  expect(answer).toEqual({ kind: "retitling" })
  reply.resolve("Rail layout")
  await keeper.idle()
  expect(title()).toMatchObject({ title: "Rail layout", by: ADA })
})

test("asked, with no message yet: refused, and nothing asked", async () => {
  const { agent, keeper, titles } = setUp()
  const answer = await keeper.run(() => titles.asked(ROOT_ID, ADA))
  expect(answer.kind).toBe("refused")
  expect(agent.calls).toEqual([])
})

test("a reply that is not a title, or a root archived meanwhile, writes nothing", async () => {
  const wordy = setUp({ reply: "Here is a title for the thread: Rail" })
  writeEntry(wordy.b.root, row(E1, null))
  await wordy.keeper.run(() => wordy.titles.asked(ROOT_ID, ADA))
  await wordy.keeper.idle()
  expect(wordy.title()).toBeUndefined()
  expect(wordy.b.lines.join("\n")).toContain("the model's title is not one")

  const archived = setUp()
  writeEntry(archived.b.root, row(E1, null))
  writeDirectory(archived.b)
  await archived.keeper.run(() => archived.titles.asked(ROOT_ID, ADA))
  putValue(
    archived.b,
    setRecord(ARCHIVE, { root: E1, state: "archived", by: ADA, at: 1 }),
  )
  archived.reply.resolve("Rail layout")
  await archived.keeper.idle()
  expect(archived.title()).toBeUndefined()
})

test("a root whose prompt never comes is left untitled", async () => {
  const { b, keeper, titles, reply, title } = setUp()
  putLane(b, L1)
  await keeper.run(() => titles.laneStarted(started))
  reply.resolve("Rail layout")
  await keeper.idle()
  writeEntry(b.root, row(E1, null))
  await keeper.idle()
  expect(title()).toBeUndefined()
})
