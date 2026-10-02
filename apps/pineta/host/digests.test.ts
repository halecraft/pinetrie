import { entryId, laneNameForThread, runId, writerId } from "@pineta/core"
import { DIGEST_NAMESPACE, encodeDigest } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  beginRun,
  newPresenceDoc,
  readingKey,
  seatKey,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { expect, test } from "vitest"
import { createDigests } from "./digests.ts"
import { basics, methods, putValue, record, row } from "./fakes.ts"
import { createSerial } from "./queue.ts"

const lane = laneNameForThread("0123456789abcdef")

/** A lane running Ada's ask \`e-1\`, its agent at \`e-2\`. */
function running(answer: string | null = "Fixing the rail.") {
  const b = basics()
  writeEntry(b.doc, row(entryId("e-1"), null))
  writeEntry(
    b.doc,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "looking" }),
  )
  writeLaneTip(b.doc, lane, "e-2")
  beginRun(b.doc, lane, runId("r-1"))
  const presence = newPresenceDoc()
  const agent = record<Pick<Agent, "complete" | "skill" | "setDigest">>({
    skill: async () => ({ path: "SKILL.md", content: "Summarize.", hash: "h" }),
    complete: async () => answer,
    setDigest: async () => {},
  })
  const serial = createSerial()
  const digests = createDigests({
    basics: b,
    serial,
    presence,
    agent: () => agent.port,
  })
  const read = () =>
    presence.reading.set(
      readingKey(seatKey(writerId("ada@example.com"), "s1"), "c1"),
      "e-2",
    )
  return { b, agent, serial, digests, read }
}

test("a live digest waits for someone to read the thread", async () => {
  const { agent, serial, digests, read } = running()
  await digests.step(lane)
  await serial.idle()
  expect(methods(agent.calls)).toEqual([])
  read()
  await digests.step(lane)
  await serial.idle()
  expect(methods(agent.calls)).toEqual(["skill", "complete", "setDigest"])
  expect(agent.calls.at(-1)?.args).toEqual([
    "e-1",
    { text: "Fixing the rail.", at: 1_000, final: false },
  ])
})

test("at the run's end, the final digest, read or not; once written, no more", async () => {
  const { b, agent, serial, digests } = running("Fixed the rail.")
  await digests.ended(lane)
  await serial.idle()
  expect(agent.calls.at(-1)?.args).toEqual([
    "e-1",
    { text: "Fixed the rail.", at: 1_000, final: true },
  ])
  putValue(b.doc, {
    namespace: DIGEST_NAMESPACE,
    key: "e-1",
    value: encodeDigest({ text: "Fixed the rail.", at: 1_000, final: true }),
  })
  const before = agent.calls.length
  await digests.ended(lane)
  await serial.idle()
  expect(agent.calls.length).toBe(before)
})

test("a live digest that comes back after the final one is dropped", async () => {
  const late = Promise.withResolvers<string | null>()
  const { b, agent, serial, digests, read } = running()
  const complete = agent.port.complete
  Object.assign(agent.port, {
    complete: (r: Parameters<typeof complete>[0]) => {
      void complete(r)
      return late.promise
    },
  })
  read()
  await digests.step(lane)
  // The final one is written while the live one is out.
  putValue(b.doc, {
    namespace: DIGEST_NAMESPACE,
    key: "e-1",
    value: encodeDigest({ text: "done", at: 1, final: true }),
  })
  late.resolve("still working")
  await serial.idle()
  expect(methods(agent.calls)).toEqual(["skill", "complete"])
})
