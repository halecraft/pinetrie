import {
  commitId,
  type FolderBaseRecord,
  type JjAcceptedRecord,
  type JjBaseRecord,
  type JjProposedChangesRecord,
  pointFromCommit,
  pointId,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import type { CardCommand } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import type { FolderAcceptedRecord } from "./accepted.ts"
import {
  type LatestNow,
  latestNow,
  type ParentNow,
  proposedChangesStatus,
  workStripView,
} from "./index.ts"
import { conflictCause } from "./work-strip.ts"

const LANE = threadIdFor("1")
const TIP = commitId("t1")
const T2 = commitId("t2")

const proposed: JjProposedChangesRecord = {
  kind: "jj",
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  workingCopyEdits: [],
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
    asking = false,
    catching: {
      getLatest?: LatestNow
      untraced?: boolean
      queued?: readonly CardCommand[]
      parent?: ParentNow | null
      parentRunning?: boolean
    } = {},
  ) =>
    workStripView({
      proposed: proposedChangesStatus(o),
      activity,
      asking,
      base: null,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      unfinishedAhead: 0,
      getLatest: catching.getLatest ?? { kind: "current" },
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
    const v = view({ ...proposed, workingCopyEdits: ["b.txt"] })
    expect([v.state, v.buttons, v.facts.touchesWorkingCopyEdits]).toEqual([
      "ready",
      ["accept", "split"],
      true,
    ])
    expect(view(proposed).facts.touchesWorkingCopyEdits).toBe(false)
  })
  test("the facts: proposed changes' bookmark, files and size, until it is accepted", () => {
    expect(view({ ...proposed, size: 2 }).facts).toEqual({
      activity: "idle",
      files: 2,
      size: 2,
      conflicts: 0,
      touchesWorkingCopyEdits: false,
      bookmark: "pinetrie-proposed/t-1",
      nothingToAdd: false,
      acceptedAs: null,
      base: { kind: "accepted" },
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      getLatest: { kind: "current" },
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
    // Nothing to add: its bookmark is a fact in jj, and nothing in it is to accept.
    const nothingToAdd = view({ ...proposed, files: [] })
    expect([
      nothingToAdd.facts.nothingToAdd,
      nothingToAdd.facts.bookmark,
      nothingToAdd.destinations,
    ]).toEqual([true, "pinetrie-proposed/t-1", []])
  })
  test("proposedChangesStatus: one decoding of a record, which every reader shares", () => {
    expect(proposedChangesStatus(undefined)).toEqual({ kind: "none" })
    expect(proposedChangesStatus({ ...proposed, acceptedAs: "zz" })).toEqual({
      kind: "accepted",
      as: "zz",
    })
    expect(proposedChangesStatus({ ...proposed, files: [] }).kind).toBe(
      "nothing-to-add",
    )
    expect(
      proposedChangesStatus({ ...proposed, files: [], edited: true }).kind,
    ).toBe("open")
    expect(proposedChangesStatus(proposed).kind).toBe("open")
  })
  test("behind its base, catching up stands beside the proposed changes; with nothing to accept, alone", () => {
    const behind = {
      getLatest: { kind: "brings", move: MOVE, files: 2 },
    } as const
    expect(at(view(proposed, "idle", false, behind))).toEqual([
      "ready",
      ["accept", "split", "update"],
      ["describe"],
    ])
    expect(at(view(undefined, "idle", false, behind))).toEqual([
      "nothing",
      ["update"],
      [],
    ])
    expect(view(undefined, "idle", false, behind).facts.getLatest).toEqual(
      behind.getLatest,
    )
    // Running, nothing to catch up with is offered at all.
    expect(at(view(proposed, "turn", false, behind))).toEqual([
      "running",
      [],
      [],
    ])
  })
  test("catching up that would change nothing is listed, but quiet; one not yet read is not", () => {
    const quiet = (getLatest: LatestNow) =>
      view(proposed, "idle", false, { getLatest }).quiet
    expect(quiet({ kind: "current" })).toEqual(["update"])
    expect(quiet({ kind: "nothing-new" })).toEqual(["update"])
    expect(quiet({ kind: "unknown" })).toEqual([])
    expect(quiet({ kind: "brings", move: MOVE, files: 1 })).toEqual([])
    // A thread whose WIP is gone continues on accepted work: never quiet.
    const gone = workStripView({
      proposed: proposedChangesStatus(undefined),
      activity: "idle",
      asking: false,
      base: {
        kind: "jj",
        base: { kind: "unfinished", bookmark: "wip/a" },
        state: "gone",
      },
      parent: null,
      parentRunning: false,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      unfinishedAhead: 0,
      getLatest: { kind: "current" },
      untraced: false,
      queued: [],
    })
    expect([gone.menu, gone.quiet]).toEqual([["continue"], []])
  })
  test("an untraced thread's proposed changes you edited can be accepted, never rebuilt", () => {
    const edited = view({ ...proposed, edited: true }, "idle", false, {
      untraced: true,
    })
    expect(at(edited)).toEqual(["edited", ["accept", "update"], []])
  })
  test("an untraced thread offers nothing, and catching up beside it, never quiet", () => {
    const untraced = view(undefined, "idle", false, { untraced: true })
    expect([...at(untraced), untraced.quiet, untraced.facts.untraced]).toEqual([
      "nothing",
      ["update"],
      [],
      [],
      true,
    ])
  })
  test("a card bringing the thread up to date, queued on an idle lane: the proposed changes are busy with it", () => {
    const queued = view(proposed, "idle", false, {
      queued: ["get-latest"],
    })
    expect([queued.state, queued.buttons, queued.facts.activity]).toEqual([
      "busy",
      [],
      "get-latest",
    ])
    expect(
      view(proposed, "turn", false, { queued: ["get-latest"] }).facts.activity,
    ).toBe("turn")
  })
  test("a split queued is not a catch-up: the proposed changes stay ready, its split button quiet", () => {
    const queued = view(proposed, "idle", false, { queued: ["split"] })
    expect([queued.state, queued.facts.activity]).toEqual(["ready", "idle"])
    expect(queued.quiet).toContain("split")
    expect(view(proposed, "idle", false).quiet).not.toContain("split")
  })
  test("latestNow: from the commit a lane last caught up with to the base's now", () => {
    const moved = (...args: Parameters<typeof latestNow>) =>
      latestNow(...args).kind !== "current"
    const L1 = commitId("l1")
    const L2 = commitId("l2")
    const W1 = commitId("w1")
    const line = (
      commit: typeof L1 | null,
      unfinishedWork = [] as { bookmark: string; commit: typeof L1 }[],
    ): JjAcceptedRecord => ({
      kind: "jj",
      acceptedBookmark: "pinetrie-accepted",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit,
      heads: { current: null, proposed: "" },
      log: { current: null, proposed: "" },
      unfinishedWork: unfinishedWork.map(w => ({ ...w, behind: 0, ahead: 1 })),
      workingCopy: {
        behind: 0,
        ahead: 0,
        getLatest: null,
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
      getLatest: null,
      untraced: [],
      work: "some",
    }
    const onUnfinished: JjBaseRecord = {
      kind: "jj",
      lane: LANE,
      base: { kind: "unfinished" as const, bookmark: "wip/a" },
      start: W1,
      state: "ok" as const,
      getLatest: null,
      untraced: [],
      work: "some",
    }
    expect(moved(onAccepted, line(L1))).toBe(false)
    expect(moved(onAccepted, line(L2))).toBe(true)
    expect(moved(onAccepted, line(null))).toBe(false)
    // A lane the host never read (no record): nothing is claimed, unless
    // there is no line to catch up with.
    expect(latestNow(undefined, line(L2))).toEqual({ kind: "unknown" })
    expect(latestNow(undefined, line(null))).toEqual({ kind: "current" })
    expect(
      moved(onUnfinished, line(L2, [{ bookmark: "wip/a", commit: W1 }])),
    ).toBe(false)
    expect(
      moved(
        onUnfinished,
        line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }]),
      ),
    ).toBe(true)
    // Landed: on accepted work now, and caught up with it only once merged.
    expect(moved({ ...onUnfinished, state: "landed" }, line(L2))).toBe(true)
    expect(moved({ ...onUnfinished, state: "gone" }, line(L2))).toBe(false)
    expect(latestNow(onAccepted, line(L2))).toEqual({ kind: "unknown" })
    expect(
      latestNow(
        {
          ...onUnfinished,
          getLatest: { tip: commitId("t"), to: commitId("w2"), files: ["w"] },
        },
        line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }]),
      ),
    ).toMatchObject({ move: { bookmark: "wip/a", from: W1, to: "w2" } })
    // The host's read counts only at the commit the base is at now.
    const read = (to: typeof L1, files: string[]): JjBaseRecord => ({
      ...onAccepted,
      getLatest: { tip: commitId("t"), to, files },
    })
    expect(latestNow(read(L2, []), line(L2))).toEqual({ kind: "nothing-new" })
    // Only what brings files says the move: the header's ↓ names it.
    const move = {
      base: { kind: "accepted" },
      bookmark: "pinetrie-accepted",
      from: L1,
      to: L2,
    }
    expect(latestNow(read(L2, ["a", "b"]), line(L2))).toEqual({
      kind: "brings",
      move,
      files: 2,
    })
    expect(latestNow(read(commitId("l0"), []), line(L2))).toEqual({
      kind: "unknown",
    })
  })
  test("latestNow for a folder: from the state a lane last caught up with to accepted work's newest", () => {
    const FIRST = pointId("line-0192aaaa")
    const SECOND = pointId("line-0192bbbb")
    const folder = (newest: typeof FIRST): FolderAcceptedRecord => ({
      kind: "folder",
      newest,
      kept: [newest],
      at: 1,
    })
    const base = (
      getLatest: FolderBaseRecord["getLatest"] = null,
    ): FolderBaseRecord => ({
      kind: "folder",
      lane: LANE,
      start: FIRST,
      getLatest,
      work: "some",
    })
    const read = (to: typeof FIRST, files: string[]) =>
      base({ tip: pointId("turn-0192cccc"), to, files })
    expect(latestNow(base(), folder(FIRST))).toEqual({ kind: "current" })
    expect(latestNow(base(), folder(SECOND))).toEqual({ kind: "unknown" })
    expect(latestNow(undefined, folder(SECOND))).toEqual({ kind: "unknown" })
    expect(latestNow(read(SECOND, []), folder(SECOND))).toEqual({
      kind: "nothing-new",
    })
    expect(latestNow(read(SECOND, ["a"]), folder(SECOND))).toEqual({
      kind: "brings",
      move: {
        base: { kind: "accepted" },
        bookmark: null,
        from: FIRST,
        to: SECOND,
      },
      files: 1,
    })
    expect(latestNow(read(FIRST, ["a"]), folder(SECOND))).toEqual({
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
      asking: false,
      base: { kind: "folder" },
      parent: null,
      parentRunning: false,
      into: { kind: "folder" },
      unfinishedAhead: 0,
      getLatest: { kind: "current" },
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
      asking: false,
      base: null,
      parent: null,
      parentRunning: false,
      into: null,
      unfinishedAhead: 0,
      getLatest: { kind: "current" },
      untraced: false,
      queued: [],
    })
    expect([v.buttons, v.destinations]).toEqual([["split"], []])
  })
  test("an ask about a conflict needs you while it stands", () => {
    expect(view(proposed, "idle", true).state).toBe("needs-you")
    expect(view(proposed, "idle", false).state).toBe("ready")
    // The next run covers it while it runs.
    expect(view(proposed, "turn", true).state).toBe("running")
  })
  test("needs-you offers the answer and accept, and no merge", () => {
    expect(at(view(proposed, "idle", true))).toEqual([
      "needs-you",
      ["answer", "accept"],
      [],
    ])
    // Even when catching up would bring work.
    expect(
      at(
        view(proposed, "idle", true, {
          getLatest: { kind: "brings", move: MOVE, files: 2 },
        }),
      ),
    ).toEqual(["needs-you", ["answer", "accept"], []])
  })
  test("the resolving button is the one conflicts shows, and only there and in needs-you", () => {
    const conflicted = { ...proposed, conflicts: ["a.txt"] }
    const v = view(conflicted)
    expect([v.buttons[0], v.resolvingButton]).toEqual(["update", "update"])
    expect(view(conflicted, "idle", true).resolvingButton).toBe("update")
    expect(view(proposed).resolvingButton).toBeNull()
    expect(view(conflicted, "turn").resolvingButton).toBeNull()
  })
  test("a gone WIP has no resolving button", () => {
    const gone = workStripView({
      proposed: proposedChangesStatus({ ...proposed, conflicts: ["a.txt"] }),
      activity: "idle",
      asking: false,
      base: {
        kind: "jj",
        base: { kind: "unfinished", bookmark: "wip/a" },
        state: "gone",
      },
      parent: null,
      parentRunning: false,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      unfinishedAhead: 0,
      getLatest: { kind: "current" },
      untraced: false,
      queued: [],
    })
    expect([gone.state, gone.buttons, gone.resolvingButton]).toEqual([
      "conflicts",
      ["continue"],
      null,
    ])
  })
})

