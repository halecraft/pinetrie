import { commitId, type LineRecord, laneNameForThread } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { baseWords } from "./column-view.ts"
import { lineNote, lineView, lineWords, resolveIntent } from "./line-view.ts"
import { baseChoices } from "./send.ts"

const record = (over: Partial<LineRecord> = {}): LineRecord => ({
  onto: "pineta-onto",
  wipPrefix: "wip/",
  commit: commitId("c1"),
  heads: { current: null, proposed: "builtin_immutable_heads() | …" },
  log: { current: null, proposed: "builtin_log() | …" },
  wips: [],
  yours: {
    behind: 0,
    ahead: 0,
    follow: null,
    conflicts: { commits: 0, files: [] },
  },
  commands: true,
  ...over,
})

describe("lineView and lineWords (ADR-0060)", () => {
  test("no line yet: set up at your @-, showing the heads it writes", () => {
    const view = lineView(record({ commit: null }))
    expect(view).toMatchObject({ state: "unset", actions: ["setup"] })
    const words = lineWords(view)
    expect(words.actions).toEqual([
      { action: "setup", label: "set up the project" },
    ])
    expect(words.notes[1]).toContain("builtin_immutable_heads() | …")
    expect(words.notes[2]).toContain("builtin_log() | …")
    expect(words.notes[3]).toContain('bookmarks(glob:"pineta-offer/*")')
  })
  test("a host that admits others offers no line action, and says why", () => {
    const view = lineView(record({ commit: null, commands: false }))
    expect(view.actions).toEqual([])
    expect(lineWords(view).notes[0]).toContain("with jj on its machine")
    expect(
      lineView(
        record({
          yours: {
            behind: 0,
            ahead: 2,
            follow: null,
            conflicts: { commits: 0, files: [] },
          },
          commands: false,
        }),
      ).actions,
    ).toEqual([])
  })
  test("your work above the line: add it to the project, counted; behind it: say so", () => {
    const ahead = lineView(
      record({
        yours: {
          behind: 0,
          ahead: 2,
          follow: null,
          conflicts: { commits: 0, files: [] },
        },
      }),
    )
    expect(lineWords(ahead).actions).toEqual([
      { action: "land", label: "add my work to the project (2 commits)" },
    ])
    expect(lineWords(ahead).notes).toEqual([
      "your files have everything in the project",
    ])
    const behind = lineWords(
      lineView(
        record({
          yours: {
            behind: 3,
            ahead: null,
            follow: null,
            conflicts: { commits: 0, files: [] },
          },
        }),
      ),
    )
    expect(behind.actions).toEqual([])
    expect(behind.notes[0]).toBe(
      "the project has 3 commits your files don't: rebase onto pineta-onto in jj",
    )
  })
  test("the header's button says project; its bookmark only in the label", () => {
    const words = lineWords(lineView(record()))
    expect([words.trigger, words.heading]).toEqual(["◆ project", "The project"])
    expect(words.label).toContain("pineta-onto")
  })
  test("no record: absent", () => {
    expect(lineView(null).state).toBe("absent")
  })
})

