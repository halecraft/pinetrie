import { commitId, type LineRecord, laneNameForThread } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { baseWords } from "./column-view.ts"
import {
  type LineSection,
  lineNote,
  lineView,
  lineWords,
  resolveIntent,
} from "./line-view.ts"
import { baseChoices } from "./send.ts"

const record = (over: Partial<LineRecord> = {}): LineRecord => ({
  onto: "pineta-onto",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: commitId("m0"), behind: 0, ahead: 0 },
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

/** A section's words, by its key. */
const section = (
  record: LineRecord,
  key: "project" | "yours",
): LineSection | undefined =>
  lineWords(lineView(record)).sections.find(s => s.key === key)

const yours = (over: Partial<LineRecord["yours"]>): LineRecord["yours"] => ({
  behind: 2,
  ahead: null,
  follow: null,
  conflicts: { commits: 0, files: [] },
  ...over,
})

describe("lineView and lineWords (ADR-0060)", () => {
  test("no line yet: set up at your @-, showing the heads it writes", () => {
    const view = lineView(record({ commit: null }))
    expect(view).toMatchObject({
      state: "unset",
      project: { actions: ["setup"] },
      yours: null,
    })
    const [project] = lineWords(view).sections
    expect(project?.actions).toEqual([
      { action: "setup", label: "set up the project" },
    ])
    expect(project?.notes[1]).toContain("builtin_immutable_heads() | …")
    expect(project?.notes[2]).toContain("builtin_log() | …")
    expect(project?.notes[3]).toContain('bookmarks(glob:"pineta-offer/*")')
  })
  test("a host that admits others, before setup: not set up yet, the jj instructions in its title", () => {
    const words = lineWords(lineView(record({ commit: null, commands: false })))
    expect(words.trigger).toBe("◆ project")
    expect(words.label).toContain(
      "create pineta-onto with jj on the host's machine",
    )
    expect(words.sections).toEqual([
      {
        key: "project",
        heading: "The project",
        notes: ["the project is not set up yet"],
        actions: [],
      },
    ])
  })
  test("a host that admits others has no section for your files, nor their actions", () => {
    const view = lineView(
      record({
        commands: false,
        yours: yours({
          ahead: 2,
          follow: { changes: 1, conflicts: [], heads: 0 },
          conflicts: { commits: 1, files: ["g.txt"] },
        }),
      }),
    )
    expect(view.yours).toBe(null)
    expect(lineWords(view).sections.map(s => s.key)).toEqual(["project"])
  })
  test("your work above the line: add it to the project, counted", () => {
    const words = section(
      record({ yours: yours({ behind: 0, ahead: 2 }) }),
      "yours",
    )
    expect(words?.actions).toEqual([
      {
        action: "land",
        label: "add my work to the project (2 commits)",
        title: "moves pineta-onto forward to your @-",
      },
    ])
    expect(words?.notes).toEqual(["your files have everything in the project"])
  })
  test("the trigger counts what is not yet on main, never your files being behind; its bookmark only in the label", () => {
    const quiet = lineWords(lineView(record({ yours: yours({ behind: 3 }) })))
    expect(quiet.trigger).toBe("◆ project")
    expect(quiet.label).toContain("pineta-onto")
    const unpublished = lineWords(
      lineView(
        record({ published: { commit: commitId("m0"), behind: 2, ahead: 0 } }),
      ),
    )
    expect(unpublished.trigger).toBe("◆ project · 2 unpublished")
    expect(unpublished.label).toContain("2 commits not yet on main")
    expect(unpublished.sections[0]?.heading).toBe("The project")
  })
  test("no record: absent", () => {
    expect(lineView(null).state).toBe("absent")
  })
})

describe("publishing the project (ADR-0076)", () => {
  const published = (behind: number, ahead = 0, commit: string | null = "m0") =>
    record({
      published: {
        commit: commit === null ? null : commitId(commit),
        behind,
        ahead,
      },
    })
  test("unpublished commits: counted, and published to main on any host", () => {
    for (const commands of [true, false]) {
      const words = section({ ...published(2), commands }, "project")
      expect(words?.notes).toEqual(["2 commits not yet on main"])
      expect(words?.actions).toEqual([
        {
          action: "publish",
          label: "publish to main (2 commits)",
          title: "moves main forward to pineta-onto",
        },
      ])
    }
  })
  test("everything on main: said, and nothing to publish", () => {
    const words = section(published(0), "project")
    expect(words?.notes).toEqual(["everything in the project is on main"])
    expect(words?.actions).toEqual([])
  })
  test("main with commits the project lacks, or no main: not offered, and why", () => {
    expect(section(published(3, 1), "project")).toMatchObject({
      notes: [
        "main has 1 commit the project doesn't: bring it into the project first",
      ],
      actions: [],
    })
    expect(section(published(0, 0, null), "project")).toMatchObject({
      notes: ["this repo has no main bookmark to publish to"],
      actions: [],
    })
    expect(lineWords(lineView(published(0, 0, null))).trigger).toBe("◆ project")
  })
})

describe("update my files, and resolving what conflicts (ADR-0061)", () => {
  test("behind, with a preview: what is new and what would conflict, never the files it changes; their count in the title", () => {
    const words = section(
      record({
        yours: yours({
          follow: { changes: 116, conflicts: ["b.txt"], heads: 1 },
        }),
      }),
      "yours",
    )
    expect(words?.heading).toBe("Your files")
    expect(words?.notes).toEqual([
      "2 new commits in the project since you last updated",
      "1 file would conflict: b.txt; the agent can resolve them after",
      "1 other line of your work moves with it",
    ])
    expect(words?.actions).toEqual([
      {
        action: "follow",
        label: "update my files",
        title:
          "changes 116 files · your work stays on top · jj diff --from 'fork_point(@ | pineta-onto)' --to pineta-onto",
      },
    ])
  })
  test("behind with no preview (no commit in common): no action, and jj said", () => {
    const words = section(record({ yours: yours({}) }), "yours")
    expect(words?.actions).toEqual([])
    expect(words?.notes).toEqual([
      "2 new commits in the project since you last updated: rebase onto pineta-onto in jj",
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
    expect(view.yours?.actions).toEqual(["resolve"])
    expect(lineWords(view).sections[1]?.notes).toEqual([
      "your files have conflicts in 1 file: g.txt",
    ])
    expect(
      section(
        record({
          yours: yours({ behind: 0, conflicts: { commits: 1, files: [] } }),
        }),
        "yours",
      )?.notes,
    ).toEqual(["1 commit of yours has conflicts"])
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
      "a publish out",
      { kind: "sent", id: "s", action: "publish", to: null },
      "publishing the project…",
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