describe("a conflict that came with the copy, and the thread it branched from", () => {
  const P = threadIdFor("p")
  const parent = (over: Partial<ParentNow> = {}): ParentNow => ({
    kind: "parent",
    lane: P,
    name: "amber-fox" as ThreadName,
    newest: pointFromCommit(T2),
    upToDateWith: pointFromCommit(TIP),
    conflicts: [],
    ...over,
  })
  const view = (
    o: JjProposedChangesRecord,
    p: ParentNow | null,
    parentRunning = false,
    asking = false,
  ) =>
    workStripView({
      proposed: proposedChangesStatus(o),
      activity: "idle",
      asking,
      base: null,
      into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
      unfinishedAhead: 0,
      getLatest: { kind: "current" },
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
      ["get-latest-from-parent"],
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
  test("needs-you resolves as conflicts would", () => {
    const cases: readonly [JjProposedChangesRecord, ParentNow | null][] = [
      [fromStart, parent()],
      [fromStart, parent({ conflicts: ["a.txt"] })],
      [fromStart, null],
      [{ ...proposed, conflicts: ["a.txt"] }, parent()],
    ]
    expect(
      cases.map(([o, p]) => [
        view(o, p).resolvingButton,
        view(o, p, false, true).resolvingButton,
      ]),
    ).toEqual([
      ["get-latest-from-parent", "get-latest-from-parent"],
      ["update", "update"],
      ["update", "update"],
      ["update", "update"],
    ])
    // The parent's catch-up stays in needs-you's menu while it is ahead.
    const asking = view(fromStart, parent(), false, true)
    expect([asking.state, asking.buttons, asking.menu]).toEqual([
      "needs-you",
      ["answer"],
      ["get-latest-from-parent"],
    ])
  })
  test("while the parent is ahead it is in the menu, quiet while it runs", () => {
    expect(view(proposed, parent()).menu).toEqual([
      "describe",
      "update",
      "get-latest-from-parent",
    ])
    expect(
      view(proposed, parent({ newest: pointFromCommit(TIP) })).menu,
    ).toEqual(["describe", "update"])
    expect(view(proposed, parent(), true).quiet).toContain(
      "get-latest-from-parent",
    )
    expect(view(fromStart, parent(), true).quiet).toEqual([
      "get-latest-from-parent",
    ])
  })
})
