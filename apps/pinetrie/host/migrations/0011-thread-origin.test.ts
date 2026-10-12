import { indexTree, rootIdFor } from "@pinetrie/core"
import { fromParents, threadOfEntry } from "@pinetrie/core/fixtures"
import { THREAD } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  planThreadOrigins,
  rootsToRead,
  spunFrom,
} from "./0011-thread-origin.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
// r -> a -> b, and c a branch at a: thread `r` is the root's first, `c` forks at a.
const tree = indexTree(fromParents({ r: null, a: "r", b: "a", c: "a" }))
const ROOT_THREAD = threadOfEntry("r")
const BRANCH = threadOfEntry("c")
const COPY = "t-copy"
const record = (origin: unknown) => ({
  root: ROOT,
  by: "w-ada@x.io",
  createdAt: 1,
  origin,
})
const stored = {
  [ROOT_THREAD]: record({ kind: "started" }),
  [BRANCH]: record({ kind: "started" }),
  [COPY]: record({ kind: "copy", source: ROOT_THREAD, fork: "b" }),
}

const values = (writes: ReturnType<typeof planThreadOrigins>) =>
  Object.fromEntries(
    writes.flatMap(w => (w.kind === "set" ? [[w.key, w.value]] : [])),
  )

describe("0011-thread-origin: a thread's origin names its fork alone", () => {
  test("a root's first thread is a root; a branch forks at its first entry's parent; a copy at its fork", () => {
    expect(rootsToRead(stored)).toEqual([ROOT])
    const writes = planThreadOrigins({
      stored,
      trees: new Map([[ROOT, tree]]),
      spun: new Map(),
    })
    expect(writes.every(w => w.namespace === THREAD.namespace)).toBe(true)
    expect(values(writes)).toEqual({
      [ROOT_THREAD]: record({ kind: "root" }),
      [BRANCH]: record({ kind: "fork", at: "a", how: "branch" }),
      [COPY]: record({ kind: "fork", at: "b", how: "copy" }),
    })
  })

  test("each rewritten record decodes, and a second run finds nothing", () => {
    const once = values(
      planThreadOrigins({
        stored,
        trees: new Map([[ROOT, tree]]),
        spun: new Map(),
      }),
    )
    for (const [key, value] of Object.entries(once))
      expect(THREAD.decode(value, key)).toBeDefined()
    expect(
      planThreadOrigins({ stored: once, trees: new Map(), spun: new Map() }),
    ).toEqual([])
  })

  test("a thread a card was spun into is spun from it: its `spun` row names it", () => {
    const CARD = "01a0ffd2-0000-7000-8000-0000000000c1"
    const spun = spunFrom({ [CARD]: { kind: "spun", lane: ROOT_THREAD } })
    expect(
      values(
        planThreadOrigins({
          stored: { [ROOT_THREAD]: record({ kind: "started" }) },
          trees: new Map([[ROOT, tree]]),
          spun,
        }),
      ),
    ).toEqual({ [ROOT_THREAD]: record({ kind: "spun", card: CARD }) })
  })

  test("a started thread whose root did not load is a root's first thread", () => {
    expect(
      values(
        planThreadOrigins({
          stored: { [BRANCH]: record({ kind: "started" }) },
          trees: new Map(),
          spun: new Map(),
        }),
      ),
    ).toEqual({ [BRANCH]: record({ kind: "root" }) })
  })
})
