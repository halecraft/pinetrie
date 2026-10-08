import {
  type AcceptedRecord,
  commitId,
  ERR,
  laneNameForThread,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { baseWords } from "./column-view.ts"
import {
  publishToast,
  publishView,
  publishWords,
  resolveIntent,
} from "./publish-view.ts"
import { baseChoices } from "./send.ts"

const yours = (
  over: Partial<AcceptedRecord["yours"]> = {},
): AcceptedRecord["yours"] => ({
  behind: 0,
  ahead: 0,
  catchUp: null,
  conflicts: { commits: 0, files: [] },
  ...over,
})

const record = (over: Partial<AcceptedRecord> = {}): AcceptedRecord => ({
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: commitId("m0"), behind: 0, ahead: 0 },
  commit: commitId("c1"),
  heads: { current: null, proposed: "builtin_immutable_heads() | …" },
  log: { current: null, proposed: "builtin_log() | …" },
  wips: [],
  yours: yours(),
  publishCatchesUp: true,
  ...over,
})

const unpublished = (behind: number, ahead = 0) => ({
  published: { commit: commitId("m0"), behind, ahead },
})

/** The words of a view that draws a button. */
const words = (r: AcceptedRecord) => {
  const view = publishView(r)
  if (view.kind === "absent" || view.kind === "hidden")
    throw new Error(`no button: ${view.kind}`)
  return publishWords(view, null)
}

describe("publishView: one button, only with something to do (ADR-0090)", () => {
  test("no record: absent", () => {
    expect(publishView(null).kind).toBe("absent")
  })
  test("no line yet: set up at your @-, showing the heads it writes", () => {
    const w = words(record({ commit: null }))
    expect(w.label).toBe("set up")
    if (w.kind !== "setup") throw new Error(w.kind)
    expect(w.heading).toBe("Set up accepted work: pinetrie-accepted")
    expect(w.notes[1]).toContain("builtin_immutable_heads() | …")
    expect(w.notes[2]).toContain("builtin_log() | …")
    expect(w.notes[3]).toContain('bookmarks(glob:"pinetrie-offer/*")')
  })
  test("before setup, set up whatever publish.catchUp says", () => {
    expect(
      publishView(record({ commit: null, publishCatchesUp: false })).kind,
    ).toBe("setup")
  })
  test("nothing to publish: hidden; your files or commits alone are something", () => {
    expect(publishView(record()).kind).toBe("hidden")
    expect(publishView(record({ yours: yours({ ahead: 1 }) })).kind).toBe(
      "publish",
    )
    expect(
      publishView(
        record({ publishCatchesUp: false, yours: yours({ ahead: 1 }) }),
      ).kind,
    ).toBe("hidden")
  })
})

describe("publishWords: what the button says it will do (ADR-0090)", () => {
  test("main forward over accepted work, the host's move in jj", () => {
    const w = words(record(unpublished(2)))
    expect(w.label).toBe("publish")
    expect(w.title).toBe(
      "moves main forward over 2 accepted commits · jj bookmark move main --to pinetrie-accepted",
    )
  })
  test("with publish.catchUp off, the title says your files do not move, naming the setting", () => {
    const off = (y: Partial<AcceptedRecord["yours"]>) =>
      words(
        record({ ...unpublished(2), publishCatchesUp: false, yours: yours(y) }),
      ).title
    expect(off({ behind: 1, ahead: 1 })).toBe(
      "moves main forward over 2 accepted commits; your files do not move (publish.catchUp is off) · jj bookmark move main --to pinetrie-accepted",
    )
    expect(off({})).toBe(
      "moves main forward over 2 accepted commits · jj bookmark move main --to pinetrie-accepted",
    )
  })
  test("with publish.catchUp on: your files catch up, your commits are accepted, then main moves", () => {
    const w = words(
      record({
        ...unpublished(1),
        yours: yours({
          behind: 1,
          ahead: 2,
          catchUp: { changes: 4, conflicts: [], heads: 1 },
        }),
      }),
    )
    expect(w.title).toBe(
      "catches your files up with accepted work (changes 4 files; 1 other line of your work moves with it), accepts your 2 commits, then moves main forward over 1 accepted commit · jj rebase -b @ -d pinetrie-accepted; jj bookmark move pinetrie-accepted main --to @-",
    )
  })
  test("a publish the host would refuse leads its title with why", () => {
    const w = words(record(unpublished(3, 1)))
    expect(w.title.startsWith("main has 1 commit accepted work doesn't")).toBe(
      true,
    )
    expect(w.kind === "publish" && w.refused).toBe(true)
  })
  test("while it is out, the button says so", () => {
    const view = publishView(record(unpublished(1)))
    if (view.kind !== "publish") throw new Error(view.kind)
    expect(
      publishWords(view, {
        kind: "sent",
        id: "s",
        action: "publish",
        to: null,
      }).label,
    ).toBe("publishing…")
  })
})

