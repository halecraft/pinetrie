import { describe, expect, test } from "vitest"
import {
  BASE_FORMAT,
  isBaseCurrent,
  isCopyableBase,
  parseBaseFacts,
  planBaseFacts,
} from "./base-facts.ts"
import { argvs, C1, C2 } from "./fixtures.ts"

describe("the base: the base before it, checked out at accepted work", () => {
  test("isBaseCurrent: the same states, made the way bases are now", () => {
    const base = { points: [C1], format: BASE_FORMAT }
    expect(isBaseCurrent(base, [C1])).toBe(true)
    expect(isBaseCurrent(base, [C2])).toBe(false)
    expect(isBaseCurrent({ ...base, format: BASE_FORMAT - 1 }, [C1])).toBe(
      false,
    )
    expect(isBaseCurrent(null, [C1])).toBe(false)
  })
  test("isCopyableBase: a base made the way they are now; one from before was made on a layer", () => {
    expect(isCopyableBase({ points: [C1], format: BASE_FORMAT })).toBe(true)
    expect(
      isCopyableBase(
        parseBaseFacts(JSON.stringify({ commits: [C1], key: "k" })),
      ),
    ).toBe(false)
    expect(isCopyableBase(null)).toBe(false)
  })
  test("planBaseFacts: its states and its format, read back", () => {
    const [written] = argvs([planBaseFacts([C1])])
    expect(written).toContain(
      JSON.stringify({ commits: [C1], format: BASE_FORMAT }),
    )
  })
})
