import {
  type ArchiveRecord,
  entryId,
  type LaneName,
  type LaneView,
  laneNameForThread,
  type OfferRecord,
  PENDING_TRACK,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type AppViewInput,
  appView,
  readOnlyWords,
  tabRail,
} from "./app-view.ts"
import type { Column } from "./columns.ts"
import { tree } from "./fixtures.ts"

const ADA = writerId("ada@x.test")
const nameOf = new Map([[ADA, "Ada"]])
const archived = (root: string): ArchiveRecord => ({
  root: entryId(root),
  state: "archived",
  by: ADA,
  at: 1,
})
const columns = (...keys: string[]): Column[] =>
  keys.map(key => ({ key, anchor: entryId("r") }))
const input = (over: Partial<AppViewInput>): AppViewInput => ({
  active: { kind: "root", root: entryId("r") },
  columns: columns("a"),
  tracks: [3],
  archive: new Map(),
  nameOf,
  offers: new Map(),
  lanes: [],
  laneRoots: new Map(),
  ...over,
})
const workspace = (over: Partial<AppViewInput>) =>
  appView(input(over)).workspace

describe("appView's workspace", () => {
  test("before a tab is chosen, the page is connecting; Archive is its own", () => {
    expect(workspace({ active: null }).kind).toBe("connecting")
    expect(workspace({ active: { kind: "archive" } }).kind).toBe("archive")
  })

  test("a new tab has its own kind, and its one column closes the tab", () => {
    expect(workspace({ active: { kind: "new", key: "t" } })).toEqual({
      kind: "new",
      key: "t",
      slots: [{ key: "a", position: 0, closable: true, track: 3 }],
    })
  })

  test("a root tab's only column offers no close; with two, both do", () => {
    const one = workspace({})
    const two = workspace({ columns: columns("a", "b"), tracks: [3] })
    expect(one.kind === "root" && one.slots.map(s => s.closable)).toEqual([
      false,
    ])
    expect(two.kind === "root" && two.slots).toEqual([
      { key: "a", position: 0, closable: true, track: 3 },
      { key: "b", position: 1, closable: true, track: PENDING_TRACK },
    ])
  })

  test("an archived root is read-only, with Restore; a restored one is not", () => {
    const here = workspace({
      archive: new Map([[entryId("r"), archived("r")]]),
    })
    expect(here.kind === "root" && here.readOnly).toEqual({
      label: "archived by Ada",
      action: { title: "Restore", intent: { kind: "restore", root: "r" } },
    })
    const back = workspace({
      archive: new Map([
        [entryId("r"), { ...archived("r"), state: "restored" }],
      ]),
    })
    expect(back.kind === "root" && back.readOnly).toBe(null)
  })
})

test("readOnlyWords offers Restore for an archived root, Open for any other", () => {
  expect(readOnlyWords(entryId("r"), undefined, nameOf)).toEqual({
    label: "open",
    action: {
      title: "Open",
      intent: { kind: "show", tab: { kind: "root", root: "r" } },
    },
  })
  expect(readOnlyWords(entryId("r"), archived("r"), nameOf).action.title).toBe(
    "Restore",
  )
})

test("the header's offers are the open ones, never one the line already holds: a held lane's at its tip, if it has one; another's at its root (ADR-0063)", () => {
  const A = laneNameForThread("a")
  const B = laneNameForThread("b")
  const C = laneNameForThread("c")
  const D = laneNameForThread("d")
  const E = laneNameForThread("e")
  const offer = (lane: LaneName, taken: string | null, files = ["a.txt"]) =>
    ({ lane, taken, files, edited: false }) as unknown as OfferRecord
  const lane = (name: LaneName, tip: string | null) =>
    ({ name, tip }) as unknown as LaneView
  const { offers } = appView(
    input({
      offers: new Map([
        [A, offer(A, null)],
        [B, offer(B, "taken")],
        [C, offer(C, null)],
        [D, offer(D, null)],
        [E, offer(E, null, [])],
      ]),
      lanes: [lane(A, "t1"), lane(B, "t2"), lane(C, null)],
      laneRoots: new Map([
        [A, entryId("r1")],
        [B, entryId("r1")],
        [C, entryId("r1")],
        [D, entryId("r2")],
        [E, entryId("r2")],
      ]),
    }),
  )
  expect(offers).toEqual([
    { lane: A, root: "r1", end: "t1" },
    { lane: D, root: "r2", end: "r2" },
  ])
})

test("a tab's rail draws its own root's tree only", () => {
  const index = tree({ r1: null, a: "r1", r2: null, b: "r2" })
  const ids = (rows: readonly { readonly id: string }[]) => rows.map(r => r.id)
  expect(ids(tabRail(index, { kind: "root", root: entryId("r1") }))).toEqual([
    "r1",
    "a",
  ])
  expect(tabRail(index, { kind: "new", key: "t" })).toEqual([])
  expect(tabRail(index, null)).toEqual([])
})
