import {
  type CardCommand,
  commitId,
  type FolderAcceptedRecord,
  type FolderBaseRecord,
  type JjAcceptedRecord,
  type JjBaseRecord,
  type JjProposedChangesRecord,
  pointFromCommit,
  pointId,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type CatchUpNow,
  catchUpNow,
  type ParentNow,
  proposedChangesStatus,
  workStripView,
} from "./index.ts"
import { conflictCause } from "./work-strip.ts"

const LANE = threadIdFor("1")
const TIP = commitId("t1")
const T2 = commitId("t2")
const _COPY = commitId("k1")

const proposed: JjProposedChangesRecord = {
  kind: "jj",
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pinetrie-proposed/t-1",
  acceptedAs: null,
  commits: [commitId("w1")],
  ledger: null,
  at: 10,
}

describe("workStripView: the work strip's states", () => {
  const MOVE = {
    base: { kind: "accepted" },
    bookmark: "pinetrie-accepted",
    from: pointId("l1"),
    to: pointId("l2"),
  } as const
  const view = (
    o: JjProposedChangesRecord | undefined,
    activity: "idle" | "turn" | "resolution" | "split" = "idle",
    asked: number | null = null,
    catching: {
      catchUp?: CatchUpNow
      untraced?: boolean
      queued?: readonly CardCommand[]
      parent?: ParentNow | null
      parentRunning?: boolean
    } = {},
  ) =>
    workStripView({
      proposed: proposedChangesStatus(o),
      activity,
      asked,
      base: null,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      wipAhead: 0,
      catchUp: catching.catchUp ?? { kind: "current" },
      untraced: catching.untraced ?? false,
      queued: catching.queued ?? [],
      parent: catching.parent ?? null,
      parentRunning: catching.parentRunning ?? false,
    })
  const at = (v: ReturnType<typeof view>) => [v.state, v.buttons, v.menu]
  test("every state, with its buttons", () => {
    expect(at(view(undefined))).toEqual(["nothing", [], ["update"]])
    expect(at(view({ ...proposed, files: [] }))).toEqual([
      "nothing",
      [],
      ["update"],
    ])
    expect(at(view(proposed, "turn"))).toEqual(["running", [], []])
    expect(at(view(proposed, "resolution"))).toEqual(["busy", [], []])
    expect(at(view(proposed, "split"))).toEqual(["busy", [], []])
    expect(at(view(proposed))).toEqual([
      "ready",
      ["accept", "split"],
      ["describe", "update"],
    ])
    // Only clean proposed changes land on accepted work: no acceptance on a
    // thread on accepted work.
    expect(at(view({ ...proposed, conflicts: ["a.txt"] }))).toEqual([
      "conflicts",
      ["update"],
      [],
    ])
    expect(at(view({ ...proposed, size: 2 }))).toEqual([
      "stack",
      ["accept", "squash"],
      ["update"],
    ])
    expect(at(view({ ...proposed, size: 2, stale: true }))).toEqual([
      "stale",
      ["split", "accept"],
      ["update"],
    ])
    expect(at(view({ ...proposed, edited: true }))).toEqual([
      "edited",
      ["accept", "refresh"],
      ["update"],
    ])
    expect(at(view({ ...proposed, acceptedAs: "zz12345678" }))).toEqual([
      "accepted",
      [],
      ["update"],
    ])
  })
  test("files you are editing are a fact; the state and buttons stay", () => {
    const v = view({ ...proposed, yourEdits: ["b.txt"] })
    expect([v.state, v.buttons, v.facts.touchesYourEdits]).toEqual([
      "ready",
      ["accept", "split"],
      true,
    ])
    expect(view(proposed).facts.touchesYourEdits).toBe(false)
  })
  test("the facts: proposed changes' bookmark, files and size, until it is accepted", () => {
    expect(view({ ...proposed, size: 2 }).facts).toEqual({
      activity: "idle",
      files: 2,
      size: 2,
      conflicts: 0,
      touchesYourEdits: false,
      bookmark: "pinetrie-proposed/t-1",
      held: false,
      acceptedAs: null,
      base: { kind: "accepted" },
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      catchUp: { kind: "current" },
      untraced: false,
      conflictCause: "work",
      parent: null,
      parentResolves: false,
    })
    expect(view(proposed, "turn").facts.files).toBe(2)
    const none = view(undefined).facts
    expect([none.files, none.bookmark, none.acceptedAs]).toEqual([
      0,
      null,
      null,
    ])
    const accepted = view({ ...proposed, acceptedAs: "zz12345678" }).facts
    expect([accepted.files, accepted.bookmark, accepted.acceptedAs]).toEqual([
      0,
      null,
      "zz12345678",
    ])
    // Held: its bookmark is a fact in jj, and nothing in it is to accept.
    const held = view({ ...proposed, files: [] })
    expect([held.facts.held, held.facts.bookmark, held.destinations]).toEqual([
      true,
      "pinetrie-proposed/t-1",
      [],
    ])
  })
  test("proposedChangesStatus: one decoding of a record, which every reader shares", () => {
    expect(proposedChangesStatus(undefined)).toEqual({ kind: "none" })
    expect(proposedChangesStatus({ ...proposed, acceptedAs: "zz" })).toEqual({
      kind: "accepted",
      as: "zz",
    })
    expect(proposedChangesStatus({ ...proposed, files: [] }).kind).toBe("held")
    expect(
      proposedChangesStatus({ ...proposed, files: [], edited: true }).kind,
    ).toBe("open")
    expect(proposedChangesStatus(proposed).kind).toBe("open")
  })
  test("behind its base, catching up stands beside the proposed changes; with nothing to accept, alone", () => {
    const behind = {
      catchUp: { kind: "brings", move: MOVE, files: 2 },
    } as const
    expect(at(view(proposed, "idle", null, behind))).toEqual([
      "ready",
      ["accept", "split", "update"],
      ["describe"],
    ])
    expect(at(view(undefined, "idle", null, behind))).toEqual([
      "nothing",
      ["update"],
      [],
    ])
    expect(view(undefined, "idle", null, behind).facts.catchUp).toEqual(
      behind.catchUp,
    )
    // Running, nothing to catch up with is offered at all.
    expect(at(view(proposed, "turn", null, behind))).toEqual([
      "running",
      [],
      [],
    ])
  })
  test("catching up that would change nothing is listed, but quiet; one not yet read is not", () => {
    const quiet = (catchUp: CatchUpNow) =>
      view(proposed, "idle", null, { catchUp }).quiet
    expect(quiet({ kind: "current" })).toEqual(["update"])
    expect(quiet({ kind: "nothing-new" })).toEqual(["update"])
    expect(quiet({ kind: "unknown" })).toEqual([])
    expect(quiet({ kind: "brings", move: MOVE, files: 1 })).toEqual([])
    // A thread whose WIP is gone continues on accepted work: never quiet.
    const gone = workStripView({
      proposed: proposedChangesStatus(undefined),
      activity: "idle",
      asked: null,
      base: {
        kind: "jj",
        base: { kind: "wip", bookmark: "wip/a" },
        state: "gone",
      },
      parent: null,
      parentRunning: false,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      queued: [],
    })
    expect([gone.menu, gone.quiet]).toEqual([["continue"], []])
  })
  test("an untraced thread's proposed changes you edited can be accepted, never rebuilt", () => {
    const edited = view({ ...proposed, edited: true }, "idle", null, {
      untraced: true,
    })
    expect(at(edited)).toEqual(["edited", ["accept", "update"], []])
  })
  test("an untraced thread offers nothing, and catching up beside it, never quiet", () => {
    const untraced = view(undefined, "idle", null, { untraced: true })
    expect([...at(untraced), untraced.quiet, untraced.facts.untraced]).toEqual([
      "nothing",
      ["update"],
      [],
      [],
      true,
    ])
  })
  test("a card bringing the thread up to date, queued on an idle lane: the proposed changes are busy with it", () => {
    const queued = view(proposed, "idle", null, {
      queued: ["bring-up-to-date"],
    })
    expect([queued.state, queued.buttons, queued.facts.activity]).toEqual([
      "busy",
      [],
      "catch-up",
    ])
    expect(
      view(proposed, "turn", null, { queued: ["bring-up-to-date"] }).facts
        .activity,
    ).toBe("turn")
  })
  test("a split queued is not a catch-up: the proposed changes stay ready, its split button quiet", () => {
    const queued = view(proposed, "idle", null, { queued: ["split"] })
    expect([queued.state, queued.facts.activity]).toEqual(["ready", "idle"])
    expect(queued.quiet).toContain("split")
    expect(view(proposed, "idle", null).quiet).not.toContain("split")
  })
  test("catchUpNow: from the commit a lane last caught up with to the base's now", () => {
    const moved = (...args: Parameters<typeof catchUpNow>) =>
      catchUpNow(...args).kind !== "current"
    const L1 = commitId("l1")
    const L2 = commitId("l2")
    const W1 = commitId("w1")
    const line = (
      commit: typeof L1 | null,
      wips = [] as { bookmark: string; commit: typeof L1 }[],
    ): JjAcceptedRecord => ({
      kind: "jj",
      acceptedBookmark: "pinetrie-accepted",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit,
      heads: { current: null, proposed: "" },
      log: { current: null, proposed: "" },
      wips: wips.map(w => ({ ...w, behind: 0, ahead: 1 })),
      yours: {
        behind: 0,
        ahead: 0,
        catchUp: null,
        conflicts: { commits: 0, files: [] },
      },
      publishCatchesUp: true,
    })
    const onAccepted: JjBaseRecord = {
      kind: "jj",
      lane: LANE,
      base: { kind: "accepted" as const },
      start: L1,
      state: "ok" as const,
      catchUp: null,
      untraced: [],
      work: "some",
    }
    const onWip: JjBaseRecord = {
      kind: "jj",
      lane: LANE,
      base: { kind: "wip" as const, bookmark: "wip/a" },
      start: W1,
      state: "ok" as const,
      catchUp: null,
      untraced: [],
      work: "some",
    }
    expect(moved(onAccepted, line(L1))).toBe(false)
    expect(moved(onAccepted, line(L2))).toBe(true)
    expect(moved(onAccepted, line(null))).toBe(false)
    // A lane the host never read (no record): nothing is claimed, unless
    // there is no line to catch up with.
    expect(catchUpNow(undefined, line(L2))).toEqual({ kind: "unknown" })
    expect(catchUpNow(undefined, line(null))).toEqual({ kind: "current" })
    expect(moved(onWip, line(L2, [{ bookmark: "wip/a", commit: W1 }]))).toBe(
      false,
    )
    expect(
      moved(onWip, line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }])),
    ).toBe(true)
    // Landed: on accepted work now, and caught up with it only once merged.
    expect(moved({ ...onWip, state: "landed" }, line(L2))).toBe(true)
    expect(moved({ ...onWip, state: "gone" }, line(L2))).toBe(false)
    expect(catchUpNow(onAccepted, line(L2))).toEqual({ kind: "unknown" })
    expect(
      catchUpNow(
        {
          ...onWip,
          catchUp: { tip: commitId("t"), to: commitId("w2"), files: ["w"] },
        },
        line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }]),
      ),
    ).toMatchObject({ move: { bookmark: "wip/a", from: W1, to: "w2" } })
    // The host's read counts only at the commit the base is at now.
    const read = (to: typeof L1, files: string[]): JjBaseRecord => ({
      ...onAccepted,
      catchUp: { tip: commitId("t"), to, files },
    })
    expect(catchUpNow(read(L2, []), line(L2))).toEqual({ kind: "nothing-new" })
    // Only what brings files says the move: the header's ↓ names it.
    const move = {
      base: { kind: "accepted" },
      bookmark: "pinetrie-accepted",
      from: L1,
      to: L2,
    }
    expect(catchUpNow(read(L2, ["a", "b"]), line(L2))).toEqual({
      kind: "brings",
      move,
      files: 2,
    })
    expect(catchUpNow(read(commitId("l0"), []), line(L2))).toEqual({
      kind: "unknown",
    })
  })
  test("catchUpNow for a folder: from the state a lane last caught up with to accepted work's newest", () => {
    const FIRST = pointId("line-0192aaaa")
    const SECOND = pointId("line-0192bbbb")
    const folder = (newest: typeof FIRST): FolderAcceptedRecord => ({
      kind: "folder",
      newest,
      kept: [newest],
      at: 1,
    })
    const base = (
      catchUp: FolderBaseRecord["catchUp"] = null,
    ): FolderBaseRecord => ({
      kind: "folder",
      lane: LANE,
      start: FIRST,
      catchUp,
      work: "some",
    })
    const read = (to: typeof FIRST, files: string[]) =>
      base({ tip: pointId("turn-0192cccc"), to, files })
    expect(catchUpNow(base(), folder(FIRST))).toEqual({ kind: "current" })
    expect(catchUpNow(base(), folder(SECOND))).toEqual({ kind: "unknown" })
    expect(catchUpNow(undefined, folder(SECOND))).toEqual({ kind: "unknown" })
    expect(catchUpNow(read(SECOND, []), folder(SECOND))).toEqual({
      kind: "nothing-new",
    })
    expect(catchUpNow(read(SECOND, ["a"]), folder(SECOND))).toEqual({
      kind: "brings",
      move: {
        base: { kind: "accepted" },
        bookmark: null,
        from: FIRST,
        to: SECOND,
      },
      files: 1,
    })
    expect(catchUpNow(read(FIRST, ["a"]), folder(SECOND))).toEqual({
      kind: "unknown",
    })
  })
  const folderView = (conflicts: readonly string[] = []) =>
    workStripView({
      proposed: proposedChangesStatus({
        kind: "folder",
        lane: LANE,
        start: pointId("line-0192aaaa"),
        tip: pointId("turn-0192bbbb"),
        files: ["a.txt"],
        conflicts,
        description: null,
        at: 10,
      }),
      activity: "idle",
      asked: null,
      base: { kind: "folder" },
      parent: null,
      parentRunning: false,
      into: { kind: "folder" },
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      queued: [],
    })
  test("folder proposed changes are accepted or described, never split", () => {
    const v = folderView()
    expect(at(v)).toEqual(["ready", ["accept"], ["describe", "update"]])
    expect([v.facts.size, v.facts.bookmark]).toEqual([1, null])
  })
  test("conflicted folder proposed changes offer to choose versions first", () => {
    expect(at(folderView(["a.txt"]))).toEqual([
      "conflicts",
      ["choose-versions", "update"],
      [],
    ])
  })
  test("folder proposed changes' accept is live, into accepted work, its one destination", () => {
    const v = folderView()
    expect(v.destinations).toEqual([
      { bookmark: "", kind: "accepted", bringsAlong: 0, final: true },
    ])
    expect(v.quiet).not.toContain("accept")
  })
  test("jj proposed changes before accepted work are read has no accept", () => {
    const v = workStripView({
      proposed: proposedChangesStatus(proposed),
      activity: "idle",
      asked: null,
      base: null,
      parent: null,
      parentRunning: false,
      into: null,
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      queued: [],
    })
    expect([v.buttons, v.destinations]).toEqual([["split"], []])
  })
  test("an ask about a conflict counts only when newer than the proposed changes", () => {
    expect(view(proposed, "idle", 20).state).toBe("needs_you")
    expect(view(proposed, "idle", 5).state).toBe("ready")
    expect(view(proposed, "idle", null).state).toBe("ready")
  })
})

