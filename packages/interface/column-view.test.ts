import {
  canvasIdFor,
  commitId,
  type EntryId,
  entryId,
  type JjAcceptedRecord,
  type JjProposedChangesRecord,
  type LaneRecord,
  pointId,
  type RevisionRecord,
  type Sha256,
  snapshotId,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type LatestNow,
  type ParentNow,
  type ProjectRecord,
  proposedChangesStatus,
  type WorkStripButton,
  workStripView,
} from "@pinetrie/rules"
import type { ProposedChangesActing } from "@pinetrie/session"
import {
  type AgentMessageLike,
  type CardCommand,
  entryThread,
  indexAsks,
  type LaneView,
  type PinnedView,
  type ThreadLane,
  type TreeIndex,
  textCardId,
  UNTICKED,
} from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { canvasMarkerWords, canvasPinnedMarkerWords } from "./card-words.ts"
import { projectColumns } from "./column-paths.ts"
import type { ColumnStatus } from "./column-status.ts"
import {
  buttonCommand,
  type ColumnFacts,
  type ColumnShows,
  columnView,
  handleTitle,
  headLine,
  identityWords,
  joinWords,
  lanesAlong,
  newPinPlace,
  pinnedMarker,
  pinnedMarkers,
  pinnedStatus,
  promptParent,
  stripResolveCommand,
  textTokens,
  type WorkFacts,
  type WorkStrip,
  workingWords,
  workStripShown,
  workStripWords,
} from "./column-view.ts"
import {
  entry,
  indexEntries,
  personMessage,
  TEST_ROOT,
  toolResultMessage,
} from "./fixtures.ts"
import type { ThreadAbout } from "./thread-glance.ts"
import { builtInIconUrl } from "./thread-icon.ts"
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
const said = (text: string, compelled = false): AgentMessageLike =>
  personMessage(text, { author: "Ada", writer: ADA, compelled })
const reply = (text: string): AgentMessageLike => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const tree = (lines: readonly Line[]): TreeIndex =>
  indexEntries(
    lines.map(([id, parentId, message]) => entry(id, parentId, message)),
  )
