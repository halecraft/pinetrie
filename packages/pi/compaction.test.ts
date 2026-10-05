import { estimateTokens } from "@earendil-works/pi-agent-core"
import { describe, expect, test } from "vitest"
import { LAND_BUDGET, PINETRIE_COMPACTION } from "./compaction.ts"

describe("LAND_BUDGET: what pi keeps whole when it compacts (ADR-0084)", () => {
  test("one source: the budget is the harness's keepRecentTokens, by pi's own estimate", () => {
    expect(LAND_BUDGET.tokens).toBe(PINETRIE_COMPACTION.keepRecentTokens)
    const content = "x".repeat(400)
    expect(LAND_BUDGET.estimate(content)).toBe(
      estimateTokens({
        role: "custom",
        customType: "pinetrie.land",
        content,
        display: true,
        timestamp: 0,
      }),
    )
    expect(LAND_BUDGET.estimate(content)).toBe(100)
  })
})
