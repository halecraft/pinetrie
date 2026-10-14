import { describe, expect, test } from "vitest"
import { commitId, planCopyReady } from "./index.ts"

const B = commitId("b".repeat(40))
const C = commitId("c".repeat(40))

describe("planCopyReady", () => {
  test.each([
    [
      "on the bookmark",
      { parents: [B], bookmark: B, descends: false },
      "ready",
    ],
    [
      "on the agent's own commit on it",
      { parents: [C], bookmark: B, descends: true },
      "ready",
    ],
    [
      "on another line: a split's stack",
      { parents: [C], bookmark: B, descends: false },
      "off-line",
    ],
    [
      "on two parents",
      { parents: [B, C], bookmark: B, descends: false },
      "off-line",
    ],
    [
      "with no bookmark: refused as that, not as off accepted work",
      { parents: [B], bookmark: null, descends: false },
      "no-bookmark",
    ],
  ] as const)("%s", (_, copy, ready) => {
    const found = planCopyReady(copy)
    expect(typeof found === "string" ? found : "ready").toBe(ready)
  })
})
