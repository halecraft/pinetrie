import {
  type BehindView,
  commitId,
  type JjAcceptedRecord,
  type JjBaseRecord,
  type JjProposedChangesRecord,
  pointFromCommit,
  pointId,
  threadIdFor,
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

const LANE = threadIdFor("1")
const [L1, L2] = [commitId("l1"), commitId("l2")]
/** `L2` as the state a thread was told of, or merged. */
const P2 = pointFromCommit(L2)

const line = (commit = L2): JjAcceptedRecord => ({
  kind: "jj",
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: null, behind: 0, ahead: 0 },
  commit,
  heads: { current: null, proposed: "" },
  log: { current: null, proposed: "" },
  wips: [],
  workingCopy: {
    behind: 0,
    ahead: 0,
    getLatest: null,
    conflicts: { commits: 0, files: [] },
  },
  publishCatchesUp: true,
})

/** A lane on accepted work from L1, whose catch-up to L2 brings `files`. */
const base = (over: Partial<JjBaseRecord> = {}): JjBaseRecord => ({
  kind: "jj",
  lane: LANE,
  base: { kind: "accepted" },
  start: L1,
  state: "ok",
  getLatest: { tip: commitId("t"), to: L2, files: ["a.ts", "b.ts"] },
  untraced: [],
  work: "some",
  ...over,
})

const proposed = {
  files: ["a.ts", "c.ts"],
  conflicts: ["a.ts"],
} as unknown as JjProposedChangesRecord

const VIEW: BehindView = {
  from: { kind: "accepted" },
  to: P2,
  files: ["a.ts", "b.ts"],
  overlap: ["a.ts"],
  conflicts: ["a.ts"],
}

describe("planBaseNews", () => {
  const news = (
    over: Partial<Parameters<typeof planBaseNews>[0]> = {},
  ): ReturnType<typeof planBaseNews> =>
    planBaseNews({
      own: true,
      base: base(),
      accepted: line(),
      proposed,
      known: null,
      told: null,
      ...over,
    })

  test("a lane with work of its own is told: the files, those it changed too, and its proposed changes' conflicts", () => {
    expect(news()).toEqual({ kind: "tell", view: VIEW })
  })

  test("a lane whose work changes no file is caught up instead", () => {
    expect(news({ base: base({ work: "none" }) })).toEqual({
      kind: "get-latest",
    })
  })

  test.each([
    ["no copy of its own", { own: false }],
    ["no base record", { base: undefined }],
    ["a base that has not moved", { accepted: line(L1) }],
    ["a move not yet read", { base: base({ getLatest: null }) }],
    [
      "a move that changes no file",
      { base: base({ getLatest: { tip: commitId("t"), to: L2, files: [] } }) },
    ],
    ["unknown work", { base: base({ work: "unknown" }) }],
    ["a gone base", { base: base({ state: "gone" }) }],
    ["a commit it was told of", { known: [P2] }],
    ["a commit it merged", { known: [pointId("x"), P2] }],
    ["a commit it was steered", { told: P2 }],
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
      content:
        "↓ accepted work has moved on: 2 files, 1 this thread changed too",
      behind: VIEW,
    })
    expect(behindLine({ ...VIEW, overlap: [] })).toBe(
      "↓ accepted work has moved on: 2 files",
    )
  })

  test("the model reads the files, those it changed, the conflicts, and how to catch up", () => {
    const text = behindContent(VIEW)
    expect(text).toContain("accepted work has moved on")
    expect(text).toContain("This thread changed these too:\n- a.ts\n")
    expect(text).toContain("conflict with it in:\n- a.ts\n")
    expect(text).toContain("call `catch_up`")
    const many = behindContent({
      ...VIEW,
      files: Array.from({ length: 25 }, (_, i) => `f${i}`),
    })
    expect(many).toContain("- and 5 more\n")
  })
})
