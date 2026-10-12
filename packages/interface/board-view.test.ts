import {
  type CardRecord,
  entryId,
  type RootWork,
  type TaskId,
  taskIdFor,
  threadIdFor,
  type Workflow,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { taskCard } from "@pinetrie/core/fixtures"
import { boardOf, orderKeys } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Status } from "./attention.ts"
import {
  ARCHIVE_RECENT,
  addStateIntent,
  archiveRows,
  type BoardKeyFocus,
  type BoardSearch,
  type BoardViewInput,
  boardKeyAct,
  boardView,
  clickClosesBoard,
  filterTitle,
  filterWords,
  keptWords,
  nameStateIntent,
  parseSearch,
  readyWords,
  removeWords,
  searchedText,
  searchWords,
  stateWords,
  tasksWords,
} from "./board-view.ts"
import type { KeyLike } from "./page-keys.ts"
import type { TaskSummary } from "./root-label.ts"
import { threadCardHeads } from "./thread-card.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const [BACKLOG, DOING, DONE] = ["b", "d", "x"].map(workflowStateIdFor) as [
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
]
const WORKFLOW: Workflow = {
  open: [
    { id: BACKLOG, name: "Backlog" },
    { id: DOING, name: "Doing" },
  ],
  archive: { id: DONE, name: "Done" },
}
/** Task `n`, holding task `n`'s threads. */
const ID = (n: number) =>
  taskIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
/** Task `n` as the facts and the expectations name it. */
const E = ID
const keys = orderKeys(4)
const place = (n: number, state: typeof DOING, rank = 0): CardRecord =>
  taskCard(ID(n), keys[rank] ?? "", state, ADA)
const summary = (
  n: number,
  writers: WriterId[],
  newest: string,
  line = "",
): readonly [TaskId, TaskSummary] => [
  E(n),
  { line, writers, newest: entryId(newest) },
]
// r1, r2 in Doing (r2 first); r3 in Backlog; r4, r5 in Done (r5 newer).
/** What the board is read from, its thread cards' facts among them. */
type Facts = Omit<BoardViewInput, "heads"> & {
  readonly labels: ReadonlyMap<TaskId, string>
  readonly status: ReadonlyMap<TaskId, Status>
  readonly cardRoots: ReadonlySet<TaskId>
  readonly ready: ReadonlyMap<TaskId, readonly string[]>
  readonly work: ReadonlyMap<TaskId, RootWork>
}
const input = (over: Partial<Facts> = {}): BoardViewInput => {
  const f: Facts = {
    workflow: WORKFLOW,
    cards: [
      place(1, DOING, 1),
      place(2, DOING, 0),
      place(3, BACKLOG),
      place(4, DONE),
      place(5, DONE, 1),
    ],
    summaries: new Map([
      summary(1, [ADA], "1"),
      summary(2, [BEA], "2"),
      summary(3, [ADA], "3"),
      summary(4, [ADA], "4"),
      summary(5, [BEA], "5", "can we try warmer colours?"),
    ]),
    labels: new Map([
      [E(4), "Old spike about SQLite"],
      [E(5), "Palette work"],
    ]),
    status: new Map(),
    cardRoots: new Set(),
    ready: new Map(),
    search: null,
    me: ADA,
    work: new Map(),
    ...over,
  }
  const board = boardOf(f.workflow, f.cards)
  return {
    workflow: f.workflow,
    cards: f.cards,
    summaries: f.summaries,
    search: f.search,
    me: f.me,
    heads: threadCardHeads(f.summaries.keys(), {
      workflow: f.workflow,
      stateOf: board.stateOf,
      labels: f.labels,
      status: f.status,
      pips: f.cardRoots,
      offered: f.ready,
      work: f.work,
    }),
  }
}

