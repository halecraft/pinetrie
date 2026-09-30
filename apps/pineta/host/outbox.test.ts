import {
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  runId,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { encodeHeld, type Held, OUTBOX_NAMESPACE } from "@pineta/marginalia"
import type { Agent, ThreadLaneHandle } from "@pineta/pi"
import { readOutbox } from "@pineta/reads"
import { physicalKey } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, methods, record } from "./fakes.ts"
import { type DrainDeps, drain } from "./outbox.ts"

const LANE = laneNameForThread("0123456789abcdef")
const ALICE = writerId("alice@example.com")

const held = (id: string, compelled: boolean): Held => ({
  kind: "chat",
  id,
  lane: LANE,
  details: {
    author: ALICE,
    authorName: "Alice",
    text: id,
    compels: compelled ? { kind: "agent", agent: THE_AGENT } : NOBODY,
    sendId: id,
  },
  timestamp: 1,
})

function setUp(items: readonly Held[], append: ThreadLaneHandle["append"]) {
  const b = basics()
  const key = (id: string) => physicalKey(OUTBOX_NAMESPACE, id)
  for (const h of items)
    b.doc.values.set(key(h.id), {
      namespace: OUTBOX_NAMESPACE,
      key: h.id,
      value: encodeHeld(h),
    })
  const lane = record<ThreadLaneHandle>({ append })
  const agent = record<Pick<Agent, "lane" | "release">>({
    lane: () => lane.port,
    release: async id => {
      b.doc.values.delete(key(id))
    },
  })
  const started: string[] = []
  const deps: DrainDeps = {
    basics: b,
    agent: agent.port,
    start: (_lane, s) => {
      started.push(s.kind)
      return runId("run-1")
    },
    update: async () => ({ kind: "updated", text: "" }),
  }
  return { b, agent, lane, started, deps }
}

test("a plain held message is appended then released; a compelled one runs and ends the drain", async () => {
  const { b, agent, started, deps } = setUp(
    [held("1-plain", false), held("2-asks", true), held("3-later", false)],
    async () => ({ kind: "appended", id: entryId("e-1") }),
  )
  await drain(deps, LANE)
  expect(methods(agent.calls)).toEqual(["lane", "release", "release"])
  expect(agent.calls.map(c => c.args[0])).toEqual([LANE, "1-plain", "2-asks"])
  expect(started).toEqual(["prompt"])
  expect(readOutbox(b.doc).map(h => h.id)).toEqual(["3-later"])
})

test("a refused append stays held, and the drain stops", async () => {
  const { b, agent, deps } = setUp([held("1-plain", false)], async () => ({
    kind: "refused",
    code: ERR.REFUSED,
  }))
  await drain(deps, LANE)
  expect(methods(agent.calls)).toEqual(["lane"])
  expect(readOutbox(b.doc).map(h => h.id)).toEqual(["1-plain"])
  expect(b.lines).toEqual([
    `[host] held message kept: append refused (${ERR.REFUSED})`,
  ])
})
