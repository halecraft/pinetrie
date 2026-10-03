import { entryId, laneNameForThread, runId, writerId } from "@pineta/core"
import { createKeeper } from "@pineta/keeper"
import { DIGEST, setRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  beginRun,
  endRun,
  newPresenceDoc,
  readingKey,
  seatKey,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { expect, test } from "vitest"
import { createDigests } from "./digests.ts"
import {
  basics,
  methods,
  putValue,
  ROOT_ID,
  record,
  row,
  writesOf,
} from "./fakes.ts"

const lane = laneNameForThread("0123456789abcdef")
/** A failure in a test is the test's failure. */
const failed = (error: unknown) => {
  throw error
}

/** The final digest of Ada's ask, `e-1`, as the host writes it. */
const FINAL = setRecord(
  DIGEST,
  {
    prompt: entryId("e-1"),
    text: "Fixed the rail.",
    at: 1_000,
    final: true,
  },
  ROOT_ID,
)

/** A lane running Ada's ask \`e-1\`, its agent at \`e-2\`. */
function running(answer: string | null = "Fixing the rail.") {
  const b = basics()
  writeEntry(b.root, row(entryId("e-1"), null))
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "looking" }),
  )
  writeLaneTip(b.root, lane, entryId("e-2"))
  beginRun(b.live, lane, runId("r-1"))
  const presence = newPresenceDoc()
  const agent = record<Pick<Agent, "complete" | "skill" | "writeValues">>({
    skill: async () => ({ path: "SKILL.md", content: "Summarize.", hash: "h" }),
    complete: async () => answer,
    writeValues: async () => {},
  })
  const keeper = createKeeper()
  const digests = createDigests({
    basics: b,
    keeper,
    presence,
    agent: () => agent.port,
  })
  const read = () =>
    presence.reading.set(
      readingKey(seatKey(writerId("ada@example.com"), "s1"), "c1"),
      "e-2",
    )
  return { b, agent, keeper, digests, read }
}

test("a live digest waits for someone to read the thread", async () => {
  const { agent, keeper, digests, read } = running()
  await digests.step(ROOT_ID, entryId("e-2"), failed)
  await keeper.idle()
  expect(methods(agent.calls)).toEqual([])
  read()
  await digests.step(ROOT_ID, entryId("e-2"), failed)
  await keeper.idle()
  expect(methods(agent.calls)).toEqual(["skill", "complete", "writeValues"])
  expect(writesOf(agent.calls)).toEqual([
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        text: "Fixing the rail.",
        at: 1_000,
        final: false,
      },
      ROOT_ID,
    ),
  ])
})

test("at the run's end, the final digest, read or not; once written, no more", async () => {
  const { b, agent, keeper, digests } = running("Fixed the rail.")
  await digests.ended(ROOT_ID, entryId("e-1"), failed)
  await keeper.idle()
  expect(agent.calls.at(-1)?.args).toEqual([[FINAL]])
  putValue(b, FINAL)
  const before = agent.calls.length
  await digests.ended(ROOT_ID, entryId("e-1"), failed)
  await keeper.idle()
  expect(agent.calls.length).toBe(before)
})

test("a live digest that comes back after the final one is dropped", async () => {
  const late = Promise.withResolvers<string | null>()
  const { b, agent, keeper, digests, read } = running()
  const complete = agent.port.complete
  Object.assign(agent.port, {
    complete: (r: Parameters<typeof complete>[0]) => {
      void complete(r)
      return late.promise
    },
  })
  read()
  await digests.step(ROOT_ID, entryId("e-2"), failed)
  // The final one is written while the live one is out.
  putValue(
    b,
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        text: "done",
        at: 1,
        final: true,
      },
      ROOT_ID,
    ),
  )
  late.resolve("still working")
  await keeper.idle()
  expect(methods(agent.calls)).toEqual(["skill", "complete"])
})

test.each([
  {
    left: "a plain message appended",
    rows: [row(entryId("e-3"), "e-2", { role: "chat", content: "fyi" })],
    tip: entryId("e-3"),
    next: false,
  },
  {
    left: "the next run started",
    rows: [
      row(entryId("e-3"), "e-2", { role: "chat", content: "next" }),
      row(entryId("e-4"), "e-3", { role: "assistant", content: "starting" }),
    ],
    tip: entryId("e-4"),
    next: true,
  },
])("a run's end digests the ask it answered, after the drain left $left", async ({
  rows,
  tip,
  next,
}) => {
  const { b, agent, keeper, digests } = running("Fixed the rail.")
  endRun(b.live, lane, runId("r-1"))
  for (const r of rows) writeEntry(b.root, r)
  writeLaneTip(b.root, lane, tip)
  if (next) beginRun(b.live, lane, runId("r-2"))
  await digests.ended(ROOT_ID, entryId("e-1"), failed)
  await keeper.idle()
  expect(writesOf(agent.calls)).toEqual([FINAL])
  const asked = agent.calls.find(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain("looking")
  expect(asked.user).not.toContain("starting")
})
