import {
  type BaseRecord,
  type BehindView,
  commitId,
  type LineRecord,
  laneNameForThread,
  type OfferRecord,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  behindContent,
  behindLine,
  decodeBehind,
  encodeBehind,
  planBaseNews,
  renderableMessage,
} from "./index.ts"

const LANE = laneNameForThread("1")
const [L1, L2] = [commitId("l1"), commitId("l2")]

const line = (commit = L2): LineRecord => ({
  onto: "pinetrie-onto",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: null, behind: 0, ahead: 0 },
  commit,
  heads: { current: null, proposed: "" },
  log: { current: null, proposed: "" },
  wips: [],
  yours: {
    behind: 0,
    ahead: null,
    follow: null,
    conflicts: { commits: 0, files: [] },
  },
  commands: true,
})

/** A lane on the line from L1, whose catch-up to L2 brings `files`. */
const base = (over: Partial<BaseRecord> = {}): BaseRecord => ({
  lane: LANE,
  base: { kind: "line" },
  start: L1,
  state: "ok",
  catchUp: { tip: commitId("t"), to: L2, files: ["a.ts", "b.ts"] },
  untraced: [],
  work: "some",
  ...over,
})

const offer = {
  files: ["a.ts", "c.ts"],
  conflicts: ["a.ts"],
} as unknown as OfferRecord

const VIEW: BehindView = {
  from: { kind: "line" },
  to: L2,
  files: ["a.ts", "b.ts"],
  overlap: ["a.ts"],
  conflicts: ["a.ts"],
}

describe("planBaseNews (ADR-0080)", () => {
  const news = (
    over: Partial<Parameters<typeof planBaseNews>[0]> = {},
  ): ReturnType<typeof planBaseNews> =>
    planBaseNews({
      own: true,
      base: base(),
      line: line(),
      offer,
      known: null,
      told: null,
      ...over,
    })

  test("a lane with work of its own is told: the files, those it changed too, and its offer's conflicts", () => {
    expect(news()).toEqual({ kind: "tell", view: VIEW })
  })

  test("a lane whose work changes no file is caught up instead", () => {
    expect(news({ base: base({ work: "none" }) })).toEqual({
      kind: "catch-up",
    })
  })

  test.each([
    ["no copy of its own", { own: false }],
    ["no base record", { base: undefined }],
    ["a base that has not moved", { line: line(L1) }],
    ["a move not yet read", { base: base({ catchUp: null }) }],
    [
      "a move that changes no file",
      { base: base({ catchUp: { tip: commitId("t"), to: L2, files: [] } }) },
    ],
    ["unknown work", { base: base({ work: "unknown" }) }],
    ["a gone base", { base: base({ state: "gone" }) }],
    ["a commit it was told of", { known: [L2] }],
    ["a commit it merged", { known: [commitId("x"), L2] }],
    ["a commit it was steered", { told: L2 }],
  ] as const)("nothing: %s", (_, over) => {
    expect(news(over)).toEqual({ kind: "nothing" })
  })
})

describe("the behind message", () => {
  test("round-trips, and the column draws it as its one line, role behind", () => {
    const stored = encodeBehind(VIEW, 1)
    expect(decodeBehind(stored)).toEqual(VIEW)
    expect(renderableMessage(stored)).toEqual({
      role: "behind",
      content: "↓ the project has new work: 2 files, 1 this thread changed too",
      behind: VIEW,
    })
    expect(behindLine({ ...VIEW, overlap: [] })).toBe(
      "↓ the project has new work: 2 files",
    )
  })

  test("the model reads the files, those it changed, the conflicts, and how to catch up", () => {
    const text = behindContent(VIEW)
    expect(text).toContain("the project has new work")
    expect(text).toContain("This thread changed these too:\n- a.ts\n")
    expect(text).toContain("conflicts with it in:\n- a.ts\n")
    expect(text).toContain("call `catch_up`")
    const many = behindContent({
      ...VIEW,
      files: Array.from({ length: 25 }, (_, i) => `f${i}`),
    })
    expect(many).toContain("- and 5 more\n")
  })
})