describe("boardView", () => {
  test("each open state a column, in order, by rank; the archive apart; the strip says each", () => {
    const view = boardView(input())
    expect(
      view.open.map(c => [c.state.name, c.items.map(t => t.task)]),
    ).toEqual([
      ["Backlog", [E(3)]],
      ["Doing", [E(2), E(1)]],
    ])
    expect(view.archive.count).toEqual({ kind: "all", total: 2 })
    expect(view.strip.map(s => [s.name, s.count, s.archive])).toEqual([
      ["Backlog", 1, false],
      ["Doing", 2, false],
      ["Done", 2, true],
    ])
  })

  test("a task with no message yet is on no column: a new tab's joins with its first send", () => {
    const view = boardView(
      input({ cards: [...input().cards, place(6, BACKLOG, 1)] }),
    )
    expect(view.open[0]?.items.map(t => t.task)).toEqual([E(3)])
  })

  test("a titled card's body is its first line; an untitled card, or one titled by it, has none", () => {
    const done = boardView(input()).archive.rows
    expect(done.map(t => [t.label, t.body])).toEqual([
      ["Palette work", "can we try warmer colours?"],
      ["Old spike about SQLite", null],
    ])
  })

  test("an item holds your card exactly when its task does; ＋ on a column lands in its state", () => {
    const view = boardView(input({ cardRoots: new Set([E(1)]) }))
    const doing = view.open[1]
    expect(doing?.items.map(t => t.pip)).toEqual([false, true])
    expect(doing?.add.agent).toEqual({
      kind: "newTab",
      asksAgent: true,
      state: DOING,
    })
  })

  test("a column's mark and the strip's are its tasks' highest; the archive has none", () => {
    const item = {
      lane: threadIdFor("a"),
      end: entryId("e-1"),
      level: "needsYou" as const,
      raised: { kind: "offer" as const, source: "c" },
    }
    const status = new Map<TaskId, Status>([
      [E(1), { kind: "needsYou", item }],
      [E(3), { kind: "working" }],
      [E(4), { kind: "needsYou", item }],
    ])
    const view = boardView(input({ status }))
    expect(view.open.map(c => c.mark)).toEqual([null, "needsYou"])
    expect(view.strip.map(s => s.mark)).toEqual([null, "needsYou", null])
  })

  test("a column counts its items working and ready, not threads; an item's ⇡ names its threads", () => {
    const status = new Map<TaskId, Status>([
      [E(1), { kind: "working" }],
      [E(3), { kind: "working" }],
      [E(4), { kind: "working" }],
    ])
    const ready = new Map([
      [E(1), ["amber-fox", "cozy-mallard"]],
      [E(4), ["quiet-owl"]],
    ])
    const view = boardView(input({ status, ready }))
    expect(view.open[1]?.items.map(t => t.ready)).toEqual([
      [],
      ["amber-fox", "cozy-mallard"],
    ])
    expect(view.open.map(c => [c.signals.working, c.signals.ready])).toEqual([
      [1, 0],
      [1, 1],
    ])
    expect(view.strip.map(s => [s.signals.working, s.signals.ready])).toEqual([
      [1, 0],
      [1, 1],
      [0, 0],
    ])
  })

  test("stateWords and readyWords: what a state's ◌ and ⇡ and an item's ⇡ say", () => {
    expect(stateWords({ working: 1, ready: 2 })).toEqual({
      working: "the agent is working in 1 task",
      ready: "2 tasks with work ready to accept",
    })
    expect(readyWords(["amber-fox", "cozy-mallard"])).toBe(
      "ready to accept: amber-fox, cozy-mallard",
    )
  })

  test("an item's ⋯ moves it to every other state; into the archive, refused while its agent works", () => {
    const view = boardView(input({ work: new Map([[E(2), "running"]]) }))
    const [first] = view.open[1]?.items ?? []
    expect(first?.moves.map(m => [m.name, m.closes, m.busy])).toEqual([
      ["Backlog", false, null],
      ["Done", true, "running"],
    ])
    expect(first?.moves[1]?.intent).toEqual({
      kind: "moveTask",
      task: ID(2),
      from: DOING,
      to: DONE,
      before: null,
      closes: true,
    })
  })

  test("an item moves up or down its state, by Move up and Move down; the ends offer neither", () => {
    const [first, second] = boardView(input()).open[1]?.items ?? []
    expect(first?.up).toBeNull()
    expect(first?.down).toEqual({
      kind: "moveTask",
      task: ID(2),
      from: DOING,
      to: DOING,
      before: null,
      closes: false,
    })
    expect(second?.up).toEqual({
      kind: "moveTask",
      task: ID(1),
      from: DOING,
      to: DOING,
      before: ID(2),
      closes: false,
    })
    expect(second?.down).toBeNull()
  })

  test("a column moves one place either way, and says why it cannot be removed", () => {
    const [backlog, doing] = boardView(input()).open
    expect(backlog?.left).toBeNull()
    expect(backlog?.right).toEqual({
      kind: "editWorkflow",
      edit: { action: "move", state: BACKLOG, name: "", before: null },
    })
    expect(doing?.left).toEqual({
      kind: "editWorkflow",
      edit: { action: "move", state: DOING, name: "", before: BACKLOG },
    })
    expect(doing?.right).toBeNull()
    expect(backlog?.addBefore).toEqual({ left: BACKLOG, right: DOING })
    expect(doing?.addBefore).toEqual({ left: DOING, right: null })
    expect(backlog?.remove.why).toBe("holds a task: move it first")
    expect(removeWords(0, 1)).toBe("the board needs one open state")
    expect(removeWords(0, 2)).toBeNull()
    expect(removeWords(3, 2)).toBe("holds 3 tasks: move them first")
  })
})

