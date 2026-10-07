import {
  type AcceptedRecord,
  type AgentMessageLike,
  atEntry,
  type BaseRecord,
  type CardCommand,
  cardId,
  commitId,
  type EntryId,
  entryId,
  indexAsks,
  type LaneName,
  type LaneRecord,
  type LaneView,
  laneNameForThread,
  type OfferRecord,
  type PinnedView,
  PLAIN,
  type ProjectRecord,
  type RevisionRecord,
  type Sha256,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  writerId,
} from "@pinetrie/core"
import {
  type CatchUpNow,
  offerStatus,
  offerView,
  type ParentNow,
} from "@pinetrie/rules"
import type { OfferActing } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { projectColumns } from "./column-paths.ts"
import {
  behindMark,
  type ColumnFacts,
  columnView,
  identityWords,
  joinWords,
  lanesAlong,
  newPinAt,
  offerWords,
  pinnedMarker,
  pinnedMarkers,
  pinnedStatus,
  queueControlWords,
  runWords,
  startedWords,
  tokensOf,
  type WorkFacts,
  workingWords,
} from "./column-view.ts"
import { entry, indexOf, TEST_ROOT } from "./fixtures.ts"
import { whereWords } from "./send.ts"

const A = laneNameForThread("a")
const B = laneNameForThread("b")
const C = laneNameForThread("c")
const AMBER = "amber-fox" as ThreadName
const COPPER = "copper-owl" as ThreadName
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")

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
  indexOf(lines.map(([id, parentId, message]) => entry(id, parentId, message)))
const revisions = (
  owners: Record<string, LaneName>,
): ReadonlyMap<EntryId, RevisionRecord> =>
  new Map(
    Object.entries(owners).map(([id, lane]) => [
      entryId(id),
      {
        entry: entryId(id),
        lane,
        commit: null,
        snapshot: null,
        paths: [],
        conflicts: [],
      },
    ]),
  )