describe("a conflict that came with the copy, and the thread it branched from", () => {
  const P = threadIdFor("p")
  const parent = (over: Partial<ParentNow> = {}): ParentNow => ({
    kind: "parent",
    lane: P,
    name: "amber-fox" as ThreadName,
    newest: pointFromCommit(T2),
    caughtUpWith: pointFromCommit(TIP),
    conflicts: [],
    ...over,
  })
  const view = (
    o: JjProposedChangesRecord,
    p: ParentNow | null,
    parentRunning = false,
  ) =>
    workStripView({
      proposed: proposedChangesStatus(o),
      activity: "idle",
      asked: null,
      base: null,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      queued: [],
      parent: p,
      parentRunning,
    })
  const fromStart = {
    ...proposed,
    conflicts: ["a.txt"],
    startConflicts: ["a.txt"],
  }
  test("conflictCause: the start only when every conflicted file was conflicted there", () => {
    expect(conflictCause(proposed)).toBe("work")
    expect(conflictCause(fromStart)).toBe("start")
    expect(
      conflictCause({
        ...proposed,
        conflicts: ["a.txt", "b.txt"],
        startConflicts: ["a.txt"],
      }),
    ).toBe("work")
    expect(
      conflictCause({ ...proposed, conflicts: [], startConflicts: ["a.txt"] }),
    ).toBe("work")
  })
  test("a start conflict the parent has resolved is caught up with the parent", () => {
    const v = view(fromStart, parent())
    expect([v.state, v.buttons, v.menu]).toEqual([
      "conflicts",
      ["catch-up-parent"],
      [],
    ])
    expect(v.facts).toMatchObject({
      conflictCause: "start",
      parent: { kind: "parent", lane: P, name: "amber-fox" },
      parentResolves: true,
    })
  })
  test("one the parent still has, or a parent not ahead, or a conflict of the lane's own, is caught up with the base", () => {
    expect(view(fromStart, parent({ conflicts: ["a.txt"] })).buttons).toEqual([
      "update",
    ])
    expect(
      view(fromStart, parent({ newest: pointFromCommit(TIP) })).buttons,
    ).toEqual(["update"])
    expect(view(fromStart, null).buttons).toEqual(["update"])
    expect(
      view({ ...proposed, conflicts: ["a.txt"] }, parent()).buttons,
    ).toEqual(["update"])
  })
  test("while the parent is ahead it is in the menu, quiet while it runs", () => {
    expect(view(proposed, parent()).menu).toEqual([
      "describe",
      "update",
      "catch-up-parent",
    ])
    expect(
      view(proposed, parent({ newest: pointFromCommit(TIP) })).menu,
    ).toEqual(["describe", "update"])
    expect(view(proposed, parent(), true).quiet).toContain("catch-up-parent")
    expect(view(fromStart, parent(), true).quiet).toEqual(["catch-up-parent"])
  })
})