test("clickClosesBoard: a click pressed and let go outside the board and its strip closes it", () => {
  expect(clickClosesBoard("elsewhere", "elsewhere")).toBe(true)
  expect(clickClosesBoard("board", "board")).toBe(false)
  expect(clickClosesBoard("strip", "strip")).toBe(false)
  // A selection begun in the board and let go outside it.
  expect(clickClosesBoard("board", "elsewhere")).toBe(false)
  expect(clickClosesBoard("elsewhere", "board")).toBe(false)
  expect(clickClosesBoard(null, "elsewhere")).toBe(false)
})

describe("the board's search", () => {
  const labels = new Map([
    [E(1), "Board search design"],
    [E(2), "Palette work"],
    [E(3), "Search the backlog"],
    [E(4), "Old spike about SQLite"],
    [E(5), "Palette search"],
  ])
  const kept = (over: Partial<BoardViewInput>) => {
    const view = boardView(input({ labels, ...over }))
    return [
      ...view.open.map(c => c.items.map(t => t.task)),
      view.archive.rows.map(t => t.task),
    ]
  }
  const find = (query: string, mine = false) => ({
    search: parseSearch(query, mine),
  })
  test("with none, every task shows, the archive's newest first, and every count is of all", () => {
    expect(kept({})).toEqual([[E(3)], [E(2), E(1)], [E(5), E(4)]])
    const view = boardView(input())
    expect(view.shown).toEqual({ kind: "all", total: 5 })
    expect(view.open.map(c => c.count.kind)).toEqual(["all", "all"])
  })
  test("it keeps the tasks whose label holds every word, in any order and case", () => {
    expect(kept(find("SEARCH"))).toEqual([[E(3)], [E(1)], [E(5)]])
    expect(kept(find(" design  board "))).toEqual([[], [E(1)], []])
    expect(kept(find("board nothing"))).toEqual([[], [], []])
    expect(kept(find("sqlite"))).toEqual([[], [], [E(4)]])
  })
  test("mine keeps the tasks you wrote in, in every state", () => {
    expect(kept(find("", true))).toEqual([[E(3)], [E(1)], [E(4)]])
    expect(kept({ ...find("", true), me: BEA })).toEqual([[], [E(2)], [E(5)]])
    expect(kept(find("palette", true))).toEqual([[], [], []])
  })
  test("a filtered head counts what it shows; its mark, Remove and the strip count every task", () => {
    const status = new Map<TaskId, Status>([
      [E(1), { kind: "working" }],
      [E(2), { kind: "working" }],
    ])
    const ready = new Map([[E(2), ["amber-fox"]]])
    const item = {
      lane: threadIdFor("a"),
      end: entryId("e-2"),
      level: "needsYou" as const,
      raised: { kind: "offer" as const, source: "c" },
    }
    status.set(E(2), { kind: "needsYou", item })
    const view = boardView(input({ labels, status, ready, ...find("board") }))
    const doing = view.open[1]
    expect(view.shown).toEqual({
      kind: "filtered",
      search: { words: ["board"], mine: false },
      kept: 1,
      total: 5,
    })
    expect(doing?.items.map(t => t.task)).toEqual([E(1)])
    expect(doing?.count).toEqual({ kind: "kept", kept: 1, total: 2 })
    expect(doing?.signals).toEqual({ working: 1, ready: 0, tasks: [E(1)] })
    expect(doing?.mark).toBe("needsYou")
    expect(doing?.remove.why).not.toBeNull()
    expect(view.open[0]?.items).toEqual([])
    expect(view.open[0]?.remove.why).not.toBeNull()
    expect(view.archive.count).toEqual({ kind: "kept", kept: 0, total: 2 })
    expect(
      view.strip.map(s => [s.count, s.signals.ready, s.signals.tasks.length]),
    ).toEqual([
      [1, 0, 1],
      [2, 1, 2],
      [2, 0, 0],
    ])
  })
  test("Move up and Move down step among the items shown, and only shown tasks have cards", () => {
    const view = boardView(input({ labels, ...find("board") }))
    const [only, ...rest] = view.open[1]?.items ?? []
    expect([only?.up, only?.down, rest]).toEqual([null, null, []])
  })
  test("with no words, the archive shows only its most recent few, mine alone included", () => {
    const item = (n: number) =>
      ({
        ...boardView(input()).archive.rows[0],
        task: ID(n),
        label: `r${n}`,
        writers: [],
      }) as never
    const many = Array.from({ length: ARCHIVE_RECENT + 3 }, (_, n) => item(n))
    const summaries = new Map()
    const rows = (search: BoardSearch | null) =>
      archiveRows({ items: many, summaries, search }).length
    expect(rows(null)).toBe(ARCHIVE_RECENT)
    expect(rows(parseSearch("", true))).toBe(ARCHIVE_RECENT)
    expect(rows(parseSearch("r", false))).toBe(ARCHIVE_RECENT + 3)
  })
})

