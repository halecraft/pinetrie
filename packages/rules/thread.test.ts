import { entryId, rootIdFor, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { THREAD } from "./thread.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const KEY = threadIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const stored = (origin: unknown) => ({
  root: ROOT,
  by: "w-ada@x.io",
  createdAt: 1,
  origin,
})

describe("a thread's record (ADR-0117, ADR-0126)", () => {
  test("a root's first thread and a fork, a branch's or a copy's, read back", () => {
    expect(THREAD.decode(stored({ kind: "root" }), KEY)?.origin).toEqual({
      kind: "root",
    })
    expect(
      THREAD.decode(stored({ kind: "fork", at: "e", how: "copy" }), KEY)
        ?.origin,
    ).toEqual({ kind: "fork", at: entryId("e"), how: "copy" })
  })

  test("an origin this build does not know does not decode, never read as a root", () => {
    for (const origin of [
      { kind: "started" },
      { kind: "copy", source: KEY, fork: "e" },
      { kind: "fork", at: "e", how: "spun" },
      { kind: "fork", how: "branch" },
    ])
      expect(THREAD.decode(stored(origin), KEY)).toBeUndefined()
  })
})
