import {
  type AgentMessageLike,
  BANNER_FOCUSES,
  type BannerFocus,
  commitId,
  type EntryLike,
  entryId,
  indexTree,
  type LaneName,
  type LaneRecord,
  type LaneView,
  laneNameForThread,
  type OfferRecord,
  type ProjectRecord,
  projectColumns,
  type RevisionRecord,
  type Sha256,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { offerView } from "@pineta/marginalia"
import { describe, expect, test } from "vitest"
import {
  type ColumnFacts,
  columnView,
  joinWords,
  lanesAlong,
  offerWords,
  type WorkFacts,
} from "./column-view.ts"

const A = laneNameForThread("a")
const B = laneNameForThread("b")
const C = laneNameForThread("c")
const AMBER = "amber-fox" as ThreadName
const COPPER = "copper-owl" as ThreadName
const ADA = writerId("ada@x.io")

type Line = readonly [
  id: string,
  parent: string | null,
  message: AgentMessageLike,
]
const chat = (text: string, compelled = false): AgentMessageLike => ({
  role: "chat",
  content: text,
  author: "Ada",
  writer: ADA,
  ...(compelled ? { compelled: true } : {}),
})
const reply = (text: string): AgentMessageLike => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const tree = (lines: readonly Line[]): TreeIndex =>
  indexTree(
    Object.fromEntries(
      lines.map(([id, parentId, message]): [string, EntryLike] => [
        id,
        { id, parentId, type: "message", message },
      ]),
    ),
  )
const revisions = (
  owners: Record<string, LaneName>,
): ReadonlyMap<string, RevisionRecord> =>
  new Map(
    Object.entries(owners).map(([id, lane]) => [
      id,
      { entry: entryId(id), lane, commit: null, snapshot: null },
    ]),
  )
const stretches = (
  index: TreeIndex,
  tip: string,
  owners: Record<string, LaneName>,
  lane: LaneName | null = null,
) =>
  lanesAlong(index, tip, revisions(owners), lane).map(s => [
    s.start as string,
    s.lane,
  ])

// A conversation that asks the agent at its third message (lane A), and a
// branch off the agent's reply whose first message starts lane B.
const TRUNK: readonly Line[] = [
  ["1", null, chat("hello")],
  ["2", "1", chat("hi")],
  ["3", "2", chat("@agent look", true)],
  ["4", "3", reply("It says MANGO.")],
  ["5", "4", chat("thanks, and?", true)],
  ["6", "5", reply("Nothing else.")],
]
const BRANCH: readonly Line[] = [
  ...TRUNK,
  ["b1", "4", chat("@agent try another", true)],
  ["b2", "b1", reply("Another.")],
]

describe("lanesAlong", () => {
  const index = tree(BRANCH)
  test.each([
    [
      "a conversation that asks the agent: one stretch",
      "6",
      { "3": A },
      null,
      [["3", A]],
    ],
    [
      "a later prompt of the same lane: no new stretch",
      "6",
      { "3": A, "5": A },
      null,
      [["3", A]],
    ],
    [
      "a branch that starts a lane under another: two",
      "b2",
      { "3": A, b1: B },
      null,
      [
        ["3", A],
        ["b1", B],
      ],
    ],
    [
      "an asked message with no record: the column's lane",
      "b2",
      { "3": A },
      B,
      [
        ["3", A],
        ["b1", B],
      ],
    ],
    ["no record and no lane: nothing", "6", {}, null, []],
  ] as const)("%s", (_, tip, owners, lane, expected) => {
    expect(stretches(index, tip, owners, lane)).toEqual(expected)
  })
  test("no asked message: no stretch", () => {
    expect(stretches(tree(TRUNK.slice(0, 2)), "2", {}, A)).toEqual([])
  })
})

const PROJECT: ProjectRecord = { kind: "lanes", root: "/p", rootDefault: "own" }
const work = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  project: PROJECT,
  commands: [],
  lanes: new Map(),
  revisions: new Map(),
  landings: [],
  offers: new Map(),
  names: new Map(),
  banners: new Map(),
  ...over,
})
const laneView = (name: LaneName, tip: string, running = false): LaneView => ({
  name,
  tip,
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
})
const onLane = (view: LaneView): ThreadLane => ({ kind: "lane", ...view })
const record = (lane: LaneName, work: LaneRecord["work"]): LaneRecord => ({
  lane,
  work,
  by: ADA,
  createdAt: 1,
})

