// The facade over pi's lanes: its error mapping, and creating a lane under
// the id the host gives.
//
// Co-located inside packages/pi for the same reason as storage.test.ts: both
// concern pi's behaviour, and a test under test/ would reach across the
// boundary ADR-0003 holds.

import { ERR, laneNameForThread, ROOT } from "@pineta/core"
import {
  newSessionDoc,
  readLaneNames,
  type SessionDocHandle,
} from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { createAgent, laneErrCode, newId } from "./agent.ts"
import { scriptedModel } from "./scripted.ts"

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
})