describe("parseSearch", () => {
  test.each([
    ["", false, null],
    ["   ", false, null],
    ["  Board  search ", false, { words: ["board", "search"], mine: false }],
    ["", true, { words: [], mine: true }],
  ] as const)("%j, mine %s", (query, mine, search) => {
    expect(parseSearch(query, mine)).toEqual(search)
  })
})

describe("boardKeyAct", () => {
  const key = (k: string, mod: Partial<KeyLike> = {}): KeyLike => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mod,
  })
  const at = (over: Partial<BoardKeyFocus> = {}): BoardKeyFocus => ({
    menuOpen: false,
    filtered: false,
    inText: false,
    ...over,
  })
  test.each([
    [
      "Escape with a menu open is the menu's",
      key("Escape"),
      at({ menuOpen: true, filtered: true }),
      null,
    ],
    [
      "Escape clears a filter, in the search field too",
      key("Escape"),
      at({ filtered: true, inText: true }),
      "clearFilter",
    ],
    ["Escape with no filter closes the board", key("Escape"), at(), "close"],
    ["/ focuses the search", key("/"), at(), "focusSearch"],
    ["/ in a text box is typed", key("/"), at({ inText: true }), null],
    ["Ctrl+/ is not the board's", key("/", { ctrlKey: true }), at(), null],
    ["Cmd+/ is not the board's", key("/", { metaKey: true }), at(), null],
    ["Alt+/ is not the board's", key("/", { altKey: true }), at(), null],
    ["another key is not the board's", key("s"), at(), null],
  ] as const)("%s", (_, event, focus, act) => {
    expect(boardKeyAct(event, focus)).toBe(act)
  })
})

describe("board words", () => {
  const filtered = (
    words: string[],
    mine: boolean,
    kept: number,
    total: number,
  ) => ({ kind: "filtered" as const, search: { words, mine }, kept, total })
  // Named by the words, so a mutant that changes them fails its own test.
  const said: readonly (readonly [string, string])[] = [
    [tasksWords(1), "1 task"],
    [tasksWords(41), "41 tasks"],
    [keptWords({ kind: "kept", kept: 12, total: 96 }), "12 of 96"],
    [keptWords({ kind: "kept", kept: 96, total: 96 }), "96 of 96"],
    [keptWords({ kind: "all", total: 96 }), "96"],
    [searchWords(1), "search 1 task…"],
    [searchWords(140), "search 140 tasks…"],
    [
      filterWords(filtered(["parser"], true, 14, 140)),
      'Filtered by "parser" and mine: 14 of 140 tasks',
    ],
    [
      filterWords(filtered(["parser", "plan"], false, 1, 140)),
      'Filtered by "parser plan": 1 of 140 tasks',
    ],
    [
      filterWords(filtered([], true, 3, 140)),
      "Filtered to tasks you wrote in: 3 of 140 tasks",
    ],
    [
      filterWords(filtered(["parser"], false, 0, 140)),
      'No tasks match "parser"',
    ],
    [
      filterWords(filtered(["parser"], true, 0, 140)),
      'No tasks you wrote in match "parser"',
    ],
    [filterWords(filtered([], true, 0, 1)), "You wrote in none of 1 task"],
    [
      filterTitle({ words: ["parser"], mine: true }),
      'filtered: "parser", mine',
    ],
    [filterTitle({ words: [], mine: true }), "filtered: mine"],
  ]
  test.each(said.map(([was, words]) => [words, was]))("%s", (words, was) => {
    expect(was).toBe(words)
  })
})

test("nameStateIntent renames a state; addStateIntent adds one where it was asked for", () => {
  expect(nameStateIntent(DOING, "Now")).toEqual({
    kind: "editWorkflow",
    edit: { action: "rename", state: DOING, name: "Now", before: null },
  })
  expect(addStateIntent(DOING, "Review")).toEqual({
    kind: "editWorkflow",
    edit: { action: "add", state: null, name: "Review", before: DOING },
  })
  expect(addStateIntent(null, "Review")).toEqual({
    kind: "editWorkflow",
    edit: { action: "add", state: null, name: "Review", before: null },
  })
})

test("search reads a link to an address by its label, not its address", () => {
  const text = "see [the plan table](/a/b/t-1/e-1/table-0) now"
  expect(searchedText(text)).toBe("see the plan table now")
})