const revisions = (
  owners: Record<string, ThreadId>,
): ReadonlyMap<EntryId, RevisionRecord> =>
  new Map(
    Object.entries(owners).map(([id, lane]) => [
      entryId(id),
      {
        entry: entryId(id),
        lane,
        point: null,
        snapshot: null,
        paths: [],
        conflicts: [],
        disk: null,
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
  ["1", null, said("hello")],
  ["2", "1", said("hi")],
  ["3", "2", said("@agent look", true)],
  ["4", "3", reply("It says MANGO.")],
  ["5", "4", said("thanks, and?", true)],
  ["6", "5", reply("Nothing else.")],
]
const BRANCH: readonly Line[] = [
  ...TRUNK,
  ["b1", "4", said("@agent try another", true)],
  ["b2", "b1", reply("Another.")],
]

describe("lanesAlong", () => {
  const index = tree(BRANCH)
  test.each([
    [
      "a chat that asks the agent: one stretch",
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

const PROJECT: ProjectRecord = { root: "/p", kind: "jj", owner: null }
const work = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  project: PROJECT,
  focuses: new Map(),
  titles: new Map(),
  commands: [],
  lanes: new Map(),
  revisions: new Map(),
  proposedByLane: new Map(),
  names: new Map(),
  banners: new Map(),
  icons: null,
  access: new Map(),
  accepted: null,
  bases: new Map(),
  forks: new Map(),
  laneForks: new Map(),
  asking: new Set(),
  setup: null,
  allowances: new Map(),
  states: new Map(),
  conflicts: [],
  ...over,
})
/** Accepted work, one commit past the lane's base: `base` read what catching up brings. */
const ACCEPTED = {
  kind: "jj",
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  published: { commit: null, behind: 0, ahead: 0 },
  commit: commitId("bbbbbbbbbbbb"),
  heads: { current: null, proposed: "" },
  log: { current: null, proposed: "" },
  unfinishedWork: [],
  workingCopy: {
    behind: 0,
    ahead: 0,
    getLatest: null,
    conflicts: { commits: 0, files: [] },
  },
  publishCatchesUp: true,
} satisfies JjAcceptedRecord
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
const record = (lane: ThreadId, own: boolean): LaneRecord => ({
  lane,
  root: TEST_ROOT,
  history: own ? "jj" : null,
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
    thread: null,
    mountedIcon: null,
    writable: true,
    nameOf: new Map([[ADA, "Ada"]]),
    queued: [],
    acting: null,
    lanes: [],
    work: work(),
    origins: {
      canvas: null,
      linkOf: thread => threadLink(thread, [], ADA),
      labelOf: () => "",
      reader: { me: ADA, nameOf: new Map() },
    },
    runEnds: new Map(),
    lanesHeld: new Map(),
    ...over,
  }
}
const OWNERS = revisions({ "3": A, "5": A, b1: B })
/** The header's icon: a named agent's alone carries one. */
const headIconOf = (shows: ColumnShows) =>
  shows.head.identity.kind === "agent" ? shows.head.identity.icon : null

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
    expect(named.head.identity).toMatchObject({ kind: "agent", name: COPPER })
    expect(named.head.facts).toMatchObject({ start: entryId("b1") })
    const unnamed = columnView(facts(1, { lane: onLane(laneView(B, "b2")) }))
    expect(unnamed.head.identity).toEqual({ kind: "pending" })
    expect(columnView(facts(1, { createsLane: true })).head.identity).toEqual({
      kind: "pending",
    })
    expect(columnView(facts(1)).head.identity).toEqual({ kind: "none" })
  })
  test("a thread with a focus shows it in its header", () => {
    const focuses = new Map([
      [
        B,
        {
          thread: B,
          focus: "Planning the billing page",
          ask: entryId("b1"),
          at: 1,
        },
      ],
    ])
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ revisions: OWNERS, names: NAMES, focuses }),
      }),
    )
    expect(shows.head.line).toEqual({
      kind: "about",
      about: {
        kind: "focus",
        focus: { kind: "model", text: "Planning the billing page" },
      },
    })
  })
  test("a thread's title shows in its header instead of its focus", () => {
    const focuses = new Map([
      [
        B,
        {
          thread: B,
          focus: "Planning the billing page",
          ask: entryId("b1"),
          at: 1,
        },
      ],
    ])
    const titles = new Map([
      [B, { card: B, title: "Billing, take two", by: ADA, at: 1 }],
    ])
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ revisions: OWNERS, names: NAMES, focuses, titles }),
      }),
    )
    expect(shows.head.line).toEqual({
      kind: "about",
      about: { kind: "title", title: { title: "Billing, take two", by: ADA } },
    })
  })
  test("a chat's header shows its title, and nothing while it has none", () => {
    const titles = new Map([
      [B, { card: B, title: "Lunch plans", by: ADA, at: 1 }],
    ])
    expect(
      columnView(facts(1, { thread: B, work: work({ titles }) })).head.line,
    ).toEqual({
      kind: "about",
      about: { kind: "title", title: { title: "Lunch plans", by: ADA } },
    })
    expect(columnView(facts(1, { thread: B })).head.line).toEqual({
      kind: "none",
    })
  })
  test("a thread whose last run needs you says so in its header", () => {
    const standing = {
      record: {
        lane: B,
        ask: entryId("b1"),
        end: entryId("b2"),
        report: { kind: "stopped", by: ADA } as const,
      },
      level: "worth-a-read" as const,
      raised: true,
    }
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ revisions: OWNERS, names: NAMES }),
        runEnds: new Map([
          [A, { ...standing, record: { ...standing.record, lane: A } }],
          [B, standing],
        ]),
      }),
    )
    expect(shows.head.line).toMatchObject({
      kind: "status",
      status: {
        level: "worth-a-read",
        quiet: false,
        words: "worth a read: Ada stopped it",
        end: entryId("b2"),
      },
    })
  })
  test("a lane about to start is named by its thread's id, and only while the next send creates it", () => {
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
    expect(about({ createsLane: true }).head.identity).toEqual({
      kind: "agent",
      name: COPPER,
      icon: { kind: "banner", url: `/blob/${sha}`, fade: true },
    })
    expect(about({ createsLane: false }).head.identity).toEqual({
      kind: "none",
    })
    expect(
      columnView(facts(1, { createsLane: true, thread: B })).head.identity,
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
      "named, with its banner",
      {
        thread: A,
        createsLane: true,
        work: work({
          names: NAMES,
          banners: new Map([
            [A, { lane: A, sha: "a".repeat(64) as Sha256, at: 1 }],
          ]),
        }),
      },
      { kind: "none" },
    ],
    [
      "named as a chat's thread, opened before its lane: its banner is due",
      { thread: A, createsLane: true, work: work({ names: NAMES }) },
      { kind: "ask", lane: A },
    ],
  ] as const)("the reserve step: %s", (_, over, step) => {
    expect(columnView(facts(1, over)).reserve).toEqual(step)
  })
  test("the header's icon is its named agent's; a pending or conversation header has none", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    const icon = (over: Partial<ColumnFacts>, w: Partial<WorkFacts>) =>
      headIconOf(columnView(facts(1, { ...over, work: work(w) })))
    const onB = { lane: onLane(laneView(B, "b2")) }
    expect(icon(onB, { banners, names: NAMES })).toEqual({
      kind: "banner",
      url: `/blob/${sha}`,
      fade: true,
    })
    expect(icon(onB, { banners })).toBeNull()
    expect(
      icon({ lane: onLane(laneView(A, "b2")) }, { banners, names: NAMES }),
    ).toBeNull()
    expect(icon({}, { banners, names: NAMES })).toBeNull()
  })
  test("under built-in icons, a named agent's header shows its noun's icon; a chat's none", () => {
    const icons = { source: "built-in" } as const
    expect(
      headIconOf(
        columnView(
          facts(1, {
            lane: onLane(laneView(B, "b2")),
            work: work({ names: NAMES, icons }),
          }),
        ),
      ),
    ).toEqual({
      kind: "built-in",
      url: builtInIconUrl("owl"),
      fade: true,
    })
    expect(
      headIconOf(
        columnView(
          facts(1, { thread: B, work: work({ names: NAMES, icons }) }),
        ),
      ),
    ).toBeNull()
  })
  test("an icon there as the column mounted shows at once; a new one fades in", () => {
    const sha = "a".repeat(64) as Sha256
    const banners = new Map([[B, { lane: B, sha, at: 1 }]])
    const shown = (mountedIcon: string | null) =>
      headIconOf(
        columnView(
          facts(1, {
            lane: onLane(laneView(B, "b2")),
            work: work({ banners, names: NAMES }),
            mountedIcon,
          }),
        ),
      )?.fade
    expect(shown(`/blob/${sha}`)).toBe(false)
    expect(shown(null)).toBe(true)
    expect(shown("/blob/other")).toBe(true)
  })
  test("a lane that started above the column's first message still has a start", () => {
    // Column 1 shows only the branch; lane A started at 3, in column 0.
    const index = tree([...BRANCH, ["b3", "b2", said("more", true)]])
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
    expect(shows.head.identity).toMatchObject({ kind: "agent", name: AMBER })
    expect(shows.head.facts?.start).toBe(entryId("3"))
  })
  test("the origin: a chat by its speaker, an agent reply by its lane, else 'agent'", () => {
    const byLane = columnView(
      facts(1, { work: work({ revisions: OWNERS, names: NAMES }) }),
    )
    expect(byLane.head.origin).toEqual({
      kind: "fork",
      at: entryId("4"),
      speaker: "amber-fox",
      text: "It says MANGO.",
    })
    expect(columnView(facts(1)).head.origin).toMatchObject({ speaker: "agent" })
    expect(columnView(facts(0)).head.origin).toEqual({ kind: "none" })
    const index = tree(TRUNK)
    const [, fromMessage] = projectColumns(index, [
      { anchor: entryId("6") },
      { anchor: entryId("2") },
    ])
    if (fromMessage === undefined) throw new Error("no view")
    expect(
      columnView({ ...facts(0), index, view: fromMessage }).head.origin,
    ).toMatchObject({ speaker: "Ada", text: "hi" })
  })
})

