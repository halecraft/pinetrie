// The facade over pi's lanes: its error mapping, creating a lane under the
// id the host gives, and the host's value writes.
//
// Co-located inside packages/pi for the same reason as stored-row.test.ts: both
// concern pi's behaviour, and a test under test/ would reach across the
// boundary ADR-0003 holds.

import {
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  ROOT,
  type ThreadName,
  type ValueWrite,
  writerId,
} from "@pineta/core"
import {
  deleteRecord,
  encodeChat,
  MARK,
  NAME,
  setRecord,
} from "@pineta/marginalia"
import {
  newSessionDoc,
  readLaneNames,
  readValues,
  type SessionDocHandle,
} from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { createAgent, newId } from "./agent.ts"
import { scriptedModel } from "./scripted.ts"
import { laneErrCode } from "./thread-lanes.ts"

describe("laneErrCode", () => {
  test("maps pi's refusals onto our codes", () => {
    expect(laneErrCode("UnknownTarget")).toBe(ERR.UNKNOWN_TARGET)
    // Nothing navigates a lane any more (ADR-0020).
    expect(laneErrCode("InvalidNavigation")).toBe(ERR.REFUSED)
    // A crash leaves pi's operation open: busy until resumed (S36 item 18).
    expect(laneErrCode("LaneBusy")).toBe(ERR.BUSY)
  })

  test("an unrecognised tag is a generic refusal, not a crash", () => {
    // pi may add error tags, and this now maps runs and lane creation as well
    // as navigation, so a navigation-specific fallback would mislabel them.
    // Reporting a generic refusal is recoverable; throwing inside the host's
    // reply path is not.
    expect(laneErrCode("SomethingPiAddedLater")).toBe(ERR.REFUSED)
  })

  test("UnknownTarget is distinct from BUSY", () => {
    // These two arrive from the same union and mean opposite things: one is a
    // bad target, the other is "try again". Collapsing them would tell a user
    // to retry something that can never succeed.
    expect(laneErrCode("UnknownTarget")).not.toBe(laneErrCode("LaneBusy"))
  })
})

describe("createThreadLane (ADR-0057)", () => {
  const over = (doc: SessionDocHandle) =>
    createAgent({
      doc,
      replicaId: "test",
      model: { kind: "scripted", script: scriptedModel() },
      tools: null,
    })

  test("creates the lane under the id it is given, and refuses one pi holds", async () => {
    const doc = newSessionDoc()
    const agent = await over(doc)
    const lane = laneNameForThread(newId())
    expect(await agent.createThreadLane(ROOT, lane)).toEqual({
      kind: "created",
      lane,
    })
    // `harness.lane` would return the lane it holds, ignoring where to create.
    expect(await agent.createThreadLane(ROOT, lane)).toEqual({
      kind: "refused",
      code: ERR.LANE_TAKEN,
    })
    await agent.close()
    // A later process holds it only in the document.
    const later = await over(doc)
    expect(await later.createThreadLane(ROOT, lane)).toEqual({
      kind: "refused",
      code: ERR.LANE_TAKEN,
    })
    expect(readLaneNames(doc)).toEqual([lane])
    await later.close()
  })

  test("a lane that does not exist refuses every write as unknown", async () => {
    const agent = await over(newSessionDoc())
    const lane = agent.lane(laneNameForThread(newId()))
    const unknown = { kind: "refused", code: ERR.UNKNOWN_TARGET }
    const message = encodeChat(
      {
        author: writerId("ada"),
        authorName: "Ada",
        text: "hi",
        compels: NOBODY,
        sendId: "s",
      },
      0,
    )
    expect(await lane.append(message)).toEqual(unknown)
    expect(await lane.run(message)).toEqual(unknown)
    expect(await lane.resume()).toEqual(unknown)
    await agent.close()
  })
})

describe("writeValues (ADR-0062)", () => {
  const over = (doc: SessionDocHandle) =>
    createAgent({
      doc,
      replicaId: "test",
      model: { kind: "scripted", script: scriptedModel() },
      tools: null,
    })
  const lane = laneNameForThread("0190a0a0-0000-7000-8000-000000000001")
  const entry = entryId("e-1")
  const mark = { entry, title: "Plans", by: writerId("ada"), at: 1 }

  test("writes sets and deletes in one call, where the readers find them", async () => {
    const doc = newSessionDoc()
    const agent = await over(doc)
    await agent.writeValues([
      setRecord(MARK, mark),
      setRecord(NAME, { lane, name: "amber-fox" as ThreadName, at: 1 }),
    ])
    expect(readValues(doc, "pineta.mark")).toEqual([
      { key: entry, value: { title: "Plans", by: writerId("ada"), at: 1 } },
    ])
    await agent.writeValues([deleteRecord(MARK, entry)])
    expect(readValues(doc, "pineta.mark")).toEqual([])
    expect(readValues(doc, "pineta.name")).toHaveLength(1)
    await agent.close()
  })

  test("refuses a namespace that is not the host's, and writes nothing", async () => {
    const doc = newSessionDoc()
    const agent = await over(doc)
    const theirs = {
      kind: "set",
      namespace: "pi.branch.tip",
      key: lane,
      value: null,
    } as unknown as ValueWrite
    await expect(
      agent.writeValues([setRecord(MARK, mark), theirs]),
    ).rejects.toThrow("not the host's")
    expect(readValues(doc, "pineta.mark")).toEqual([])
    expect(readLaneNames(doc)).toEqual([])
    await agent.close()
  })
})
