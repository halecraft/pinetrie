// The navigation error mapping, which is why it was extracted.
//
// Co-located inside packages/pi for the same reason as storage.test.ts: this
// concerns pi's error vocabulary, and a test under test/ would reach across
// the boundary ADR-0003 holds. The function itself takes a plain string, so
// no pi type is needed to exercise it.

import { ERR } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { navigationErrCode } from "./agent.ts"

describe("navigationErrCode", () => {
  test("maps pi's navigation failures onto our codes", () => {
    expect(navigationErrCode("UnknownTarget")).toBe(ERR.UNKNOWN_TARGET)
    expect(navigationErrCode("InvalidNavigation")).toBe(ERR.INVALID_NAVIGATION)
    expect(navigationErrCode("LaneBusy")).toBe(ERR.BUSY)
  })

  test("an unrecognised tag is still a navigation failure, not a crash", () => {
    // pi may add error tags. Reporting the wrong navigation code is recoverable;
    // throwing inside the host's reply path is not.
    expect(navigationErrCode("SomethingPiAddedLater")).toBe(
      ERR.INVALID_NAVIGATION,
    )
  })

  test("UnknownTarget is distinct from BUSY", () => {
    // These two arrive from the same union and mean opposite things: one is a
    // bad target, the other is "try again". Collapsing them would tell a user
    // to retry something that can never succeed.
    expect(navigationErrCode("UnknownTarget")).not.toBe(
      navigationErrCode("LaneBusy"),
    )
  })
})