const stretches = (
  index: TreeIndex,
  tip: string,
  owners: Record<string, LaneName>,
  lane: LaneName | null = null,
) =>
  lanesAlong(index, entryId(tip), revisions(owners), lane).map(s => [
    s.start,
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
  offers: new Map(),
  names: new Map(),
  banners: new Map(),
  accepted: null,
  bases: new Map(),
  ...over,
})
/** Accepted work, one commit past the lane's base: `base` read what catching up brings. */
const ACCEPTED = {
  acceptedBookmark: "pinetrie-onto",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: null, behind: 0, ahead: 0 },
  commit: commitId("bbbbbbbbbbbb"),
  heads: { current: null, proposed: "" },
  log: { current: null, proposed: "" },
  wips: [],
  yours: {
    behind: 0,
    ahead: 0,
    catchUp: null,
    conflicts: { commits: 0, files: [] },
  },
  catchUp: true,
} satisfies AcceptedRecord
const BASE: BaseRecord = {
  lane: laneNameForThread("1"),
  base: { kind: "accepted" as const },
  start: commitId("aaaaaaaaaaaa"),
  state: "ok" as const,
  catchUp: {
    tip: commitId("t"),
    to: commitId("bbbbbbbbbbbb"),
    files: ["a.txt", "b.txt"],
  },
  untraced: [],
  work: "some",
}
const laneView = (name: LaneName, tip: string, running = false): LaneView => ({
  name,
  tip: entryId(tip),
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})
const onLane = (view: LaneView): ThreadLane => ({ kind: "lane", ...view })
const record = (lane: LaneName, work: LaneRecord["work"]): LaneRecord => ({
  lane,
  root: TEST_ROOT,
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
    { anchor: entryId("6"), anchored: true },
    { anchor: entryId("b2"), anchored: true },
  ])
  const view = views[n]
  if (view === undefined) throw new Error("no view")
  return {
    index,
    asks: indexAsks(over.index ?? index),
    view,
    lane: { kind: "none" },
    createsLane: false,
    detailsOpen: false,
    reserved: null,
    mountedBanner: null,
    writable: true,
    nameOf: new Map([[ADA, "Ada"]]),
    queued: [],
    acting: null,
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
    expect(named.identity).toMatchObject({
      kind: "agent",
      name: COPPER,
      details: { start: entryId("b1") },
    })
    const unnamed = columnView(facts(1, { lane: onLane(laneView(B, "b2")) }))
    expect(unnamed.identity).toEqual({ kind: "pending" })
    expect(columnView(facts(1, { createsLane: true })).identity).toEqual({
      kind: "pending",
    })
    expect(columnView(facts(1)).identity).toEqual({ kind: "none" })
  })
  test("a lane about to start is named by its reserved id, and only while the next send creates it (ADR-0057)", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    const about = (over: Partial<ColumnFacts>) =>
      columnView(
        facts(1, {
          reserved: B,
          work: work({ names: NAMES, banners }),
          ...over,
        }),
      )
    expect(about({ createsLane: true }).identity).toEqual({
      kind: "agent",
      name: COPPER,
      details: {
        open: false,
        started: null,
        where: null,
        behind: null,
        start: null,
      },
    })
    expect(about({ createsLane: true }).banner?.url).toBe(`/blob/${sha}`)
    expect(about({ createsLane: false }).identity).toEqual({ kind: "none" })
    expect(about({ createsLane: false }).banner).toBeNull()
    expect(
      columnView(facts(1, { createsLane: true, reserved: B })).identity,
    ).toEqual({ kind: "pending" })
  })
  test.each([
    ["no lane to create", { createsLane: false }, { kind: "none" }],
    ["read-only", { createsLane: true, writable: false }, { kind: "none" }],
    [
      "a lane already, as the composer's report lags",
      { createsLane: true, lane: onLane(laneView(B, "b2")) },
      { kind: "none" },
    ],
    ["no reservation", { createsLane: true }, { kind: "mint" }],
    ["unnamed", { createsLane: true, reserved: B }, { kind: "ask", lane: B }],
    [
      "named",
      { createsLane: true, reserved: A, work: work({ names: NAMES }) },
      { kind: "none" },
    ],
  ] as const)("the reserve step: %s (ADR-0057)", (_, over, step) => {
    expect(columnView(facts(1, over)).reserve).toEqual(step)
  })
  test("the banner is the thread's at the column's end; a conversation has none", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    expect(
      columnView(
        facts(1, { lane: onLane(laneView(B, "b2")), work: work({ banners }) }),
      ).banner,
    ).toEqual({ url: `/blob/${sha}`, fade: true })
    expect(
      columnView(
        facts(1, { lane: onLane(laneView(A, "b2")), work: work({ banners }) }),
      ).banner,
    ).toBeNull()
    expect(columnView(facts(1, { work: work({ banners }) })).banner).toBeNull()
  })
  test("a banner there as the column mounted shows at once; a new one fades in", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    const shown = (mountedBanner: string | null) =>
      columnView(
        facts(1, {
          lane: onLane(laneView(B, "b2")),
          work: work({ banners }),
          mountedBanner,
        }),
      ).banner?.fade
    expect(shown(`/blob/${sha}`)).toBe(false)
    expect(shown(null)).toBe(true)
    expect(shown("/blob/other")).toBe(true)
  })
  test("a lane that started above the column's first message still has a start", () => {
    // Column 1 shows only the branch; lane A started at 3, in column 0.
    const index = tree([...BRANCH, ["b3", "b2", chat("more", true)]])
    const view = projectColumns(index, [
      { anchor: entryId("6"), anchored: true },
      { anchor: entryId("b3"), anchored: true },
    ])[1]
    if (view === undefined) throw new Error("no view")
    const shows = columnView({
      ...facts(1),
      index,
      view,
      lane: onLane(laneView(A, "b3")),
      work: work({ revisions: revisions({ "3": A }), names: NAMES }),
    })
    expect(shows.identity).toMatchObject({
      kind: "agent",
      name: AMBER,
      details: { start: entryId("3") },
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
      { anchor: entryId("6"), anchored: true },
      { anchor: entryId("2"), anchored: true },
    ])
    if (fromChat === undefined) throw new Error("no view")
    expect(
      columnView({ ...facts(0), index, view: fromChat }).origin,
    ).toMatchObject({ speaker: "Ada", text: "hi" })
  })
})

