import {
  type BaseRecord,
  commitId,
  entryId,
  type LandingRecord,
  laneNameForThread,
  type OfferRecord,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type CatchUpNow,
  catchUpOf,
  offerSeen,
  offerStatus,
  offerView,
  type ParentNow,
} from "./index.ts"
import { conflictCause } from "./offer-view.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada@x.io")
const TIP = commitId("t1")
const T2 = commitId("t2")
const BASE = commitId("b0")
const _COPY = commitId("k1")

const offer: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pineta-offer/t-1",
  taken: null,
  commits: [commitId("w1")],
  ledger: null,
  at: 10,
}

test("offerSeen: what a take was shown is the record's ledger and whether it conflicted; no record shows none", () => {
  const ledger = { source: TIP, start: [BASE] }
  expect(offerSeen({ ...offer, ledger, conflicts: ["a.txt"] })).toEqual({
    ledger,
    conflicted: true,
  })
  expect(offerSeen(offer)).toEqual({ ledger: null, conflicted: false })
  expect(offerSeen(undefined)).toEqual({ ledger: null, conflicted: false })
})

describe("offerView: ADR-0038's table", () => {
  const MOVE = {
    base: { kind: "line" },
    bookmark: "pineta-onto",
    from: commitId("l1"),
    to: commitId("l2"),
  } as const
  const view = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" | "split" = "idle",
    landing?: LandingRecord,
    catching: {
      catchUp?: CatchUpNow
      untraced?: boolean
      catchingUp?: boolean
      parent?: ParentNow | null
      parentRunning?: boolean
    } = {},
  ) =>
    offerView({
      offer: offerStatus(o),
      activity,
      landing,
      base: null,
      onto: "pineta-onto",
      wipAhead: 0,
      catchUp: catching.catchUp ?? { kind: "current" },
      untraced: catching.untraced ?? false,
      catchingUp: catching.catchingUp ?? false,
      parent: catching.parent ?? null,
      parentRunning: catching.parentRunning ?? false,
    })
  const at = (v: ReturnType<typeof view>) => [v.state, v.buttons, v.menu]
  test("every state, with its buttons", () => {
    expect(at(view(undefined))).toEqual(["nothing", [], ["update"]])
    expect(at(view({ ...offer, files: [] }))).toEqual([
      "nothing",
      [],
      ["update"],
    ])
    expect(at(view(offer, "turn"))).toEqual(["running", [], []])
    expect(at(view(offer, "resolution"))).toEqual(["busy", [], []])
    expect(at(view(offer, "split"))).toEqual(["busy", [], []])
    expect(at(view(offer))).toEqual([
      "ready",
      ["take", "split"],
      ["describe", "update"],
    ])
    // Only a clean offer lands on the line (ADR-0060): no take on a line thread.
    expect(at(view({ ...offer, conflicts: ["a.txt"] }))).toEqual([
      "conflicts",
      ["update"],
      [],
    ])
    expect(at(view({ ...offer, size: 2 }))).toEqual([
      "stack",
      ["take", "squash"],
      ["update"],
    ])
    expect(at(view({ ...offer, size: 2, stale: true }))).toEqual([
      "stale",
      ["split", "take"],
      ["update"],
    ])
    expect(at(view({ ...offer, edited: true }))).toEqual([
      "edited",
      ["take", "refresh"],
      ["update"],
    ])
    expect(at(view({ ...offer, taken: "zz12345678" }))).toEqual([
      "taken",
      [],
      ["update"],
    ])
  })
  test("files you are editing are a fact; the state and buttons stay", () => {
    const v = view({ ...offer, yourEdits: ["b.txt"] })
    expect([v.state, v.buttons, v.facts.touchesYourEdits]).toEqual([
      "ready",
      ["take", "split"],
      true,
    ])
    expect(view(offer).facts.touchesYourEdits).toBe(false)
  })
  test("the facts: an untaken offer's bookmark, files and size", () => {
    expect(view({ ...offer, size: 2 }).facts).toEqual({
      activity: "idle",
      files: 2,
      size: 2,
      conflicts: 0,
      touchesYourEdits: false,
      bookmark: "pineta-offer/t-1",
      held: false,
      taken: null,
      base: { kind: "line" },
      onto: "pineta-onto",
      catchUp: { kind: "current" },
      untraced: false,
      conflictCause: "work",
      parent: null,
      parentResolves: false,
    })
    expect(view(offer, "turn").facts.files).toBe(2)
    const none = view(undefined).facts
    expect([none.files, none.bookmark, none.taken]).toEqual([0, null, null])
    const taken = view({ ...offer, taken: "zz12345678" }).facts
    expect([taken.files, taken.bookmark, taken.taken]).toEqual([
      0,
      null,
      "zz12345678",
    ])
    // Held: its bookmark is a fact in jj, and nothing in it is to take.
    const held = view({ ...offer, files: [] })
    expect([held.facts.held, held.facts.bookmark, held.destinations]).toEqual([
      true,
      "pineta-offer/t-1",
      [],
    ])
  })
  test("offerStatus: one decoding of a record, which every reader shares (ADR-0067)", () => {
    expect(offerStatus(undefined)).toEqual({ kind: "none" })
    expect(offerStatus({ ...offer, taken: "zz" })).toEqual({
      kind: "taken",
      as: "zz",
    })
    expect(offerStatus({ ...offer, files: [] }).kind).toBe("held")
    expect(offerStatus({ ...offer, files: [], edited: true }).kind).toBe("open")
    expect(offerStatus(offer).kind).toBe("open")
  })
  test("behind its base, catching up stands beside the offer; with nothing to take, alone", () => {
    const behind = {
      catchUp: { kind: "brings", move: MOVE, files: 2 },
    } as const
    expect(at(view(offer, "idle", undefined, behind))).toEqual([
      "ready",
      ["take", "split", "update"],
      ["describe"],
    ])
    expect(at(view(undefined, "idle", undefined, behind))).toEqual([
      "nothing",
      ["update"],
      [],
    ])
    expect(view(undefined, "idle", undefined, behind).facts.catchUp).toEqual(
      behind.catchUp,
    )
    // Running, nothing to catch up with is offered at all.
    expect(at(view(offer, "turn", undefined, behind))).toEqual([
      "running",
      [],
      [],
    ])
  })
  test("catching up that would change nothing is listed, but quiet; one not yet read is not (S97)", () => {
    const quiet = (catchUp: CatchUpNow) =>
      view(offer, "idle", undefined, { catchUp }).quiet
    expect(quiet({ kind: "current" })).toEqual(["update"])
    expect(quiet({ kind: "nothing-new", move: MOVE })).toEqual(["update"])
    expect(quiet({ kind: "unknown", move: MOVE })).toEqual([])
    expect(quiet({ kind: "brings", move: MOVE, files: 1 })).toEqual([])
    // A thread whose WIP is gone continues on the line: never quiet.
    const gone = offerView({
      offer: offerStatus(undefined),
      activity: "idle",
      landing: undefined,
      base: { base: { kind: "wip", bookmark: "wip/a" }, state: "gone" },
      parent: null,
      parentRunning: false,
      onto: "pineta-onto",
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      catchingUp: false,
    })
    expect([gone.menu, gone.quiet]).toEqual([["continue"], []])
  })
  test("an untraced thread's offer you edited can be taken, never rebuilt (S97)", () => {
    const edited = view({ ...offer, edited: true }, "idle", undefined, {
      untraced: true,
    })
    expect(at(edited)).toEqual(["edited", ["take", "update"], []])
  })
  test("an untraced thread offers nothing, and catching up beside it, never quiet (S97)", () => {
    const untraced = view(undefined, "idle", undefined, { untraced: true })
    expect([...at(untraced), untraced.quiet, untraced.facts.untraced]).toEqual([
      "nothing",
      ["update"],
      [],
      [],
      true,
    ])
  })
  test("a card bringing the thread up to date, queued on an idle lane: the offer is busy with it", () => {
    const queued = view(offer, "idle", undefined, { catchingUp: true })
    expect([queued.state, queued.buttons, queued.facts.activity]).toEqual([
      "busy",
      [],
      "catch-up",
    ])
    expect(
      view(offer, "turn", undefined, { catchingUp: true }).facts.activity,
    ).toBe("turn")
  })
  test("catchUpOf: moved from the commit a lane last took from its base to the base's now, and what the host read of it there (S97)", () => {
    const moved = (...args: Parameters<typeof catchUpOf>) =>
      catchUpOf(...args).kind !== "current"
    const L1 = commitId("l1")
    const L2 = commitId("l2")
    const W1 = commitId("w1")
    const line = (
      commit: typeof L1 | null,
      wips = [] as { bookmark: string; commit: typeof L1 }[],
    ) => ({
      onto: "pineta-onto",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit,
      heads: { current: null, proposed: "" },
      log: { current: null, proposed: "" },
      wips: wips.map(w => ({ ...w, behind: 0, ahead: 1 })),
      yours: {
        behind: 0,
        ahead: null,
        follow: null,
        conflicts: { commits: 0, files: [] },
      },
      commands: true,
    })
    const onLine: BaseRecord = {
      lane: LANE,
      base: { kind: "line" as const },
      start: L1,
      state: "ok" as const,
      catchUp: null,
      untraced: [],
    }
    const onWip: BaseRecord = {
      lane: LANE,
      base: { kind: "wip" as const, bookmark: "wip/a" },
      start: W1,
      state: "ok" as const,
      catchUp: null,
      untraced: [],
    }
    expect(moved(onLine, line(L1))).toBe(false)
    expect(moved(onLine, line(L2))).toBe(true)
    expect(moved(onLine, line(null))).toBe(false)
    expect(moved(undefined, line(L2))).toBe(false)
    expect(moved(onWip, line(L2, [{ bookmark: "wip/a", commit: W1 }]))).toBe(
      false,
    )
    expect(
      moved(onWip, line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }])),
    ).toBe(true)
    // Landed: on the line now, and caught up with it only once merged.
    expect(moved({ ...onWip, state: "landed" }, line(L2))).toBe(true)
    expect(moved({ ...onWip, state: "gone" }, line(L2))).toBe(false)
    const move = {
      base: { kind: "line" },
      bookmark: "pineta-onto",
      from: L1,
      to: L2,
    }
    expect(catchUpOf(onLine, line(L2))).toEqual({ kind: "unknown", move })
    expect(
      catchUpOf(
        onWip,
        line(L2, [{ bookmark: "wip/a", commit: commitId("w2") }]),
      ),
    ).toMatchObject({ move: { bookmark: "wip/a", from: W1, to: "w2" } })
    // The host's read counts only at the commit the base is at now.
    const read = (to: typeof L1, files: string[]): BaseRecord => ({
      ...onLine,
      catchUp: { tip: commitId("t"), to, files },
    })
    expect(catchUpOf(read(L2, []), line(L2))).toEqual({
      kind: "nothing-new",
      move,
    })
    expect(catchUpOf(read(L2, ["a", "b"]), line(L2))).toEqual({
      kind: "brings",
      move,
      files: 2,
    })
    expect(catchUpOf(read(commitId("l0"), []), line(L2))).toEqual({
      kind: "unknown",
      move,
    })
  })
  test("a resolution that asked you counts only when newer than the offer", () => {
    const asked: LandingRecord = {
      id: "l",
      lane: LANE,
      prompt: entryId("e"),
      state: "needs_you",
      by: ADA,
      at: 20,
    }
    expect(view(offer, "idle", asked).state).toBe("needs_you")
    expect(view(offer, "idle", { ...asked, at: 5 }).state).toBe("ready")
  })
})