/**
 * The facts for column `n` of the trunk and the branch beside it: the trunk
 * (to 6) then the branch (to b2), as the strip shows them.
 */
const facts = (
  n: 0 | 1,
  over: Partial<ColumnFacts> & { work?: WorkFacts } = {},
): ColumnFacts => {
  const index = tree(BRANCH)
  const views = projectColumns(index, [
    { anchor: "6", pinned: true },
    { anchor: "b2", pinned: true },
  ])
  const view = views[n]
  if (view === undefined) throw new Error("no view")
  return {
    index,
    view,
    lane: { kind: "none" },
    createsLane: false,
    writable: true,
    nameOf: new Map([[ADA, "Ada"]]),
    lanes: [],
    work: work(),
    ...over,
  }
}
const OWNERS = revisions({ "3": A, "5": A, b1: B })
const NAMES = new Map([
  [A, AMBER],
  [B, COPPER],
])

describe("columnView: the header", () => {
  test("who works here: a named lane, a lane not yet named, a lane about to start, nobody", () => {
    const named = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ revisions: OWNERS, names: NAMES }),
      }),
    )
    expect(named.identity).toEqual({
      kind: "agent",
      name: COPPER,
      start: entryId("b1"),
    })
    const unnamed = columnView(facts(1, { lane: onLane(laneView(B, "b2")) }))
    expect(unnamed.identity).toEqual({ kind: "pending" })
    expect(columnView(facts(1, { createsLane: true })).identity).toEqual({
      kind: "pending",
    })
    expect(columnView(facts(1)).identity).toEqual({ kind: "none" })
  })
  test("the banner is the thread's at the column's end; a conversation has none", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([
      [B, { lane: B, sha, focus: "top" as const, at: 1 }],
    ])
    expect(
      columnView(
        facts(1, { lane: onLane(laneView(B, "b2")), work: work({ banners }) }),
      ).banner,
    ).toEqual({ url: `/blob/${sha}`, position: "center 0%" })
    expect(
      columnView(
        facts(1, { lane: onLane(laneView(A, "b2")), work: work({ banners }) }),
      ).banner,
    ).toBeNull()
    expect(columnView(facts(1, { work: work({ banners }) })).banner).toBeNull()
  })
  test("a banner's focus is how far down its image the header shows", () => {
    const sha = "a".repeat(64) as Sha256
    const at = (focus: BannerFocus) =>
      columnView(
        facts(1, {
          lane: onLane(laneView(B, "b2")),
          work: work({
            banners: new Map([[B, { lane: B, sha, focus, at: 1 }]]),
          }),
        }),
      ).banner?.position
    expect(BANNER_FOCUSES.map(at)).toEqual([
      "center 0%",
      "center 25%",
      "center 50%",
      "center 100%",
    ])
  })
  test("a lane that started above the column's first message still has a start", () => {
    // Column 1 shows only the branch; lane A started at 3, in column 0.
    const index = tree([...BRANCH, ["b3", "b2", chat("more", true)]])
    const view = projectColumns(index, [
      { anchor: "6", pinned: true },
      { anchor: "b3", pinned: true },
    ])[1]
    if (view === undefined) throw new Error("no view")
    const shows = columnView({
      ...facts(1),
      index,
      view,
      lane: onLane(laneView(A, "b3")),
      work: work({ revisions: revisions({ "3": A }), names: NAMES }),
    })
    expect(shows.identity).toEqual({
      kind: "agent",
      name: AMBER,
      start: entryId("3"),
    })
  })
  test("the origin: a chat by its speaker, an agent reply by its lane, else 'agent'", () => {
    const byLane = columnView(
      facts(1, { work: work({ revisions: OWNERS, names: NAMES }) }),
    )
    expect(byLane.origin).toEqual({
      kind: "fork",
      at: entryId("4"),
      speaker: "amber-fox",
      text: "It says MANGO.",
    })
    expect(columnView(facts(1)).origin).toMatchObject({ speaker: "agent" })
    expect(columnView(facts(0)).origin).toEqual({ kind: "none" })
    const index = tree(TRUNK)
    const [, fromChat] = projectColumns(index, [
      { anchor: "6", pinned: true },
      { anchor: "2", pinned: true },
    ])
    if (fromChat === undefined) throw new Error("no view")
    expect(
      columnView({ ...facts(0), index, view: fromChat }).origin,
    ).toMatchObject({ speaker: "Ada", text: "hi" })
  })
})