describe("columnView: a thread's details (ADR-0073)", () => {
  const detailsOf = (shows: ReturnType<typeof columnView>) =>
    shows.identity.kind === "agent" ? shows.identity.details : null
  const onB = (over: Partial<ColumnFacts> = {}) =>
    facts(1, {
      lane: onLane(laneView(B, "b2")),
      work: work({ revisions: OWNERS, names: NAMES }),
      ...over,
    })
  test("closed unless the column keeps them open", () => {
    expect(detailsOf(columnView(onB()))?.open).toBe(false)
    expect(detailsOf(columnView(onB({ detailsOpen: true })))?.open).toBe(true)
  })
  test("who started the lane, and where it works, from its record; neither before it has one", () => {
    const lanes = new Map([[B, record(B, { kind: "own" })]])
    const shown = detailsOf(
      columnView(
        onB({ work: work({ revisions: OWNERS, names: NAMES, lanes }) }),
      ),
    )
    expect(shown?.started).toEqual({ by: "Ada", at: 1 })
    expect(shown?.where).toBe(whereWords({ kind: "own" }, PROJECT))
    const none = detailsOf(columnView(onB()))
    expect(none?.started).toBeNull()
    expect(none?.where).toBeNull()
  })
  test.each([
    [
      "at the root",
      [
        ["r", null, chat("@agent go", true)],
        ["r2", "r", reply("Gone.")],
      ],
      null,
    ],
    [
      "at a message whose parent the index lacks",
      [
        ["o", "gone", chat("@agent go", true)],
        ["o2", "o", reply("Gone.")],
      ],
      null,
    ],
    [
      "below the first message",
      [
        ["r", null, chat("hello")],
        ["o", "r", chat("@agent go", true)],
        ["o2", "o", reply("Gone.")],
      ],
      "o",
    ],
  ] as const)("a lane that started %s", (_, lines, start) => {
    const index = tree(lines)
    const tip = lines.at(-1)?.[0] ?? ""
    const [view] = projectColumns(index, [
      { anchor: entryId(tip), anchored: true },
    ])
    if (view === undefined) throw new Error("no view")
    const shows = columnView({
      ...facts(0),
      index,
      view,
      lane: onLane(laneView(A, tip)),
      work: work({ names: NAMES }),
    })
    expect(detailsOf(shows)?.start).toBe(start === null ? null : entryId(start))
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
  test("a lane the host has never read (no base record) can catch up, and claims nothing", () => {
    const shows = columnView(
      own({
        work: work({
          accepted: ACCEPTED,
          lanes: new Map([[B, record(B, { kind: "own" })]]),
        }),
      }),
    )
    if (shows.strip.kind !== "offer") throw new Error("no offer strip")
    expect(shows.strip.words.menu.find(b => b.button === "update")).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title: "merges pinetrie-onto into this thread's copy",
    })
    expect(shows.behind).toBeNull()
  })
  test("own copy: the offer, in words", () => {
    expect(columnView(own()).strip).toMatchObject({
      kind: "offer",
      state: "nothing",
      bookmark: null,
      waiting: false,
    })
  })
  test("your offer command waits while it is out, and not once answered", () => {
    const sent = {
      kind: "sent",
      id: "s1",
      action: "accept",
      to: null,
    } as const
    expect(columnView(own({ acting: sent })).strip).toMatchObject({
      waiting: true,
      words: { note: "accepting…" },
    })
    expect(
      columnView(
        own({
          acting: {
            kind: "refused",
            code: "refused",
            action: "accept",
            message: "no",
          },
        }),
      ).strip,
    ).toMatchObject({ waiting: false, words: { note: "not done: no" } })
  })
  test("an open offer with files can be reviewed, in every state; an accepted or empty one cannot", () => {
    const open: OfferRecord = {
      lane: B,
      size: 1,
      stale: false,
      files: ["a.txt"],
      conflicts: [],
      startConflicts: [],
      yourEdits: ["a.txt"],
      described: true,
      edited: false,
      bookmark: "pinetrie-offer/copper-owl",
      acceptedAs: null,
      commits: [commitId("c1")],
      ledger: null,
      at: 1,
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
      spans: [{ kind: "revision", commit: commitId("c1") }],
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
    expect(strip({ ...open, acceptedAs: "t1" })).toMatchObject({
      review: null,
    })
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
      line: "edits your files directly",
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
      line: "edits files in /elsewhere",
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

describe("workingWords", () => {
  test.each<[boolean, string | null, string | undefined]>([
    [true, null, "the agent is working"],
    [true, 'Ada: "Fix it"', 'the agent is working on Ada: "Fix it"'],
    [false, 'Ada: "Fix it"', undefined],
  ])("a lane running %s on %s says %s", (running, ask, words) => {
    expect(workingWords(running, ask)).toBe(words)
  })
})

describe("offerWords", () => {
  const offer: OfferRecord = {
    lane: A,
    size: 1,
    stale: false,
    files: ["a.txt", "b.txt"],
    conflicts: [],
    startConflicts: [],
    yourEdits: [],
    described: true,
    edited: false,
    bookmark: "pinetrie-offer/amber-fox",
    acceptedAs: null,
    commits: [commitId("w")],
    ledger: null,
    at: 10,
  }
  const ACCEPTED_BASE = { base: { kind: "accepted" }, state: "ok" } as const
  const words = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" = "idle",
    base: Parameters<typeof offerView>[0]["base"] = ACCEPTED_BASE,
    catching: {
      catchUp?: CatchUpNow
      untraced?: boolean
      queued?: readonly CardCommand[]
      parent?: ParentNow | null
      parentRunning?: boolean
    } = {},
    acting: OfferActing | null = null,
  ) =>
    offerWords(
      offerView({
        offer: offerStatus(o),
        activity,
        asked: null,
        base,
        acceptedBookmark: "pinetrie-onto",
        wipAhead: 2,
        catchUp: catching.catchUp ?? { kind: "current" },
        untraced: catching.untraced ?? false,
        queued: catching.queued ?? [],
        parent: catching.parent ?? null,
        parentRunning: catching.parentRunning ?? false,
      }),
      acting,
    )
  const WIP_BASE = {
    base: { kind: "wip", bookmark: "wip/search" },
    state: "ok",
  } as const
  test.each([
    ["nothing", undefined, "idle", "nothing to accept yet"],
    [
      "held: the project already has its work",
      { ...offer, files: [] },
      "idle",
      "nothing to accept: accepted work already has this thread's work",
    ],
    ["running, nothing yet", undefined, "turn", "no files changed yet"],
    ["running", offer, "turn", "2 files so far"],
    [
      "resolving",
      offer,
      "resolution",
      "resolving what's new in accepted work into this thread",
    ],
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
      "conflicts with accepted work in 1 file",
    ],
    ["edited", { ...offer, edited: true }, "idle", "you edited this offer"],
    [
      "edited, and conflicting",
      { ...offer, edited: true, conflicts: ["a.txt", "b.txt"] },
      "idle",
      "you edited this offer \u00b7 conflicts with accepted work in 2 files",
    ],
    [
      "accepted",
      { ...offer, acceptedAs: "zz12345678ab" },
      "idle",
      "accepted as zz123456",
    ],
  ] as const)("%s", (_, o, activity, line) => {
    const w = words(o, activity)
    expect(w.line).toBe(line)
    expect(w.line).not.toMatch(/`|pinetrie-offer/)
  })
  test("the labels follow the state, and name where an acceptance adds the work", () => {
    const labels = (
      o: OfferRecord,
      base = ACCEPTED_BASE as Parameters<typeof words>[2],
    ) => words(o, "idle", base).buttons.map(b => b.label)
    expect(labels(offer)).toEqual(["accept", "split into a stack"])
    expect(labels({ ...offer, size: 3 })).toEqual([
      "accept stack",
      "squash to one",
    ])
    expect(labels({ ...offer, size: 3, stale: true })).toEqual([
      "split again",
      "accept stack and the rest",
    ])
    expect(labels({ ...offer, edited: true })).toEqual([
      "accept",
      "refresh (discards your edits)",
    ])
    expect(words(offer).menu.map(b => b.label)).toEqual([
      "rewrite description",
      "catch up with accepted work",
    ])
  })
  const MOVE = {
    base: { kind: "accepted" },
    bookmark: "pinetrie-onto",
    from: commitId("a"),
    to: commitId("b"),
  } as const
  test("the jj facts are titles: which bookmark an acceptance moves, and what catching up merges", () => {
    const w = words(offer, "idle", ACCEPTED_BASE, {
      catchUp: { kind: "unknown" },
    })
    expect(w.buttons[0]?.title).toBe(
      "moves pinetrie-onto forward to pinetrie-offer/amber-fox",
    )
    expect(w.menu.find(b => b.button === "update")?.title).toBe(
      "merges pinetrie-onto into this thread's copy",
    )
    expect(words(offer, "idle", WIP_BASE).buttons[0]?.title).toBe(
      "moves wip/search forward to pinetrie-offer/amber-fox",
    )
  })
  const brings = { catchUp: { kind: "brings", move: MOVE, files: 3 } } as const
  test("behind its base, the strip says so and offers catching up beside the offer", () => {
    const behind = words(offer, "idle", ACCEPTED_BASE, brings)
    expect(behind.line).toBe("2 files ready · accepted work has moved on")
    expect(behind.buttons.find(b => b.button === "update")).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title: "merges pinetrie-onto into this thread's copy · changes 3 files",
    })
    expect(words(undefined, "idle", ACCEPTED_BASE, brings).line).toBe(
      "accepted work has moved on since this thread started",
    )
    expect(words(undefined, "idle", WIP_BASE, brings).line).toBe(
      "wip/search has moved on since this thread started",
    )
  })
  test("catching up that would change nothing is disabled, and says why; one not yet read is not (S97)", () => {
    const update = (catchUp: CatchUpNow) =>
      words(offer, "idle", ACCEPTED_BASE, { catchUp }).menu.find(
        b => b.button === "update",
      )
    expect(update({ kind: "current" })).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title: "already caught up with accepted work",
      disabled: true,
    })
    expect(update({ kind: "nothing-new" })).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title:
        "what's new in accepted work is this thread's own: catching up changes no file",
      disabled: true,
    })
    expect(update({ kind: "unknown" })).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title: "merges pinetrie-onto into this thread's copy",
    })
    // Nothing new is no "new work" either.
    expect(
      words(offer, "idle", ACCEPTED_BASE, {
        catchUp: { kind: "nothing-new" },
      }).line,
    ).toBe("2 files ready")
  })
  test("an untraced thread says why nothing is offered, and offers catching up (S97)", () => {
    const w = words(undefined, "idle", ACCEPTED_BASE, { untraced: true })
    expect(w.line).toBe(
      "an earlier accept of this thread can't be traced: catch up with accepted work to offer what's new",
    )
    expect(w.buttons.map(b => [b.label, b.disabled])).toEqual([
      ["catch up with accepted work", undefined],
    ])
  })
  test("a queued catch-up is the offer's activity: the strip says it is catching up", () => {
    expect(
      words(offer, "idle", ACCEPTED_BASE, { queued: ["bring-up-to-date"] })
        .line,
    ).toBe("catching up with accepted work…")
  })
  test("only a clean offer lands on accepted work: a conflicted one on accepted work is caught up and resolved, on a WIP added anyway to it", () => {
    const conflicted = { ...offer, conflicts: ["a.txt"] }
    expect(words(conflicted).buttons.map(b => b.label)).toEqual([
      "catch up with accepted work and resolve",
    ])
    expect(
      words(conflicted, "idle", WIP_BASE).buttons.map(b => b.label),
    ).toEqual([
      "catch up with wip/search and resolve",
      "accept anyway into wip/search",
    ])
    expect(
      words(conflicted, "idle", WIP_BASE).menu.map(b => b.label),
    ).not.toContain("accept, with your 2 commits beneath it")
  })
  test("a conflict that came with the copy says so, and names the thread that resolved it (ADR-0072)", () => {
    const parent: ParentNow = {
      kind: "parent",
      lane: B,
      name: "copper-owl" as ThreadName,
      newest: commitId("p2"),
      caughtUpWith: commitId("p1"),
      conflicts: [],
    }
    const fromStart = {
      ...offer,
      conflicts: ["a.txt"],
      startConflicts: ["a.txt"],
    }
    const resolved = words(fromStart, "idle", ACCEPTED_BASE, { parent })
    expect(resolved.line).toBe(
      "began from a copy with an unresolved conflict in 1 file · copper-owl has resolved it",
    )
    expect(resolved.buttons.map(b => b.label)).toEqual([
      "catch up with copper-owl",
    ])
    const unresolved = words(fromStart, "idle", ACCEPTED_BASE, {
      parent: { ...parent, conflicts: ["a.txt"] },
    })
    expect(unresolved.line).toBe(
      "began from a copy with an unresolved conflict in 1 file",
    )
    expect(unresolved.buttons.map(b => b.label)).toEqual([
      "catch up with accepted work and resolve",
    ])
    const running = words(offer, "idle", ACCEPTED_BASE, {
      parent,
      parentRunning: true,
    }).menu.find(b => b.button === "catch-up-parent")
    expect(running).toMatchObject({
      label: "catch up with copper-owl",
      disabled: true,
      title: "copper-owl is working: catch up when its run ends",
    })
  })
  test("a WIP thread adds to its WIP, and offers the project with its commits", () => {
    const w = words(offer, "idle", WIP_BASE)
    expect(w.buttons[0]?.label).toBe("accept into wip/search")
    expect(w.menu.map(b => b.label)).toEqual([
      "rewrite description",
      "catch up with wip/search",
      "accept, with your 2 commits beneath it",
    ])
  })
  const sent = (
    action: OfferActing["action"],
    to: string | null = null,
  ): OfferActing => ({ kind: "sent", id: "s1", action, to })
  test.each([
    ["nothing out", ACCEPTED_BASE, null, null],
    [
      "an acceptance into accepted work",
      ACCEPTED_BASE,
      sent("accept"),
      "accepting…",
    ],
    [
      "an acceptance into its WIP",
      WIP_BASE,
      sent("accept"),
      "accepting into wip/search…",
    ],
    [
      "an acceptance from a WIP into accepted work",
      WIP_BASE,
      sent("accept", "pinetrie-onto"),
      "accepting…",
    ],
    ["a squash", ACCEPTED_BASE, sent("squash"), "squashing to one…"],
    [
      "a describe",
      ACCEPTED_BASE,
      sent("describe"),
      "rewriting the description…",
    ],
    ["a refresh", ACCEPTED_BASE, sent("refresh"), "refreshing…"],
    [
      "a refusal",
      ACCEPTED_BASE,
      {
        kind: "refused",
        code: "refused",
        action: "accept",
        message: "nothing to accept",
      },
      "not done: nothing to accept",
    ],
    [
      "a failure",
      ACCEPTED_BASE,
      { kind: "failed", action: "squash", message: "jj said no" },
      "it failed, and may be part done: jj said no",
    ],
  ] as const)("your last command: %s", (_, base, acting, note) => {
    expect(words(offer, "idle", base, {}, acting).note).toBe(note)
  })
  test("a WIP gone without landing offers no acceptance, and continuing from the project", () => {
    const w = words(offer, "idle", { ...WIP_BASE, state: "gone" })
    expect(w.buttons.map(b => b.label)).toEqual(["split into a stack"])
    expect(w.menu.map(b => b.label)).toEqual([
      "rewrite description",
      "continue from accepted work",
    ])
  })
})

describe("behindMark: the header's mark for a base that moved on", () => {
  test("worded as the project, with the files catching up changes, the bookmark and both commits in its title", () => {
    expect(behindMark(BASE, ACCEPTED)).toEqual({
      mark: "↓",
      title:
        "accepted work has moved on since this thread started, in 2 files · pinetrie-onto: aaaaaaaa → bbbbbbbb",
    })
  })
  test("a thread's details say it in full (ADR-0073)", () => {
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({
          names: NAMES,
          accepted: ACCEPTED,
          bases: new Map([[B, BASE]]),
        }),
      }),
    )
    expect(shows.identity).toMatchObject({
      details: { behind: behindMark(BASE, ACCEPTED)?.title },
    })
    expect(shows.behind?.title).toBe(behindMark(BASE, ACCEPTED)?.title)
  })
  test("none once caught up, before the host read the base, or when catching up would change nothing or is not yet read (S97)", () => {
    expect(behindMark({ ...BASE, start: ACCEPTED.commit }, ACCEPTED)).toBe(null)
    expect(behindMark(undefined, ACCEPTED)).toBe(null)
    const read = BASE.catchUp
    if (read === null) throw new Error("no read")
    expect(
      behindMark({ ...BASE, catchUp: { ...read, files: [] } }, ACCEPTED),
    ).toBe(null)
    expect(behindMark({ ...BASE, catchUp: null }, ACCEPTED)).toBe(null)
  })
})

describe("identityWords", () => {
  test.each<[Parameters<typeof identityWords>[0], string]>([
    [
      {
        kind: "agent",
        name: "amber-fox" as ThreadName,
        details: {
          open: false,
          started: null,
          where: null,
          behind: null,
          start: null,
        },
      },
      "amber-fox",
    ],
    [{ kind: "pending" }, "new agent"],
  ])("%o", (identity, words) => {
    expect(identityWords(identity)).toBe(words)
  })
})

describe("startedWords", () => {
  test.each([
    [30, "started by Ada · just now"],
    [3 * 3600, "started by Ada · 3 h ago"],
  ])("%d s ago: %s", (seconds, words) => {
    expect(startedWords({ by: "Ada", at: 0 }, seconds * 1000)).toBe(words)
  })
})

describe("where the agent read pinned cards (ADR-0048)", () => {
  const card = (id: string, text: string) => ({ id: cardId(id), text, by: ADA })
  const read = (
    lane: LaneName,
    cards: PinnedView["cards"],
    retired: PinnedView["retired"] = [],
  ): PinnedView => ({ lane, cards, retired })

  test("pinnedMarker: the cards read, and what no longer applies only after this lane's own read", () => {
    const before = read(A, [card("c-1", "old")])
    const entry = read(
      A,
      [card("c-2", "new")],
      [{ id: cardId("c-1"), line: "old" }],
    )
    expect(pinnedMarker(entry, before)).toEqual({
      cards: entry.cards,
      retired: entry.retired,
    })
    // A branch's first run retires its parent's cards, read by another lane.
    expect(
      pinnedMarker(read(B, [], [{ id: cardId("c-1"), line: "old" }]), before),
    ).toBeNull()
    expect(
      pinnedMarker(
        read(B, [card("c-3", "x")], [{ id: cardId("c-1"), line: "old" }]),
        before,
      ),
    ).toEqual({ cards: [card("c-3", "x")], retired: [] })
  })

  test("pinnedMarkers: above the entry whose parent is a cards entry, its prompt, and nowhere else", () => {
    const pinned = (view: PinnedView): AgentMessageLike => ({
      role: "pinned",
      content: "",
      pinned: view,
    })
    const index = indexOf([
      entry("1-q", null, chat("q")),
      entry("2-k", "1-q", pinned(read(A, [card("c-1", "a")]))),
      entry("3-p", "2-k", chat("p", true)),
      entry("4-r", "3-p", { role: "assistant", content: "r" }),
      entry("5-p", "4-r", chat("again", true)),
    ])
    const nodes = ["1-q", "3-p", "4-r", "5-p"].map(id => ({ id: entryId(id) }))
    expect([...pinnedMarkers(index, nodes)]).toEqual([
      [entryId("3-p"), { cards: [card("c-1", "a")], retired: [] }],
    ])
  })
})

test("pinnedStatus: read, changed or unread against what the agent reads, by the host's comparison; none for a card with no text", () => {
  const card = {
    id: cardId("c-1"),
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA } as const,
    carries: PLAIN,
    unsent: null,
  }
  const inView: PinnedView = {
    lane: A,
    cards: [{ id: cardId("c-1"), text: "ship it", by: ADA }],
    retired: [],
  }
  expect(pinnedStatus(card, "ship it", inView)).toBe("read")
  expect(pinnedStatus(card, "ship it now", inView)).toBe("changed")
  expect(pinnedStatus(card, "ship it", null)).toBe("unread")
  expect(pinnedStatus(card, " ", inView)).toBeNull()
  expect(tokensOf("12345")).toBe(2)
})

test.each([
  [{ canPin: true, pinning: false, pinned: 0 }, "header"],
  [{ canPin: true, pinning: false, pinned: 2 }, "strip"],
  [{ canPin: true, pinning: true, pinned: 0 }, null],
  [{ canPin: true, pinning: true, pinned: 2 }, null],
  [{ canPin: false, pinning: false, pinned: 0 }, null],
  [{ canPin: false, pinning: false, pinned: 2 }, null],
] as const)("newPinAt(%o): %s", (facts, want) => {
  expect(newPinAt(facts)).toBe(want)
})

describe("columnView: the queue's controls (ADR-0048 step 7)", () => {
  const controls = (over: Partial<ColumnFacts>) =>
    columnView(facts(0, over)).queue
  test("a writable thread with a lane: hold, and unqueue all while a message card waits", () => {
    expect(controls({ lane: onLane(laneView(A, "6")) })).toEqual({
      lane: A,
      heldBy: null,
      unqueueAll: false,
    })
    expect(
      controls({
        lane: onLane({ ...laneView(A, "6"), heldBy: BEA }),
        queued: [
          {
            id: cardId("c-1"),
            owner: ADA,
            placer: ADA,
            place: {
              kind: "queued",
              root: TEST_ROOT,
              at: atEntry(entryId("6")),
              lane: A,
              order: "a",
              by: ADA,
              seen: "",
            },
            carries: { kind: "message", command: null },
            unsent: null,
          },
        ],
      }),
    ).toEqual({ lane: A, heldBy: BEA, unqueueAll: true })
  })
  test("none read-only, nor with no lane", () => {
    expect(controls({ lane: { kind: "none" } })).toBeNull()
    expect(
      controls({ lane: onLane(laneView(A, "6")), writable: false }),
    ).toBeNull()
  })
  test("words: hold, or who holds it and release; unqueue all only when offered", () => {
    const reader = { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }
    const free = queueControlWords(
      { lane: A, heldBy: null, unqueueAll: false },
      reader,
    )
    expect(free.held).toBeNull()
    expect(free.hold.label).toBe("hold queue")
    expect(free.unqueueAll).toBeNull()
    const held = queueControlWords(
      { lane: A, heldBy: BEA, unqueueAll: true },
      reader,
    )
    expect(held.held).toBe("queue held by Bea")
    expect(held.hold.label).toBe("release")
    expect(held.unqueueAll?.label).toBe("unqueue all")
    expect(
      queueControlWords({ lane: A, heldBy: ADA, unqueueAll: false }, reader)
        .held,
    ).toBe("queue held by you")
  })
})

describe("columnView: the run button (ADR-0082)", () => {
  /** A thread of a prompt and its reply, `tail` after; its lane's tip the last. */
  const thread = (
    reply: AgentMessageLike,
    tail: readonly AgentMessageLike[] = [],
    lane: Partial<LaneView> = {},
  ) => {
    const messages = [{ role: "chat", content: "go" }, reply, ...tail]
    const index = indexOf(
      messages.map((m, n) =>
        entry(`${n + 1}`, n === 0 ? null : `${n}`, m as AgentMessageLike),
      ),
    )
    const tip = `${messages.length}`
    return columnView(
      facts(0, {
        index,
        lane: onLane({ ...laneView(A, tip), ...lane }),
      }),
    ).run
  }
  const stopped: AgentMessageLike = {
    role: "assistant",
    content: [{ type: "text", text: "half" }],
    stopReason: "aborted",
  }
  test("Stop while the lane runs; Resume once it stopped, idle", () => {
    expect(thread(stopped, [], { running: true })).toEqual({ kind: "stop" })
    expect(thread(stopped)).toEqual({ kind: "carry-on" })
    expect(runWords({ kind: "carry-on" }).label).toBe("Resume")
  })
  test("nothing once a message follows the stop, a card waits, or the ask answered", () => {
    expect(thread(stopped, [{ role: "chat", content: "to Bea" }])).toBeNull()
    expect(thread(stopped, [], { waiting: 1 })).toBeNull()
    // A held queue waits for a release: Resume shows beside it.
    expect(thread(stopped, [], { waiting: 1, heldBy: ADA })).toEqual({
      kind: "carry-on",
    })
    expect(thread({ ...stopped, stopReason: "stop" })).toBeNull()
  })
  test("an update after the stop leaves Resume", () => {
    expect(thread(stopped, [{ role: "update", content: "caught up" }])).toEqual(
      { kind: "carry-on" },
    )
  })
  test("read-only, no button at all", () => {
    const index = indexOf([entry("1", null, { role: "chat", content: "go" })])
    expect(
      columnView(
        facts(0, {
          index,
          writable: false,
          lane: onLane(laneView(A, "1", true)),
        }),
      ).run,
    ).toBeNull()
  })
})
