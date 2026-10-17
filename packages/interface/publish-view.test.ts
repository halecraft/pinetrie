import {
  commitId,
  ERR,
  type JjAcceptedRecord,
  pointId,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { baseWords } from "./column-view.ts"
import { publishToast, publishView, publishWords } from "./publish-view.ts"

const yours = (
  over: Partial<JjAcceptedRecord["yours"]> = {},
): JjAcceptedRecord["yours"] => ({
  behind: 0,
  ahead: 0,
  catchUp: null,
  conflicts: { commits: 0, files: [] },
  ...over,
})

const record = (over: Partial<JjAcceptedRecord> = {}): JjAcceptedRecord => ({
  kind: "jj",
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
const words = (r: JjAcceptedRecord) => {
  const view = publishView(r)
  if (view.kind === "absent" || view.kind === "hidden")
    throw new Error(`no button: ${view.kind}`)
  return publishWords(view, null)
}

describe("publishView: one button, only with something to do", () => {
  test("no record: absent", () => {
    expect(publishView(null).kind).toBe("absent")
  })
  test("a folder project: absent, with nothing to set up or publish to", () => {
    expect(
      publishView({
        kind: "folder",
        newest: pointId("line-0192aaaa"),
        kept: [],
        at: 1,
      }).kind,
    ).toBe("absent")
  })
  test("no line yet: set up at your @-, showing the heads it writes", () => {
    const w = words(record({ commit: null }))
    expect(w.label).toBe("set up")
    if (w.kind !== "setup") throw new Error(w.kind)
    expect(w.heading).toBe("Set up accepted work: pinetrie-accepted")
    expect(w.notes[1]).toContain("builtin_immutable_heads() | …")
    expect(w.notes[2]).toContain("builtin_log() | …")
    expect(w.notes[3]).toContain('bookmarks(glob:"pinetrie-proposed/*")')
  })
  test("before setup, set up whatever publish.catchUp says", () => {
    expect(
      publishView(record({ commit: null, publishCatchesUp: false })).kind,
    ).toBe("setup")
  })
  test("nothing to publish: hidden; the working copy or your commits alone are something", () => {
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

describe("publishWords: what the button says it will do", () => {
  test("main forward over accepted work, the host's move in jj", () => {
    const w = words(record(unpublished(2)))
    expect(w.label).toBe("publish")
    expect(w.title).toBe(
      "moves main forward over 2 accepted commits · jj bookmark move main --to pinetrie-accepted",
    )
  })
  test("with publish.catchUp off, the title says the working copy does not move, naming the setting", () => {
    const off = (y: Partial<JjAcceptedRecord["yours"]>) =>
      words(
        record({ ...unpublished(2), publishCatchesUp: false, yours: yours(y) }),
      ).title
    expect(off({ behind: 1, ahead: 1 })).toBe(
      "moves main forward over 2 accepted commits; the working copy does not move (publish.catchUp is off) · jj bookmark move main --to pinetrie-accepted",
    )
    expect(off({})).toBe(
      "moves main forward over 2 accepted commits · jj bookmark move main --to pinetrie-accepted",
    )
  })
  test("with publish.catchUp on: the working copy catches up, your commits are accepted, then main moves", () => {
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
      "catches the working copy up with accepted work (changes 4 files; 1 other line of your work moves with it), accepts your 2 commits, then moves main forward over 1 accepted commit · jj rebase -b @ -d pinetrie-accepted; jj bookmark move pinetrie-accepted main --to @-",
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

describe("publishToast", () => {
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
      { text: "not done: nothing to publish" },
    ],
    [
      "a conflict in the working copy is said, and offers no agent",
      {
        kind: "refused",
        code: ERR.YOURS_CONFLICT,
        action: "publish",
        message: "the working copy has conflicts in g.txt",
      },
      { text: "not done: the working copy has conflicts in g.txt" },
    ],
    [
      "a failure",
      { kind: "failed", action: "publish", message: "jj said no" },
      { text: "it failed, and may be part done: jj said no" },
    ],
  ] as const)("%s", (_, acting, toast) => {
    expect(publishToast(acting)).toEqual(toast)
  })
})

describe("the thread's base in its header, and the bases a new lane may start from", () => {
  const lane = threadIdFor("1")
  const base = (state: "ok" | "landed" | "gone") =>
    ({
      kind: "jj",
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
})