describe("update my files, and resolving what conflicts (ADR-0061)", () => {
  const yours = (over: Partial<LineRecord["yours"]>): LineRecord["yours"] => ({
    behind: 2,
    ahead: null,
    follow: null,
    conflicts: { commits: 0, files: [] },
    ...over,
  })
  test("behind, with a preview: what updating changes and what would conflict, then the action", () => {
    const words = lineWords(
      lineView(
        record({
          yours: yours({
            follow: {
              files: ["a.txt", "b.txt", "c.txt", "d.txt"],
              conflicts: ["b.txt"],
              heads: 1,
            },
          }),
        }),
      ),
    )
    expect(words.notes).toEqual([
      "the project has 2 commits your files don't",
      "updating changes 4 files: a.txt, b.txt, c.txt and 1 more",
      "1 file would conflict: b.txt; the agent can resolve them after",
      "1 other line of your work moves with it",
    ])
    expect(words.actions).toEqual([
      { action: "follow", label: "update my files" },
    ])
  })
  test("behind with no preview (no commit in common): no action, and jj said", () => {
    const words = lineWords(lineView(record({ yours: yours({}) })))
    expect(words.actions).toEqual([])
    expect(words.notes).toEqual([
      "the project has 2 commits your files don't: rebase onto pineta-onto in jj",
    ])
  })
  test("conflicts in your files: said first, and resolved with the agent", () => {
    const view = lineView(
      record({
        yours: yours({
          behind: 0,
          conflicts: { commits: 2, files: ["g.txt"] },
        }),
      }),
    )
    expect(view.actions).toEqual(["resolve"])
    expect(lineWords(view).notes).toEqual([
      "your files have conflicts in 1 file: g.txt",
    ])
    expect(
      lineWords(
        lineView(
          record({
            yours: yours({
              behind: 0,
              conflicts: { commits: 1, files: [] },
            }),
          }),
        ),
      ).notes,
    ).toEqual(["1 commit of yours has conflicts"])
  })
  test("a host that admits others offers neither", () => {
    expect(
      lineView(
        record({
          commands: false,
          yours: yours({
            follow: { files: [], conflicts: [], heads: 0 },
            conflicts: { commits: 1, files: ["g.txt"] },
          }),
        }),
      ).actions,
    ).toEqual([])
  })
  test("resolveIntent: a new agent tab in your files, its box holding the skill and the files", () => {
    const facts = lineView(
      record({
        yours: yours({ conflicts: { commits: 1, files: ["g.txt"] } }),
      }),
    ).facts
    expect(
      resolveIntent(
        { kind: "lanes", root: "/work", rootDefault: "own" },
        facts,
      ),
    ).toEqual({
      kind: "newTab",
      asksAgent: true,
      prefill: {
        text: "/pineta:skill:resolve-conflicts My files were updated from the project (pineta-onto) and conflict in g.txt. Resolve them in my working copy.",
        blank: false,
        work: { kind: "direct", dir: "/work" },
      },
    })
    expect(resolveIntent(null, facts)).toBe(null)
  })
  test.each([
    ["nothing", null, null],
    [
      "a setup out",
      { kind: "sent", id: "s", action: "setup", to: null },
      "setting up the project…",
    ],
    [
      "a land out",
      { kind: "sent", id: "s", action: "land", to: null },
      "adding your work to the project…",
    ],
    [
      "a follow out",
      { kind: "sent", id: "s", action: "follow", to: null },
      "updating your files…",
    ],
    [
      "a refusal",
      { kind: "refused", action: "land", message: "nothing to take" },
      "not done: nothing to take",
    ],
    [
      "a failure",
      { kind: "failed", action: "follow", message: "jj said no" },
      "it failed, and may be part done: jj said no",
    ],
  ] as const)("lineNote: %s", (_, acting, note) => {
    expect(lineNote(acting)).toBe(note)
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
      catchUp: null,
      untraced: [],
    }) as const
  test("baseWords: a WIP while it is one, gone when gone, nothing on the line", () => {
    expect(baseWords(base("ok"))).toBe("on wip/search")
    expect(baseWords(base("gone"))).toBe("wip/search is gone")
    expect(baseWords(base("landed"))).toBeNull()
    expect(baseWords({ ...base("ok"), base: { kind: "line" } })).toBeNull()
    expect(baseWords(undefined)).toBeNull()
  })
  test("baseChoices: the project first, then each WIP with how far behind it is; none with no line, or no WIP", () => {
    const line = record({
      wips: [
        { bookmark: "wip/search", commit: commitId("w"), behind: 3, ahead: 1 },
      ],
    })
    expect(
      baseChoices(line, "wip/search").map(c => [c.row, c.detail, c.chosen]),
    ).toEqual([
      ["the project", null, false],
      [
        "wip/search",
        "your unfinished work · 3 commits behind the project",
        true,
      ],
    ])
    expect(baseChoices(line, null)[0]?.title).toBe("pineta-onto at c1")
    expect(baseChoices(record(), null)).toEqual([])
    expect(baseChoices(record({ commit: null }), null)).toEqual([])
    expect(baseChoices(null, null)).toEqual([])
  })
})