describe("columnView: the fork row of a thread forked elsewhere", () => {
  const index = tree(BRANCH)
  const thread = entryThread(index, entryId("b1"))
  const row = (how: "branch" | "copy") => {
    if (thread === null) throw new Error("no thread")
    const forks = new Map([
      [thread, { kind: "fork", at: entryId("4"), how } as const],
    ])
    return columnView(facts(1, { thread, work: work({ forks }) })).head.origin
  }
  test("a copy whose fork began from its base says its files could not be copied", () => {
    if (thread === null) throw new Error("no thread")
    const forks = new Map([
      [thread, { kind: "fork", at: entryId("4"), how: "copy" } as const],
    ])
    const words = (lost: string | null) => {
      const laneForks = new Map([
        [
          thread,
          {
            lane: thread,
            base: null,
            state: "begun",
            lost: lost === null ? null : snapshotId(lost),
            instead: lost === null ? null : "base",
          } as const,
        ],
      ])
      const o = columnView(
        facts(1, { thread, work: work({ forks, laneForks }) }),
      ).head.origin
      return o.kind === "source" ? o.words : ""
    }
    expect(words("e1")).toContain("its files could not be copied")
    expect(words(null)).not.toContain("its files could not be copied")
  })
  test("a branch whose fork kept a lost turn's files from its point says it started from an earlier turn's installed files", () => {
    if (thread === null) throw new Error("no thread")
    const forks = new Map([
      [thread, { kind: "fork", at: entryId("4"), how: "branch" } as const],
    ])
    const laneForks = new Map([
      [
        thread,
        {
          lane: thread,
          base: null,
          state: "begun",
          lost: snapshotId("e1"),
          instead: "point",
        } as const,
      ],
    ])
    const o = columnView(facts(1, { thread, work: work({ forks, laneForks }) }))
      .head.origin
    expect(o.kind === "source" ? o.words : "").toContain(
      "started from an earlier turn's installed files; reinstall if needed",
    )
  })
  test("a branch whose fork lost a turn's files to its base says so", () => {
    if (thread === null) throw new Error("no thread")
    const forks = new Map([
      [thread, { kind: "fork", at: entryId("4"), how: "branch" } as const],
    ])
    const laneForks = new Map([
      [
        thread,
        {
          lane: thread,
          base: null,
          state: "begun",
          lost: snapshotId("e1"),
          instead: "base",
        } as const,
      ],
    ])
    const o = columnView(facts(1, { thread, work: work({ forks, laneForks }) }))
      .head.origin
    expect(o.kind === "source" ? o.words : "").toContain(
      "that turn's files are gone: started from its thread's base",
    )
  })
  test("a copy says it was copied; a branch, only where it is from", () => {
    expect(row("copy")).toMatchObject({ kind: "source", copied: true })
    expect(row("branch")).toMatchObject({ kind: "source", copied: false })
    const words = (o: ReturnType<typeof row>) =>
      o.kind === "source" ? o.words : ""
    expect(words(row("copy"))).toMatch(/^copied from /)
    expect(words(row("branch"))).toMatch(/^from /)
  })
})