describe("columnView: where lanes start", () => {
  test("only stretches that start in the column, each naming the lane above", () => {
    const trunk = columnView(
      facts(0, { work: work({ revisions: OWNERS, names: NAMES }) }),
    )
    expect([...trunk.joins]).toEqual([["3", { name: AMBER, from: null }]])
    const branch = columnView(
      facts(1, { work: work({ revisions: OWNERS, names: NAMES }) }),
    )
    expect([...branch.joins]).toEqual([
      ["b1", { name: COPPER, from: { name: AMBER } }],
    ])
  })
  test("its words", () => {
    expect(joinWords({ name: AMBER, from: null })).toBe("✦ amber-fox joined")
    expect(joinWords({ name: COPPER, from: { name: AMBER } })).toBe(
      "✦ copper-owl, from amber-fox",
    )
    expect(joinWords({ name: undefined, from: null })).toBe("✦ agent joined")
  })
})

describe("columnView: the work strip", () => {
  const own = (over: Partial<ColumnFacts> = {}) =>
    facts(1, {
      lane: onLane(laneView(B, "b2")),
      work: work({ lanes: new Map([[B, record(B, { kind: "own" })]]) }),
      ...over,
    })
  test("none without a lane, without a project, or read-only", () => {
    expect(columnView(facts(1)).strip).toEqual({ kind: "none" })
    expect(columnView(own({ writable: false })).strip).toEqual({ kind: "none" })
    expect(
      columnView(
        own({
          work: work({
            project: null,
            lanes: new Map([[B, record(B, { kind: "own" })]]),
          }),
        }),
      ).strip,
    ).toEqual({ kind: "none" })
  })
  test("own copy: the offer, in words", () => {
    expect(columnView(own()).strip).toMatchObject({
      kind: "offer",
      state: "nothing",
      bookmark: null,
    })
  })
  test("an open offer with files can be reviewed, in every state; a taken or empty one cannot", () => {
    const open: OfferRecord = {
      lane: B,
      size: 1,
      stale: false,
      files: ["a.txt"],
      conflicts: [],
      yourEdits: ["a.txt"],
      described: true,
      edited: false,
      bookmark: "pineta-offer/copper-owl",
      taken: null,
      commits: [commitId("c1")],
      at: 1,
      host: {
        changes: ["c"],
        wrote: [commitId("w")],
        tip: commitId("t"),
        start: [commitId("s")],
      },
    }
    const strip = (offer: OfferRecord, running = false) =>
      columnView(
        own({
          lane: onLane(laneView(B, "b2", running)),
          work: work({
            lanes: new Map([[B, record(B, { kind: "own" })]]),
            offers: new Map([[B, offer]]),
          }),
        }),
      ).strip
    const target = {
      lane: B,
      commits: [commitId("c1")],
      conflicts: [],
      yourEdits: ["a.txt"],
    }
    expect(strip(open)).toMatchObject({ state: "ready", review: target })
    expect(strip(open, true)).toMatchObject({
      state: "running",
      review: target,
    })
    expect(strip({ ...open, conflicts: ["a.txt"] })).toMatchObject({
      state: "conflicts",
      review: { ...target, conflicts: ["a.txt"] },
    })
    expect(strip({ ...open, taken: "t1" })).toMatchObject({ review: null })
    expect(strip({ ...open, files: [] })).toMatchObject({ review: null })
    expect(columnView(own()).strip).toMatchObject({
      state: "nothing",
      review: null,
    })
  })
  test("direct: where changes land, and other running lanes in the same directory", () => {
    const direct = (dir: string) => record(C, { kind: "direct", dir })
    const lanes = new Map([
      [A, record(A, { kind: "direct", dir: "/p" })],
      [B, record(B, { kind: "direct", dir: "/p" })],
      [C, direct("/elsewhere")],
    ])
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2", true)),
        lanes: [
          laneView(A, "6", true),
          laneView(B, "b2", true),
          laneView(C, "x", true),
        ],
        work: work({
          lanes,
          names: new Map([...NAMES, [C, "tan-elk" as ThreadName]]),
        }),
      }),
    )
    expect(shows.strip).toEqual({
      kind: "direct",
      line: "changes land directly in your working copy",
      alsoHere: [AMBER],
    })
    const idle = columnView(
      facts(1, {
        lane: onLane(laneView(C, "b2")),
        lanes: [laneView(A, "6"), laneView(C, "b2")],
        work: work({ lanes, names: NAMES }),
      }),
    )
    expect(idle.strip).toEqual({
      kind: "direct",
      line: "changes land directly in /elsewhere",
      alsoHere: [],
    })
    const quiet = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        lanes: [laneView(A, "6"), laneView(B, "b2")],
        work: work({ lanes, names: NAMES }),
      }),
    )
    expect(quiet.strip).toMatchObject({ alsoHere: [] })
  })
})

