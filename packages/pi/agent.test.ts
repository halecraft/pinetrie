// The navigation error mapping, which is why it was extracted.
//
// Co-located inside packages/pi for the same reason as storage.test.ts: this
// concerns pi's error vocabulary, and a test under test/ would reach across
// the boundary ADR-0003 holds. The function itself takes a plain string, so
// no pi type is needed to exercise it.

import { ERR } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { laneErrCode } from "./agent.ts"

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
