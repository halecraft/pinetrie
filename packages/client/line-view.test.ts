import { commitId, type LineRecord, laneNameForThread } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { baseWords } from "./column-view.ts"
import { lineView, lineWords } from "./line-view.ts"
import { baseChoices } from "./send.ts"

const record = (over: Partial<LineRecord> = {}): LineRecord => ({
  onto: "pineta-onto",
  wipPrefix: "wip/",
  commit: commitId("c1"),
  heads: { current: null, proposed: "builtin_immutable_heads() | …" },
  log: { current: null, proposed: "builtin_log() | …" },
  wips: [],
  yours: { behind: 0, ahead: 0 },
  commands: true,
  ...over,
})

describe("lineView and lineWords (ADR-0060)", () => {
  test("no line yet: set up at your @-, showing the heads it writes", () => {
    const view = lineView(record({ commit: null }))
    expect(view).toMatchObject({ state: "unset", actions: ["setup"] })
    const words = lineWords(view)
    expect(words.actions).toEqual([
      { action: "setup", label: "set up the line" },
    ])
    expect(words.notes[1]).toContain("builtin_immutable_heads() | …")
    expect(words.notes[2]).toContain("builtin_log() | …")
  })
  test("a host that admits others offers no line action, and says why", () => {
    const view = lineView(record({ commit: null, commands: false }))
    expect(view.actions).toEqual([])
    expect(lineWords(view).notes[0]).toContain("with jj on its machine")
    expect(
      lineView(record({ yours: { behind: 0, ahead: 2 }, commands: false }))
        .actions,
    ).toEqual([])
  })
  test("your work above the line: land it, counted; behind it: say so", () => {
    const ahead = lineView(record({ yours: { behind: 0, ahead: 2 } }))
    expect(lineWords(ahead).actions).toEqual([
      { action: "land", label: "land my work (2 commits)" },
    ])
    const behind = lineWords(
      lineView(record({ yours: { behind: 3, ahead: null } })),
    )
    expect(behind.actions).toEqual([])
    expect(behind.notes[0]).toBe(
      "your work is 3 commits behind pineta-onto: rebase onto it in jj",
    )
  })
  test("no record: absent", () => {
    expect(lineView(null).state).toBe("absent")
  })
})

describe("the thread's base in its header, and the bases a new lane may start from (ADR-0060)", () => {
  const lane = laneNameForThread("1")
  const base = (state: "ok" | "landed" | "gone") =>
    ({
      lane,
      base: { kind: "wip", bookmark: "wip/search" },
      start: commitId("c"),
      state,
    }) as const
  test("baseWords: a WIP while it is one, gone when gone, nothing on the line", () => {
    expect(baseWords(base("ok"))).toBe("on wip/search")
    expect(baseWords(base("gone"))).toBe("wip/search is gone")
    expect(baseWords(base("landed"))).toBeNull()
    expect(baseWords({ ...base("ok"), base: { kind: "line" } })).toBeNull()
    expect(baseWords(undefined)).toBeNull()
  })
  test("baseChoices: the line first, then each WIP with how far behind it is; none with no line", () => {
    const line = record({
      wips: [
        { bookmark: "wip/search", commit: commitId("w"), behind: 3, ahead: 1 },
      ],
    })
    expect(baseChoices(line, "wip/search").map(c => [c.row, c.chosen])).toEqual(
      [
        ["starts from pineta-onto", false],
        ["starts from wip/search · 3 commits behind pineta-onto", true],
      ],
    )
    expect(baseChoices(record({ commit: null }), null)).toEqual([])
    expect(baseChoices(null, null)).toEqual([])
  })
})
