import { threadIdFor } from "@pinetrie/core"
import type { Runner } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { bookmarkName, stackBookmark } from "./names.ts"
import { readFetchBookmark } from "./revisions.ts"

describe("readFetchBookmark", () => {
  const LANE = threadIdFor("fetched")
  /** jj answering a log of `revset` with one commit when it names `held`. */
  const jjHolding =
    (held: string | null, asked: string[]): Runner =>
    async args => {
      const revset = args[args.indexOf("-r") + 1] ?? ""
      asked.push(revset)
      const has = held !== null && revset.includes(JSON.stringify(held))
      return {
        ok: true,
        code: 0,
        stdout: has ? "0123456789abcdef0123456789abcdef01234567\n" : "",
        stderr: "",
      }
    }

  test("a fetch bundles the lane's bookmark, or with a stack its split's, when the lane's repo has it", async () => {
    const asked: string[] = []
    expect(
      await readFetchBookmark(
        jjHolding(bookmarkName(LANE), asked),
        LANE,
        false,
      ),
    ).toBe(bookmarkName(LANE))
    expect(
      await readFetchBookmark(
        jjHolding(stackBookmark(LANE), asked),
        LANE,
        true,
      ),
    ).toBe(stackBookmark(LANE))
    expect(
      await readFetchBookmark(jjHolding(bookmarkName(LANE), asked), LANE, true),
    ).toBeNull()
    expect(asked.every(r => r.startsWith("present("))).toBe(true)
  })
})