describe("offerWords", () => {
  const offer: OfferRecord = {
    lane: A,
    size: 1,
    stale: false,
    files: ["a.txt", "b.txt"],
    conflicts: [],
    yourEdits: [],
    described: true,
    edited: false,
    bookmark: "pineta-offer/amber-fox",
    taken: null,
    commits: [commitId("w")],
    at: 10,
    host: {
      changes: ["c"],
      wrote: [commitId("w")],
      tip: commitId("t"),
      start: [commitId("s")],
    },
  }
  const words = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" = "idle",
  ) => offerWords(offerView({ offer: o, activity, landing: undefined }))
  test.each([
    ["nothing", undefined, "idle", "nothing to take yet"],
    ["running, nothing yet", undefined, "turn", "no files changed yet"],
    ["running", offer, "turn", "2 files so far"],
    ["resolving", offer, "resolution", "resolving your work into this thread"],
    ["ready", offer, "idle", "2 files ready"],
    [
      "ready, touching your edits",
      { ...offer, yourEdits: ["a.txt"] },
      "idle",
      "2 files ready · touches files you're editing",
    ],
    ["a stack", { ...offer, size: 3 }, "idle", "a stack of 3 · 2 files ready"],
    [
      "a stale stack",
      { ...offer, size: 3, stale: true },
      "idle",
      "a stack of 3, and changes since",
    ],
    [
      "conflicts",
      { ...offer, conflicts: ["a.txt"] },
      "idle",
      "conflicts with your edits in 1 file",
    ],
    ["edited", { ...offer, edited: true }, "idle", "you edited this offer"],
    ["taken", { ...offer, taken: "zz12345678ab" }, "idle", "taken as zz123456"],
  ] as const)("%s", (_, o, activity, line) => {
    const w = words(o, activity)
    expect(w.line).toBe(line)
    expect(w.line).not.toMatch(/`|pineta-offer/)
  })
  test("the labels follow the state", () => {
    const labels = (o: OfferRecord) => words(o).buttons.map(b => b.label)
    expect(labels(offer)).toEqual(["take", "split into a stack"])
    expect(labels({ ...offer, size: 3 })).toEqual([
      "take stack",
      "squash to one",
    ])
    expect(labels({ ...offer, size: 3, stale: true })).toEqual([
      "split again",
      "take stack and the rest",
    ])
    expect(labels({ ...offer, conflicts: ["a.txt"] })).toEqual([
      "resolve in the thread",
      "take anyway",
    ])
    expect(words(offer).menu.map(b => b.label)).toEqual([
      "rewrite description",
      "update from my work",
    ])
  })
})