describe("a conflict that came with the copy, and the thread it branched from (ADR-0072)", () => {
  const P = laneNameForThread("p")
  const parent = (over: Partial<ParentNow> = {}): ParentNow => ({
    kind: "parent",
    lane: P,
    name: "amber-fox" as ThreadName,
    newest: T2,
    taken: TIP,
    conflicts: [],
    ...over,
  })
  const view = (o: OfferRecord, p: ParentNow | null, parentRunning = false) =>
    offerView({
      offer: offerStatus(o),
      activity: "idle",
      landing: undefined,
      base: null,
      onto: "pineta-onto",
      wipAhead: 0,
      catchUp: { kind: "current" },
      untraced: false,
      catchingUp: false,
      parent: p,
      parentRunning,
    })
  const fromStart = {
    ...offer,
    conflicts: ["a.txt"],
    startConflicts: ["a.txt"],
  }
  test("conflictCause: the start only when every conflicted file was conflicted there", () => {
    expect(conflictCause(offer)).toBe("work")
    expect(conflictCause(fromStart)).toBe("start")
    expect(
      conflictCause({
        ...offer,
        conflicts: ["a.txt", "b.txt"],
        startConflicts: ["a.txt"],
      }),
    ).toBe("work")
    expect(
      conflictCause({ ...offer, conflicts: [], startConflicts: ["a.txt"] }),
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
    expect(view(fromStart, parent({ newest: TIP })).buttons).toEqual(["update"])
    expect(view(fromStart, null).buttons).toEqual(["update"])
    expect(view({ ...offer, conflicts: ["a.txt"] }, parent()).buttons).toEqual([
      "update",
    ])
  })
  test("while the parent is ahead it is in the menu, quiet while it runs", () => {
    expect(view(offer, parent()).menu).toEqual([
      "describe",
      "update",
      "catch-up-parent",
    ])
    expect(view(offer, parent({ newest: TIP })).menu).toEqual([
      "describe",
      "update",
    ])
    expect(view(offer, parent(), true).quiet).toContain("catch-up-parent")
    expect(view(fromStart, parent(), true).quiet).toEqual(["catch-up-parent"])
  })
})