describe("publishToast and resolveIntent (ADR-0090)", () => {
  test.each([
    ["nothing", null, null],
    [
      "a publish out",
      { kind: "sent", id: "s", action: "publish", to: null },
      null,
    ],
    [
      "a refusal",
      {
        kind: "refused",
        code: ERR.REFUSED,
        action: "publish",
        message: "nothing to publish",
      },
      { text: "not done: nothing to publish", resolve: false },
    ],
    [
      "your files conflict: resolve with the agent",
      {
        kind: "refused",
        code: ERR.YOURS_CONFLICT,
        action: "publish",
        message: "your files have conflicts in g.txt",
      },
      { text: "not done: your files have conflicts in g.txt", resolve: true },
    ],
    [
      "a failure",
      { kind: "failed", action: "publish", message: "jj said no" },
      { text: "it failed, and may be part done: jj said no", resolve: false },
    ],
  ] as const)("%s", (_, acting, toast) => {
    expect(publishToast(acting)).toEqual(toast)
  })
  test("resolveIntent: a new agent tab in your files, its box holding the skill and what conflicts", () => {
    const project = {
      kind: "lanes",
      root: "/work",
      rootDefault: "own",
    } as const
    expect(
      resolveIntent(
        project,
        record({
          yours: yours({ conflicts: { commits: 1, files: ["g.txt"] } }),
        }),
      ),
    ).toEqual({
      kind: "newTab",
      asksAgent: true,
      prefill: {
        text: "/pinetrie:skill:resolve-conflicts My files have conflicts in g.txt. Resolve them in my working copy.",
        blank: false,
        work: { kind: "direct", dir: "/work" },
      },
    })
    const would = resolveIntent(
      project,
      record({
        yours: yours({
          behind: 1,
          catchUp: { changes: 1, conflicts: ["a.ts", "b.ts"], heads: 0 },
        }),
      }),
    )
    expect(would?.kind === "newTab" ? would.prefill?.text : null).toBe(
      "/pinetrie:skill:resolve-conflicts Catching my files up with accepted work (pinetrie-accepted) conflicts in a.ts, b.ts. Rebase my work onto it (jj rebase -b @ -d pinetrie-accepted) and resolve the conflicts in my working copy.",
    )
    // A catch-up reverted for your commits' conflicts left none to name.
    const reverted = resolveIntent(
      project,
      record({ yours: yours({ behind: 1 }) }),
    )
    expect(reverted?.kind === "newTab" ? reverted.prefill?.text : null).toBe(
      "/pinetrie:skill:resolve-conflicts Catching my files up with accepted work (pinetrie-accepted) conflicts. Rebase my work onto it (jj rebase -b @ -d pinetrie-accepted) and resolve the conflicts in my working copy.",
    )
    expect(resolveIntent(null, record())).toBe(null)
  })
})

describe("the thread's base in its header, and the bases a new lane may start from (ADR-0104)", () => {
  const lane = laneNameForThread("1")
  const base = (state: "ok" | "landed" | "gone") =>
    ({
      lane,
      base: { kind: "wip", bookmark: "wip/search" },
      start: commitId("c"),
      state,
      catchUp: null,
      untraced: [],
      work: "some",
    }) as const
  test("baseWords: a WIP while it is one, gone when gone, nothing on accepted work", () => {
    expect(baseWords(base("ok"))).toBe("on wip/search")
    expect(baseWords(base("gone"))).toBe("wip/search is gone")
    expect(baseWords(base("landed"))).toBeNull()
    expect(baseWords({ ...base("ok"), base: { kind: "accepted" } })).toBeNull()
    expect(baseWords(undefined)).toBeNull()
  })
  test("baseChoices: accepted work first, then each WIP with how far behind it is; none with no line, or no WIP", () => {
    const line = record({
      wips: [
        { bookmark: "wip/search", commit: commitId("w"), behind: 3, ahead: 1 },
      ],
    })
    expect(
      baseChoices(line, "wip/search").map(c => [c.row, c.detail, c.chosen]),
    ).toEqual([
      ["accepted work", null, false],
      [
        "wip/search",
        "your unfinished work · 3 commits behind accepted work",
        true,
      ],
    ])
    expect(baseChoices(line, null)[0]?.title).toBe("pinetrie-accepted at c1")
    expect(baseChoices(record(), null)).toEqual([])
    expect(baseChoices(record({ commit: null }), null)).toEqual([])
    expect(baseChoices(null, null)).toEqual([])
  })
})