describe("columnView: the fork row of a branch opened from a proposal", () => {
  test("names the proposing agent's proposal and its row's title", () => {
    const index = tree([
      ...BRANCH,
      [
        "pr",
        "6",
        toolResultMessage({
          content: "ok",
          proposal: {
            branches: [
              { title: "one", brief: "do one" },
              { title: "two", brief: "do two" },
            ],
          },
        }),
      ],
    ])
    const thread = entryThread(index, entryId("b1"))
    if (thread === null) throw new Error("no thread")
    const forks = new Map([
      [
        thread,
        {
          kind: "fork",
          at: entryId("4"),
          how: "branch",
          proposal: { entry: entryId("pr"), row: 1 },
        } as const,
      ],
    ])
    const T = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
    const origin = columnView(
      facts(1, {
        index,
        thread,
        work: work({ forks }),
        origins: {
          canvas: T,
          linkOf: t =>
            threadLink(
              t,
              [
                {
                  kind: "thread",
                  id: t,
                  owner: ADA,
                  placer: ADA,
                  place: { kind: "canvas", canvas: T, order: "a", width: 1 },
                  content: UNTICKED,
                },
              ],
              ADA,
            ),
          labelOf: () => "",
          reader: { me: ADA, nameOf: new Map() },
        },
      }),
    ).head.origin
    expect(origin).toEqual({
      kind: "fork",
      at: entryId("4"),
      speaker: "agent's proposal",
      text: "two",
    })
  })
})

describe("headLine: what shows under a column's line", () => {
  const status = (quiet: boolean): ColumnStatus => ({
    level: "needs-you",
    quiet,
    words: "needs you: asks why",
    reason: "asks why",
    end: entryId("e"),
  })
  const focus: ThreadAbout = {
    kind: "focus",
    focus: { kind: "model", text: "Fixing the sync bug" },
  }
  test("a raised status, else the focus; never a quiet status, which leaves the focus shown", () => {
    expect(headLine(status(false), focus)).toEqual({
      kind: "status",
      status: status(false),
    })
    expect(headLine(status(true), focus)).toEqual({
      kind: "about",
      about: focus,
    })
    expect(headLine(null, null)).toEqual({ kind: "none" })
  })

  test("a lane held for memory says why, under a raised status and over the focus", () => {
    const paused = { kind: "paused" } as const
    expect(headLine(null, focus, paused)).toEqual({
      kind: "held",
      words: "paused for memory: its next tool call waits for room",
    })
    expect(headLine(status(false), focus, paused).kind).toBe("status")
    expect(headLine(null, focus, { kind: "normal" })).toEqual({
      kind: "about",
      about: focus,
    })
  })
})

