import { describe, expect, test } from "vitest"
import { namesAndMore } from "./counts.ts"

describe("namesAndMore", () => {
  test("names the first few, then how many more", () => {
    expect(namesAndMore(["a"], 3)).toBe("a")
    expect(namesAndMore(["a", "b", "c"], 3)).toBe("a, b and c")
    expect(namesAndMore(["a", "b", "c", "d", "e"], 3)).toBe(
      "a, b, c and 2 more",
    )
  })
})
