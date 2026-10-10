import {
  type AcceptedRecord,
  type AgentMessageLike,
  type BaseRecord,
  type CardCommand,
  commitId,
  type EntryId,
  entryId,
  indexAsks,
  type LaneRecord,
  type LaneView,
  type OfferRecord,
  type PinnedView,
  type ProjectRecord,
  type RevisionRecord,
  type Sha256,
  type ThreadId,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import {
  type CatchUpNow,
  offerStatus,
  offerView,
  type ParentNow,
} from "@pinetrie/rules"
import type { OfferActing } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { canvasMarkerWords, taskPinnedMarkerWords } from "./card-words.ts"
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
  promptParent,
  startedWords,
  tokensOf,
  type WorkFacts,
  workingWords,
} from "./column-view.ts"
import { entry, indexOf, TEST_ROOT } from "./fixtures.ts"
import { threadLink } from "./thread-link.ts"

const A = threadIdFor("a")
const B = threadIdFor("b")
const _C = threadIdFor("c")
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
  indexOf(lines.map(([id, parentId, message]) => entry(id, parentId, message)))
const revisions = (
  owners: Record<string, ThreadId>,
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
  owners: Record<string, ThreadId>,
  lane: ThreadId | null = null,
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

const PROJECT: ProjectRecord = { root: "/p" }
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
  forks: new Map(),
  filesLost: new Map(),
  budgets: new Map(),
  ...over,
})
/** Accepted work, one commit past the lane's base: `base` read what catching up brings. */
const ACCEPTED = {
  acceptedBookmark: "pinetrie-accepted",
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
  publishCatchesUp: true,
} satisfies AcceptedRecord
const BASE: BaseRecord = {
  lane: threadIdFor("1"),
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
const laneView = (name: ThreadId, tip: string, running = false): LaneView => ({
  name,
  tip: entryId(tip),
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})
const onLane = (view: LaneView): ThreadLane => ({ kind: "lane", ...view })
const record = (lane: ThreadId, ownCopy: boolean): LaneRecord => ({
  lane,
  root: TEST_ROOT,
  ownCopy,
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
    { anchor: entryId("6") },
    { anchor: entryId("b2") },
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
    thread: null,
    mountedBanner: null,
    writable: true,
    nameOf: new Map([[ADA, "Ada"]]),
    queued: [],
    acting: null,
    lanes: [],
    work: work(),
    origins: {
      task: null,
      linkOf: thread => threadLink(thread, [], ADA),
      labelOf: () => "",
      reader: { me: ADA, nameOf: new Map() },
    },
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
  test("a lane about to start is named by its thread's id, and only while the next send creates it (ADR-0057, ADR-0117)", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    const about = (over: Partial<ColumnFacts>) =>
      columnView(
        facts(1, {
          thread: B,
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
        behind: null,
        start: null,
      },
    })
    expect(about({ createsLane: true }).banner?.url).toBe(`/blob/${sha}`)
    expect(about({ createsLane: false }).identity).toEqual({ kind: "none" })
    expect(about({ createsLane: false }).banner).toBeNull()
    expect(
      columnView(facts(1, { createsLane: true, thread: B })).identity,
    ).toEqual({ kind: "pending" })
  })
  test.each([
    ["no lane to create", { thread: B, createsLane: false }, { kind: "none" }],
    ["no thread yet", { createsLane: true }, { kind: "none" }],
    [
      "read-only",
      { thread: B, createsLane: true, writable: false },
      { kind: "none" },
    ],
    [
      "a lane already, as the composer's report lags",
      { thread: B, createsLane: true, lane: onLane(laneView(B, "b2")) },
      { kind: "none" },
    ],
    ["unnamed", { thread: B, createsLane: true }, { kind: "ask", lane: B }],
    [
      "named",
      { thread: A, createsLane: true, work: work({ names: NAMES }) },
      { kind: "none" },
    ],
  ] as const)("the reserve step: %s (ADR-0057, ADR-0117)", (_, over, step) => {
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
      { anchor: entryId("6") },
      { anchor: entryId("b3") },
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
      { anchor: entryId("6") },
      { anchor: entryId("2") },
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
  test("who started the lane, from its record; no one before it has one", () => {
    const lanes = new Map([[B, record(B, true)]])
    const shown = detailsOf(
      columnView(
        onB({ work: work({ revisions: OWNERS, names: NAMES, lanes }) }),
      ),
    )
    expect(shown?.started).toEqual({ by: "Ada", at: 1 })
    const none = detailsOf(columnView(onB()))
    expect(none?.started).toBeNull()
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
    const [view] = projectColumns(index, [{ anchor: entryId(tip) }])
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
      work: work({ lanes: new Map([[B, record(B, true)]]) }),
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
            lanes: new Map([[B, record(B, true)]]),
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
          lanes: new Map([[B, record(B, true)]]),
        }),
      }),
    )
    if (shows.strip.kind !== "offer") throw new Error("no offer strip")
    expect(shows.strip.words.menu.find(b => b.button === "update")).toEqual({
      button: "update",
      label: "catch up with accepted work",
      title: "merges pinetrie-accepted into this thread's copy",
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
            lanes: new Map([[B, record(B, true)]]),
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
  test("a lane with no copy of its own has no strip", () => {
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ lanes: new Map([[B, record(B, false)]]), names: NAMES }),
      }),
    )
    expect(shows.strip).toEqual({ kind: "none" })
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
        acceptedBookmark: "pinetrie-accepted",
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
      "redo the split",
      "accept stack and the rest",
    ])
    expect(
      words({ ...offer, size: 3, stale: true }).buttons.find(
        b => b.button === "split",
      )?.title,
    ).toBe(
      "replaces the stack of 3: splits all of this thread's work, the changes since included",
    )
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
    bookmark: "pinetrie-accepted",
    from: commitId("a"),
    to: commitId("b"),
  } as const
  test("the jj facts are titles: which bookmark an acceptance moves, and what catching up merges", () => {
    const w = words(offer, "idle", ACCEPTED_BASE, {
      catchUp: { kind: "unknown" },
    })
    expect(w.buttons[0]?.title).toBe(
      "moves pinetrie-accepted forward to pinetrie-offer/amber-fox",
    )
    expect(w.menu.find(b => b.button === "update")?.title).toBe(
      "merges pinetrie-accepted into this thread's copy",
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
      title:
        "merges pinetrie-accepted into this thread's copy · changes 3 files",
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
      title: "merges pinetrie-accepted into this thread's copy",
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
      sent("accept", "pinetrie-accepted"),
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
        "accepted work has moved on since this thread started, in 2 files · pinetrie-accepted: aaaaaaaa → bbbbbbbb",
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
  const card = (id: string, text: string) => ({
    id: textCardId(id),
    text,
    by: ADA,
  })
  const read = (
    lane: ThreadId,
    cards: PinnedView["cards"],
    retired: PinnedView["retired"] = [],
  ): PinnedView => ({ lane, cards, retired })

  test("pinnedMarker: the cards read, and what no longer applies only after this lane's own read", () => {
    const before = read(A, [card(cardIdFor("c1"), "old")])
    const entry = read(
      A,
      [card(cardIdFor("c2"), "new")],
      [{ id: cardIdFor("c1"), line: "old" }],
    )
    expect(pinnedMarker(entry, before)).toEqual({
      cards: entry.cards,
      retired: entry.retired,
    })
    // A branch's first run retires its parent's cards, read by another lane.
    expect(
      pinnedMarker(
        read(
          B,
          [],
          [
            {
              id: cardIdFor("c1"),
              line: "old",
            },
          ],
        ),
        before,
      ),
    ).toBeNull()
    expect(
      pinnedMarker(
        read(
          B,
          [card(cardIdFor("c3"), "x")],
          [
            {
              id: cardIdFor("c1"),
              line: "old",
            },
          ],
        ),
        before,
      ),
    ).toEqual({
      cards: [card(cardIdFor("c3"), "x")],
      retired: [],
    })
  })

  test("pinnedMarkers: above the entry whose parent is a cards entry, its prompt, and nowhere else", () => {
    const pinned = (view: PinnedView): AgentMessageLike => ({
      role: "pinned",
      content: "",
      pinned: view,
    })
    const index = indexOf([
      entry("1-q", null, chat("q")),
      entry("2-k", "1-q", pinned(read(A, [card(cardIdFor("c1"), "a")]))),
      entry("3-p", "2-k", chat("p", true)),
      entry("4-r", "3-p", { role: "assistant", content: "r" }),
      entry("5-p", "4-r", chat("again", true)),
    ])
    const nodes = ["1-q", "3-p", "4-r", "5-p"].map(id => ({ id: entryId(id) }))
    expect([...pinnedMarkers(index, nodes)]).toEqual([
      [
        entryId("3-p"),
        {
          cards: [card(cardIdFor("c1"), "a")],
          retired: [],
        },
      ],
    ])
  })

  test("pinnedMarkers: a run's task pins and canvas list, written above its prompt with its cards entry, mark it too (ADR-0116)", () => {
    const K = taskIdFor("k")
    const canvas = { task: K, title: "T", lines: ["thread a"], more: 0 }
    const taskCards = [card(cardIdFor("c2"), "all")]
    const index = indexOf([
      entry("1-q", null, chat("q")),
      entry("2-c", "1-q", { role: "canvas", content: "", canvas }),
      entry("3-t", "2-c", {
        role: "task-pinned",
        content: "",
        taskPinned: { task: K, cards: taskCards, retired: [] },
      }),
      entry("4-p", "3-t", chat("p", true)),
      entry("5-r", "4-p", { role: "assistant", content: "r" }),
      // A canvas list alone, then a prompt: marked; the reply is not.
      entry("6-c", "5-r", { role: "canvas", content: "", canvas }),
      entry("7-p", "6-c", chat("again", true)),
    ])
    const nodes = ["4-p", "5-r", "7-p"].map(id => ({ id: entryId(id) }))
    expect([...pinnedMarkers(index, nodes)]).toEqual([
      [
        entryId("4-p"),
        {
          cards: [],
          retired: [],
          taskPinned: { cards: taskCards, retired: [] },
          canvas,
        },
      ],
      [entryId("7-p"), { cards: [], retired: [], canvas }],
    ])
    // An edit of 7-p sends again after 5-r, past its run's canvas list.
    expect(promptParent(index, entryId("7-p"))).toBe("5-r")
    expect(promptParent(index, entryId("5-r"))).toBe("4-p")
    expect(promptParent(index, entryId("1-q"))).toBeNull()
    expect(canvasMarkerWords(canvas)).toBe(
      "the agent was told the task's canvas: 1 card",
    )
    expect(taskPinnedMarkerWords({ cards: taskCards, retired: [] })).toBe(
      "the agent read 1 card pinned to the task",
    )
  })
})

test("pinnedStatus: read, changed or unread against what the agent reads, by the host's comparison; none for a card with no text", () => {
  const card = {
    kind: "text" as const,
    id: cardIdFor("c1"),
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA } as const,
    content: { command: null, unsent: null, origin: null },
  }
  const inView: PinnedView = {
    lane: A,
    cards: [
      {
        id: cardIdFor("c1"),
        text: "ship it",
        by: ADA,
      },
    ],
    retired: [],
  }
  expect(pinnedStatus(card, "ship it", inView)).toBe("read")
  expect(pinnedStatus(card, "ship it now", inView)).toBe("changed")
  expect(pinnedStatus(card, "ship it", null)).toBe("unread")
  expect(pinnedStatus(card, " ", inView)).toBeNull()
  expect(tokensOf("12345")).toBe(2)
})

test.each([
  [
    {
      canPin: true,
      pinning: false,
      pinned: 0,
    },
    "header",
  ],
  [
    {
      canPin: true,
      pinning: false,
      pinned: 2,
    },
    "strip",
  ],
  [
    {
      canPin: true,
      pinning: true,
      pinned: 0,
    },
    null,
  ],
  [
    {
      canPin: true,
      pinning: true,
      pinned: 2,
    },
    null,
  ],
  [
    {
      canPin: false,
      pinning: false,
      pinned: 0,
    },
    null,
  ],
  [
    {
      canPin: false,
      pinning: false,
      pinned: 2,
    },
    null,
  ],
] as const)("newPinAt(%o): %s", (facts, want) => {
  expect(newPinAt(facts)).toBe(want)
})