describe("columnView: a thread's facts", () => {
  const detailsOf = (shows: ReturnType<typeof columnView>) => shows.head.facts
  const onB = (over: Partial<ColumnFacts> = {}) =>
    facts(1, {
      lane: onLane(laneView(B, "b2")),
      work: work({ revisions: OWNERS, names: NAMES }),
      ...over,
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
        ["r", null, said("@agent go", true)],
        ["r2", "r", reply("Gone.")],
      ],
      null,
    ],
    [
      "at a message whose parent the index lacks",
      [
        ["o", "gone", said("@agent go", true)],
        ["o2", "o", reply("Gone.")],
      ],
      null,
    ],
    [
      "below the first message",
      [
        ["r", null, said("hello")],
        ["o", "r", said("@agent go", true)],
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
    expect(columnView(facts(1)).dock.strip).toBeNull()
    expect(columnView(own({ writable: false })).dock.strip).toBeNull()
    expect(
      columnView(
        own({
          work: work({
            project: null,
            lanes: new Map([[B, record(B, true)]]),
          }),
        }),
      ).dock.strip,
    ).toBeNull()
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
    if (shows.dock.strip === null) throw new Error("no work strip")
    expect(
      shows.dock.strip.words.menu.find(b => b.button === "update"),
    ).toEqual({
      button: "update",
      label: "get the latest",
      title: "merges accepted work into this thread's copy",
    })
  })
  test("own copy: the proposed changes, in words", () => {
    expect(columnView(own()).dock.strip).toMatchObject({
      state: "nothing",
      bookmark: null,
      waiting: false,
    })
  })
  test("your command on proposed changes wait while they are out, and not once answered", () => {
    const sent = {
      kind: "sent",
      id: "s1",
      action: "accept",
      to: null,
    } as const
    expect(columnView(own({ acting: sent })).dock.strip).toMatchObject({
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
      ).dock.strip,
    ).toMatchObject({ waiting: false, words: { note: "not done: no" } })
  })
  test("open proposed changes with files can be reviewed, in every state; an accepted or empty one cannot", () => {
    const open: JjProposedChangesRecord = {
      kind: "jj",
      lane: B,
      size: 1,
      stale: false,
      files: ["a.txt"],
      conflicts: [],
      startConflicts: [],
      workingCopyEdits: ["a.txt"],
      described: true,
      edited: false,
      bookmark: "pinetrie-proposed/copper-owl",
      acceptedAs: null,
      commits: [commitId("c1")],
      ledger: null,
      at: 1,
    }
    const strip = (proposed: JjProposedChangesRecord, running = false) =>
      columnView(
        own({
          lane: onLane(laneView(B, "b2", running)),
          work: work({
            lanes: new Map([[B, record(B, true)]]),
            proposedByLane: new Map([[B, proposed]]),
          }),
        }),
      ).dock.strip
    const target = {
      spans: [{ kind: "revision", commit: commitId("c1") }],
      conflicts: [],
      workingCopyEdits: ["a.txt"],
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
    expect(columnView(own()).dock.strip).toMatchObject({
      state: "nothing",
      review: null,
    })
  })
  test("the dock draws ready and conflicted changes, never nothing to accept; a conflicted one resolves by getting the latest", () => {
    const open: JjProposedChangesRecord = {
      kind: "jj",
      lane: B,
      size: 1,
      stale: false,
      files: ["a.txt"],
      conflicts: [],
      startConflicts: [],
      workingCopyEdits: [],
      described: true,
      edited: false,
      bookmark: "pinetrie-proposed/copper-owl",
      acceptedAs: null,
      commits: [commitId("c1")],
      ledger: null,
      at: 1,
    }
    const dock = (proposed: JjProposedChangesRecord | null) =>
      columnView(
        own({
          work: work({
            lanes: new Map([[B, record(B, true)]]),
            proposedByLane:
              proposed === null ? new Map() : new Map([[B, proposed]]),
          }),
        }),
      ).dock
    expect(dock(open)).toMatchObject({ shown: true, resolve: null })
    expect(dock({ ...open, conflicts: ["a.txt"] })).toMatchObject({
      shown: true,
      resolve: "get-latest",
    })
    expect(dock(null)).toMatchObject({ shown: false, resolve: null })
  })
  test("the send button's ▾ resolves in needs-you, and its line asks for your answer", () => {
    const conflicted: JjProposedChangesRecord = {
      kind: "jj",
      lane: B,
      size: 1,
      stale: false,
      files: ["a.txt"],
      conflicts: ["a.txt"],
      startConflicts: [],
      workingCopyEdits: [],
      described: true,
      edited: false,
      bookmark: "pinetrie-proposed/copper-owl",
      acceptedAs: null,
      commits: [commitId("c1")],
      ledger: null,
      at: 1,
    }
    const { dock } = columnView(
      own({
        work: work({
          lanes: new Map([[B, record(B, true)]]),
          proposedByLane: new Map([[B, conflicted]]),
          asking: new Set([B]),
        }),
      }),
    )
    expect(dock.resolve).toBe("get-latest")
    expect(dock.strip?.state).toBe("needs-you")
    expect(dock.strip?.words.line).toBe(
      "the agent has a question about a conflict · answer it in the thread",
    )
    expect(dock.strip?.words.buttons[0]).toMatchObject({
      button: "answer",
      label: "answer the agent",
    })
  })
  test("a lane with no copy of its own has no strip", () => {
    const shows = columnView(
      facts(1, {
        lane: onLane(laneView(B, "b2")),
        work: work({ lanes: new Map([[B, record(B, false)]]), names: NAMES }),
      }),
    )
    expect(shows.dock.strip).toBeNull()
  })
})

describe("the dock's changes row", () => {
  const strip = (
    state: WorkStrip["state"],
    buttons: readonly WorkStripButton[],
    note: string | null = null,
    resolvingButton: WorkStrip["resolvingButton"] = null,
  ): WorkStrip => ({
    state,
    words: {
      line: "",
      lineTitle: null,
      note,
      buttons: buttons.map(button => ({ button, label: button })),
      menu: [],
    },
    waiting: false,
    bookmark: null,
    review: null,
    destinations: [],
    resolvingButton,
  })
  test("is drawn while it says something: never for nothing to accept with no button and no note", () => {
    expect(workStripShown(null)).toBe(false)
    expect(workStripShown(strip("nothing", []))).toBe(false)
    expect(workStripShown(strip("nothing", ["update"]))).toBe(true)
    expect(workStripShown(strip("nothing", [], "a note"))).toBe(true)
    expect(workStripShown(strip("ready", []))).toBe(true)
  })
  test("a button queues its command; accept queues none", () => {
    expect(buttonCommand("update")).toBe("get-latest")
    expect(buttonCommand("continue")).toBe("continue-on-accepted")
    expect(buttonCommand("get-latest-from-parent")).toBe(
      "get-latest-from-parent",
    )
    expect(buttonCommand("split")).toBe("split")
    expect(buttonCommand("accept")).toBeNull()
  })
  test("a conflict resolves by its resolving button's command, the parent's when it came with the copy; nothing else resolves", () => {
    expect(
      stripResolveCommand(strip("conflicts", ["update"], null, "update")),
    ).toBe("get-latest")
    expect(
      stripResolveCommand(
        strip(
          "conflicts",
          ["get-latest-from-parent"],
          null,
          "get-latest-from-parent",
        ),
      ),
    ).toBe("get-latest-from-parent")
    expect(stripResolveCommand(strip("ready", ["update"]))).toBeNull()
    expect(stripResolveCommand(null)).toBeNull()
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

describe("workStripWords", () => {
  const proposed: JjProposedChangesRecord = {
    kind: "jj",
    lane: A,
    size: 1,
    stale: false,
    files: ["a.txt", "b.txt"],
    conflicts: [],
    startConflicts: [],
    workingCopyEdits: [],
    described: true,
    edited: false,
    bookmark: "pinetrie-proposed/amber-fox",
    acceptedAs: null,
    commits: [commitId("w")],
    ledger: null,
    at: 10,
  }
  const ACCEPTED_BASE = {
    kind: "jj",
    base: { kind: "accepted" },
    state: "ok",
  } as const
  const words = (
    o: JjProposedChangesRecord | undefined,
    activity: "idle" | "turn" | "resolution" = "idle",
    base: Parameters<typeof workStripView>[0]["base"] = ACCEPTED_BASE,
    catching: {
      getLatest?: LatestNow
      untraced?: boolean
      queued?: readonly CardCommand[]
      parent?: ParentNow | null
      parentRunning?: boolean
    } = {},
    acting: ProposedChangesActing | null = null,
  ) =>
    workStripWords(
      workStripView({
        proposed: proposedChangesStatus(o),
        activity,
        asking: false,
        base,
        into: { kind: "bookmark", bookmark: "pinetrie-accepted" },
        unfinishedAhead: 2,
        getLatest: catching.getLatest ?? { kind: "current" },
        untraced: catching.untraced ?? false,
        queued: catching.queued ?? [],
        parent: catching.parent ?? null,
        parentRunning: catching.parentRunning ?? false,
      }),
      acting,
    )
  const UNFINISHED_BASE = {
    kind: "jj",
    base: { kind: "unfinished", bookmark: "wip/search" },
    state: "ok",
  } as const
  test.each([
    ["nothing", undefined, "idle", "nothing to accept yet"],
    [
      "nothing to add: the project already has its work",
      { ...proposed, files: [] },
      "idle",
      "nothing to accept: accepted work already has this thread's work",
    ],
    ["running, nothing yet", undefined, "turn", "no files changed yet"],
    ["running", proposed, "turn", "2 files so far"],
    ["resolving", proposed, "resolution", "merging in the latest work"],
    ["ready", proposed, "idle", "2 files changed"],
    [
      "ready, touching your edits",
      { ...proposed, workingCopyEdits: ["a.txt"] },
      "idle",
      "2 files changed · touches files you're editing",
    ],
    [
      "a stack",
      { ...proposed, size: 3 },
      "idle",
      "a stack of 3 · 2 files changed",
    ],
    [
      "a stale stack",
      { ...proposed, size: 3, stale: true },
      "idle",
      "a stack of 3, and changes since",
    ],
    [
      "conflicts",
      { ...proposed, conflicts: ["a.txt"] },
      "idle",
      "conflicts with accepted work in 1 file",
    ],
    [
      "edited",
      { ...proposed, edited: true },
      "idle",
      "you edited these changes",
    ],
    [
      "edited, and conflicting",
      { ...proposed, edited: true, conflicts: ["a.txt", "b.txt"] },
      "idle",
      "you edited these changes \u00b7 conflicts with accepted work in 2 files",
    ],
    [
      "accepted",
      { ...proposed, acceptedAs: "zz12345678ab" },
      "idle",
      "accepted ✓",
    ],
  ] as const)("%s", (_, o, activity, line) => {
    const w = words(o, activity)
    expect(w.line).toBe(line)
    expect(w.line).not.toMatch(/`|pinetrie-proposed/)
  })
  test("the labels follow the state, and name where an acceptance adds the work", () => {
    const labels = (
      o: JjProposedChangesRecord,
      base = ACCEPTED_BASE as Parameters<typeof words>[2],
    ) => words(o, "idle", base).buttons.map(b => b.label)
    expect(labels(proposed)).toEqual(["accept changes", "split into a stack"])
    expect(labels({ ...proposed, size: 3 })).toEqual([
      "accept stack",
      "squash to one",
    ])
    expect(labels({ ...proposed, size: 3, stale: true })).toEqual([
      "redo the split",
      "accept stack and the rest",
    ])
    expect(
      words({ ...proposed, size: 3, stale: true }).buttons.find(
        b => b.button === "split",
      )?.title,
    ).toBe(
      "replaces the stack of 3: splits all of this thread's work, the changes since included",
    )
    expect(labels({ ...proposed, edited: true })).toEqual([
      "accept changes",
      "refresh (loses your edits)",
    ])
    expect(words(proposed).menu.map(b => b.label)).toEqual([
      "rewrite description",
      "get the latest",
    ])
  })
  const MOVE = {
    base: { kind: "accepted" },
    bookmark: "pinetrie-accepted",
    from: pointId("a"),
    to: pointId("b"),
  } as const
  test("an accepted strip says so, its change id in the line's title alone", () => {
    const w = words({ ...proposed, acceptedAs: "zz12345678ab" })
    expect(w.line).toBe("accepted ✓")
    expect(w.lineTitle).toBe("change id zz12345678ab")
    expect(words(proposed).lineTitle).toBeNull()
  })

  test("the jj facts are titles: which bookmark an acceptance moves, and what catching up merges, by the base's name", () => {
    const w = words(proposed, "idle", ACCEPTED_BASE, {
      getLatest: { kind: "unknown" },
    })
    expect(w.buttons[0]?.title).toBe(
      "moves pinetrie-accepted forward to pinetrie-proposed/amber-fox",
    )
    expect(w.menu.find(b => b.button === "update")?.title).toBe(
      "merges accepted work into this thread's copy",
    )
    expect(words(proposed, "idle", UNFINISHED_BASE).buttons[0]?.title).toBe(
      "moves wip/search forward to pinetrie-proposed/amber-fox",
    )
  })
  const folderWords = (conflicts: readonly string[]) =>
    workStripWords(
      workStripView({
        proposed: proposedChangesStatus({
          kind: "folder",
          lane: threadIdFor("1"),
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
        into: { kind: "folder" },
        unfinishedAhead: 0,
        getLatest: { kind: "unknown" },
        untraced: false,
        queued: [],
        parent: null,
        parentRunning: false,
      }),
      null,
    )
  test("folder proposed changes' accept writes into the project's folder, no bookmark moved", () => {
    const accept = folderWords([]).buttons.find(b => b.button === "accept")
    expect(accept).toMatchObject({
      title: "writes these files into the project's folder",
    })
    expect(accept?.disabled).toBeUndefined()
  })
  test("conflicted folder proposed changes offer catching up, and no accept", () => {
    const w = folderWords(["a.txt"])
    expect(w.line).toBe("conflicts with accepted work in 1 file")
    expect(w.buttons.find(b => b.button === "accept")).toBeUndefined()
    expect(w.buttons.find(b => b.button === "update")?.title).toBe(
      "merges accepted work into this thread's copy",
    )
  })
  const brings = {
    getLatest: { kind: "brings", move: MOVE, files: 3 },
  } as const
  test("behind its base, the strip says so and offers catching up beside the proposed changes", () => {
    const behind = words(proposed, "idle", ACCEPTED_BASE, brings)
    expect(behind.line).toBe("2 files changed · accepted work has moved on")
    expect(behind.buttons.find(b => b.button === "update")).toEqual({
      button: "update",
      label: "get the latest",
      title: "merges accepted work into this thread's copy · changes 3 files",
    })
    expect(words(undefined, "idle", ACCEPTED_BASE, brings).line).toBe(
      "accepted work has moved on since this thread started",
    )
    expect(words(undefined, "idle", UNFINISHED_BASE, brings).line).toBe(
      "wip/search has moved on since this thread started",
    )
  })
  test("catching up that would change nothing is disabled, and says why; one not yet read is not", () => {
    const update = (getLatest: LatestNow) =>
      words(proposed, "idle", ACCEPTED_BASE, { getLatest }).menu.find(
        b => b.button === "update",
      )
    expect(update({ kind: "current" })).toEqual({
      button: "update",
      label: "get the latest",
      title: "already has the latest from accepted work",
      disabled: true,
    })
    expect(update({ kind: "nothing-new" })).toEqual({
      button: "update",
      label: "get the latest",
      title:
        "what's new in accepted work is this thread's own: getting it changes no file",
      disabled: true,
    })
    expect(update({ kind: "unknown" })).toEqual({
      button: "update",
      label: "get the latest",
      title: "merges accepted work into this thread's copy",
    })
    // Nothing new is no "new work" either.
    expect(
      words(proposed, "idle", ACCEPTED_BASE, {
        getLatest: { kind: "nothing-new" },
      }).line,
    ).toBe("2 files changed")
  })
  test("an untraced thread says why nothing is offered, and offers catching up", () => {
    const w = words(undefined, "idle", ACCEPTED_BASE, { untraced: true })
    expect(w.line).toBe(
      "an earlier accept of this thread can't be traced: get the latest from accepted work to show what's new",
    )
    expect(w.buttons.map(b => [b.label, b.disabled])).toEqual([
      ["get the latest", undefined],
    ])
  })
  test("a queued catch-up is the proposed changes' activity: the strip says it is catching up", () => {
    expect(
      words(proposed, "idle", ACCEPTED_BASE, { queued: ["get-latest"] }).line,
    ).toBe("getting the latest work…")
  })
  test("only clean proposed changes land on accepted work; on a WIP, a conflicted one is added anyway", () => {
    const conflicted = { ...proposed, conflicts: ["a.txt"] }
    expect(words(conflicted).buttons.map(b => b.label)).toEqual([
      "get the latest and resolve",
    ])
    expect(
      words(conflicted, "idle", UNFINISHED_BASE).buttons.map(b => b.label),
    ).toEqual(["get the latest and resolve", "accept anyway into wip/search"])
    expect(
      words(conflicted, "idle", UNFINISHED_BASE).menu.map(b => b.label),
    ).not.toContain("accept, with your 2 commits beneath it")
  })
  test("a conflict that came with the copy says so, and names the thread that resolved it", () => {
    const parent: ParentNow = {
      kind: "parent",
      lane: B,
      name: "copper-owl" as ThreadName,
      newest: pointId("p2"),
      upToDateWith: pointId("p1"),
      conflicts: [],
    }
    const fromStart = {
      ...proposed,
      conflicts: ["a.txt"],
      startConflicts: ["a.txt"],
    }
    const resolved = words(fromStart, "idle", ACCEPTED_BASE, { parent })
    expect(resolved.line).toBe(
      "began from a copy with an unresolved conflict in 1 file · copper-owl has resolved it",
    )
    expect(resolved.buttons.map(b => b.label)).toEqual([
      "get copper-owl's latest",
    ])
    const unresolved = words(fromStart, "idle", ACCEPTED_BASE, {
      parent: { ...parent, conflicts: ["a.txt"] },
    })
    expect(unresolved.line).toBe(
      "began from a copy with an unresolved conflict in 1 file",
    )
    expect(unresolved.buttons.map(b => b.label)).toEqual([
      "get the latest and resolve",
    ])
    const running = words(proposed, "idle", ACCEPTED_BASE, {
      parent,
      parentRunning: true,
    }).menu.find(b => b.button === "get-latest-from-parent")
    expect(running).toMatchObject({
      label: "get copper-owl's latest",
      disabled: true,
      title: "copper-owl is working: get its latest when its run ends",
    })
  })
  test("a WIP thread adds to its WIP, and offers the project with its commits", () => {
    const w = words(proposed, "idle", UNFINISHED_BASE)
    expect(w.buttons[0]?.label).toBe("accept changes into wip/search")
    expect(w.menu.map(b => b.label)).toEqual([
      "rewrite description",
      "get the latest",
      "accept, with 2 of your own changes",
    ])
  })
  const sent = (
    action: ProposedChangesActing["action"],
    to: string | null = null,
  ): ProposedChangesActing => ({ kind: "sent", id: "s1", action, to })
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
      UNFINISHED_BASE,
      sent("accept"),
      "accepting into wip/search…",
    ],
    [
      "an acceptance from a WIP into accepted work",
      UNFINISHED_BASE,
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
    expect(words(proposed, "idle", base, {}, acting).note).toBe(note)
  })
  test("a WIP gone without landing offers no acceptance, and continuing from the project", () => {
    const w = words(proposed, "idle", { ...UNFINISHED_BASE, state: "gone" })
    expect(w.buttons.map(b => b.label)).toEqual(["split into a stack"])
    expect(w.menu.map(b => b.label)).toEqual([
      "rewrite description",
      "continue from the latest work",
    ])
  })
})

describe("identityWords", () => {
  test.each<[Parameters<typeof identityWords>[0], string]>([
    [
      {
        kind: "agent",
        name: "amber-fox" as ThreadName,
        icon: null,
      },
      "amber-fox",
    ],
    [{ kind: "pending" }, "new agent"],
    [{ kind: "none" }, "chat"],
  ])("%o", (identity, words) => {
    expect(identityWords(identity)).toBe(words)
  })
})

describe("handleTitle", () => {
  test.each([
    [30, "started by Ada · just now"],
    [3 * 3600, "started by Ada · 3 h ago"],
  ])("%d s ago: %s", (seconds, words) => {
    expect(
      handleTitle(
        { started: { by: "Ada", at: 0 }, start: null },
        null,
        null,
        seconds * 1000,
      ),
    ).toBe(words)
  })
  test("who started it, then its base, then the agents line; none with nothing to say", () => {
    expect(
      handleTitle(
        { started: { by: "Ada", at: 0 }, start: null },
        "started from your unfinished work: wip/search",
        "with amber-fox",
        30_000,
      ),
    ).toBe(
      "started by Ada · just now\nstarted from your unfinished work: wip/search\nwith amber-fox",
    )
    expect(handleTitle(null, null, null, 0)).toBeNull()
  })
})

describe("where the agent read pinned cards", () => {
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
    const index = indexEntries([
      entry("1-q", null, said("q")),
      entry("2-k", "1-q", pinned(read(A, [card(cardIdFor("c1"), "a")]))),
      entry("3-p", "2-k", said("p", true)),
      entry("4-r", "3-p", { role: "assistant", content: "r" }),
      entry("5-p", "4-r", said("again", true)),
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

  test("promptParent: an edit sends again from above the lane's prompt its run wrote", () => {
    const index = indexEntries([
      entry("1-q", null, said("q")),
      entry("2-r", "1-q", { role: "assistant", content: "r" }),
      entry("3-s", "2-r", { role: "system", content: "" }),
      entry("4-c", "3-s", {
        role: "canvas",
        content: "",
        canvas: { canvas: canvasIdFor("c"), title: "c", lines: [], more: 0 },
      }),
      entry("5-p", "4-c", said("again", true)),
    ])
    expect(promptParent(index, entryId("5-p"))).toBe("2-r")
  })

  test("pinnedMarkers: a run's canvas pins and canvas list, above its prompt, mark it too", () => {
    const K = canvasIdFor("k")
    const canvas = { canvas: K, title: "T", lines: ["thread a"], more: 0 }
    const canvasCards = [card(cardIdFor("c2"), "all")]
    const index = indexEntries([
      entry("1-q", null, said("q")),
      entry("2-c", "1-q", { role: "canvas", content: "", canvas }),
      entry("3-t", "2-c", {
        role: "canvas-pinned",
        content: "",
        canvasPinned: { canvas: K, cards: canvasCards, retired: [] },
      }),
      entry("4-p", "3-t", said("p", true)),
      entry("5-r", "4-p", { role: "assistant", content: "r" }),
      // A canvas list alone, then a prompt: marked; the reply is not.
      entry("6-c", "5-r", { role: "canvas", content: "", canvas }),
      entry("7-p", "6-c", said("again", true)),
    ])
    const nodes = ["4-p", "5-r", "7-p"].map(id => ({ id: entryId(id) }))
    expect([...pinnedMarkers(index, nodes)]).toEqual([
      [
        entryId("4-p"),
        {
          cards: [],
          retired: [],
          canvasPinned: { cards: canvasCards, retired: [] },
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
      "the agent was told the canvas: 1 card",
    )
    expect(canvasPinnedMarkerWords({ cards: canvasCards, retired: [] })).toBe(
      "the agent read 1 card pinned to the canvas",
    )
  })
})

test("pinnedStatus: read, changed or unread against what the agent reads", () => {
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
  expect(textTokens("12345")).toBe(2)
})

test.each([
  [
    {
      canPin: true,
      pinning: false,
      pinned: 0,
    },
    "menu",
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
] as const)("newPinPlace(%o): %s", (facts, want) => {
  expect(newPinPlace(facts)).toBe(want)
})
