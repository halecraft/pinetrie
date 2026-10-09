import {
  type CardId,
  entryId,
  indexTree,
  type LaneView,
  type TaskId,
  type TreeIndex,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { type CanvasCard, canvasOf } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { defaultView, type TaskView } from "./canvas-columns.ts"
import {
  entriesOf,
  entry,
  NEW_ROOT,
  NEW_TASK,
  NEW_THREAD,
  tasksFor,
  threadOfEntry,
  tree,
  withThreads,
} from "./fixtures.ts"
import {
  decodeLayout,
  encodeLayout,
  type Here,
  initialLayout,
  type Layout,
  type LayoutAction,
  layoutReducer,
  listOf,
  NOTHING,
  planOpen,
  resolveLayout,
  storedLayout,
  taskColumns,
  unlisted,
  type ViewChange,
} from "./layout.ts"

// Two roots: r1 -> a -> b, with a branch a -> c; and r2 -> d.
const parents = {
  "1-r1": null,
  "2-a": "1-r1",
  "3-b": "2-a",
  "4-c": "2-a",
  "5-r2": null,
  "6-d": "5-r2",
}
const index = tree(parents)
/**
 * Each root's task, one a root (ADR-0116): `7-r3` is the root a new tab's
 * first send writes, so its task is the one the tab minted.
 */
const TK = (root: string): TaskId =>
  root === "7-r3" ? NEW_TASK : taskIdFor(root)
const ROOTS = ["1-r1", "5-r2", "7-r3", "9-r", "9-x"]
/** Each task's threads on its canvas, in thread order (`tasksFor`). */
const tasksIn = (i: TreeIndex) =>
  tasksFor(i, ...ROOTS.map(r => [TK(r), entryId(r)] as const)).index
const TASKS = tasksIn(index)
const ADA = writerId("ada@x.io")
const R1: Here = { kind: "task", task: TK("1-r1") }
const R2: Here = { kind: "task", task: TK("5-r2") }
const TRUNK = threadOfEntry("1-r1")
const C = threadOfEntry("4-c")
const at = (l: Layout, here: Here = R1): Layout =>
  layoutReducer(l, { kind: "show", here })
/** The sidebar, as the session's document holds it, by root entry. */
const listed = (...roots: string[]) => roots.map(TK)
const resolve = (
  l: Layout,
  i = index,
  archived: ReadonlySet<TaskId> = new Set(),
  lanes: readonly LaneView[] = [],
  list: readonly TaskId[] = [],
  canvases = tasksIn(i).canvases,
) =>
  resolveLayout(l, {
    index: i,
    lanes,
    archived,
    list,
    canvases,
    forks: new Map(),
    holders: new Map(),
  })
const sync = (l: Layout, i = index) => resolve(l, i)
/** `l` drawn with `list` as the sidebar. */
const drawn = (l: Layout, list: readonly TaskId[]) =>
  resolve(l, index, new Set(), [], list)
const prune = (
  l: Layout,
  list: readonly TaskId[] = [],
  archived: ReadonlySet<TaskId> = new Set(),
  i = index,
  canvases = tasksIn(i).canvases,
) =>
  layoutReducer(l, {
    kind: "prune",
    index: i,
    lanes: [],
    archived,
    list,
    canvases,
    forks: new Map(),
    holders: new Map(),
    known: new Set(i.roots.map(r => TK(r))),
  })
/** A change to your view of `root`'s task, its first card the canvas's. */
const view = (root: string, change: ViewChange): LayoutAction => ({
  kind: "view",
  task: TK(root),
  first: TASKS.canvases.get(TK(root))?.[0]?.id ?? null,
  change,
})
const unfold = (card: CardId, root = "1-r1") =>
  view(root, { kind: "fold", card, unfolded: true })
/** The keys of `root`'s task's columns as drawn, each folded or not. */
const columnsOf = (l: Layout, root = "1-r1", i = index) =>
  taskColumns(l, TK(root), {
    canvases: tasksIn(i).canvases,
    forks: new Map(),
    holders: new Map(),
    index: i,
    lanes: [],
  }).map(c => [c.kind === "notes" ? c.card : c.column.key, c.folded])
const newTab = (l: Layout, asksAgent = false): Layout =>
  layoutReducer(l, {
    kind: "newTab",
    key: NEW_THREAD,
    task: NEW_TASK,
    root: NEW_ROOT,
    asksAgent,
  })
const NEW: Here = { kind: "new", key: NEW_THREAD }
/** `7-r3`, the first message of a new tab's thread, written; and its task's card. */
const written = (sends: Record<string, string> = { "7-r3": "s" }) => {
  const i = indexTree({
    ...indexTree(
      withThreads(
        entriesOf(
          Object.entries(parents).map(([id, parent]) =>
            entry(id, parent, { role: "chat", content: id }),
          ),
        ),
      ),
    ).entries,
    ...entriesOf([
      entry("7-r3", null, {
        role: "chat",
        content: "7-r3",
        starts: NEW_THREAD,
        ...(sends["7-r3"] === undefined ? {} : { sendId: sends["7-r3"] }),
      }),
    ]),
  })
  return { index: i, canvases: tasksIn(i).canvases }
}

describe("layoutReducer", () => {
  test("a view change changes only its task's view, which starts from the default", () => {
    const l = layoutReducer(at(initialLayout()), unfold(C))
    expect(columnsOf(l)).toEqual([
      [TRUNK, false],
      [C, false],
    ])
    expect(l.tasks.has(TK("5-r2"))).toBe(false)
    expect(columnsOf(l, "5-r2")).toEqual([[threadOfEntry("5-r2"), false]])
    const folded = layoutReducer(
      l,
      view("1-r1", { kind: "fold", card: TRUNK, unfolded: false }),
    )
    expect(columnsOf(folded)).toEqual([
      [TRUNK, true],
      [C, false],
    ])
    // Unfolding what is unfolded changes nothing.
    expect(layoutReducer(folded, unfold(C))).toBe(folded)
  })

  test("the task column starts folded, and folds apart from the cards", () => {
    const l = layoutReducer(
      initialLayout(),
      view("1-r1", { kind: "foldTask", unfolded: true }),
    )
    expect(l.tasks.get(TK("1-r1"))?.task).toEqual({ unfolded: true })
    expect(defaultView(null).task).toEqual({ unfolded: false })
  })

  test("a reader's settings are kept by card, folded or not (ADR-0106, ADR-0073)", () => {
    const l = layoutReducer(
      layoutReducer(
        initialLayout(),
        view("1-r1", { kind: "density", card: C, density: "outline" }),
      ),
      view("1-r1", { kind: "details", card: C, open: true }),
    )
    expect(l.tasks.get(TK("1-r1"))?.cards.get(C)).toEqual({
      density: "outline",
      details: true,
    })
    const closed = layoutReducer(
      l,
      view("1-r1", { kind: "details", card: C, open: false }),
    )
    expect(closed.tasks.get(TK("1-r1"))?.cards.get(C)).toEqual({
      density: "outline",
    })
  })

  test("a branch is yours until its card is on the canvas, then that card's column, unfolded", () => {
    const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const opened = layoutReducer(
      at(initialLayout()),
      view("1-r1", { kind: "openFresh", thread: T, at: entryId("3-b") }),
    )
    expect(columnsOf(opened)).toEqual([
      [TRUNK, false],
      [T, false],
      [C, true],
    ])
    const sent = layoutReducer(
      opened,
      view("1-r1", { kind: "sent", thread: T, sendId: "s" }),
    )
    expect(sent.tasks.get(TK("1-r1"))?.fresh.get(T)).toEqual({
      at: entryId("3-b"),
      sendId: "s",
    })
    // Its message is written, its card not yet: still drawn where it was.
    const grown = tree({ ...parents, "8-e": "3-b" }, { "8-e": "s" })
    expect(sync(sent, grown).tasks).toBe(sent.tasks)
    // Its card lands: the branch is that card's column.
    const card: CanvasCard = canvasOf(
      [
        {
          kind: "thread",
          id: T,
          owner: ADA,
          placer: ADA,
          place: { kind: "canvas", task: TK("1-r1"), order: "a0z", width: 1 },
        },
      ],
      TK("1-r1"),
    )[0] as CanvasCard
    const canvases = new Map(tasksIn(grown).canvases)
    canvases.set(TK("1-r1"), [...(canvases.get(TK("1-r1")) ?? []), card])
    const landed = resolve(sent, grown, new Set(), [], [], canvases)
    expect(landed.tasks.get(TK("1-r1"))?.fresh.size).toBe(0)
    expect(landed.tasks.get(TK("1-r1"))?.cards.get(T)).toEqual({
      unfolded: true,
    })
    const closed = layoutReducer(
      opened,
      view("1-r1", { kind: "closeFresh", thread: T }),
    )
    expect(columnsOf(closed)).toEqual(columnsOf(at(initialLayout())))
  })

  test("a branch holds its first message and its prefill until its first send, which spends both", () => {
    const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const pending = { text: "@agent separately?" }
    const prefill = { text: "@agent ", blank: true }
    const opened = layoutReducer(
      initialLayout(),
      view("1-r1", {
        kind: "openFresh",
        thread: T,
        at: entryId("3-b"),
        pending,
        prefill,
      }),
    )
    expect(opened.tasks.get(TK("1-r1"))?.fresh.get(T)).toEqual({
      at: entryId("3-b"),
      pending,
      prefill,
    })
    const sent = layoutReducer(
      opened,
      view("1-r1", { kind: "sent", thread: T, sendId: "s" }),
    )
    expect(sent.tasks.get(TK("1-r1"))?.fresh.get(T)).toEqual({
      at: entryId("3-b"),
      sendId: "s",
    })
  })

  test("a new tab, closed before it sends, leaves the layout as it was", () => {
    const before = drawn(at(initialLayout()), listed("1-r1"))
    const opened = newTab(before, true)
    expect(opened.active).toEqual(NEW)
    expect(opened.newTabs).toEqual([
      {
        key: NEW_THREAD,
        anchor: null,
        thread: NEW_THREAD,
        mode: { kind: "fresh", root: NEW_ROOT, task: NEW_TASK },
        asksAgent: true,
      },
    ])
    expect(
      layoutReducer(opened, { kind: "closeNewTab", key: NEW_THREAD }),
    ).toEqual(before)
  })

  test("a new tab can start with a prefill: a message's text, to send again", () => {
    const prefill = { text: "the first question", blank: false }
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: NEW_THREAD,
      task: NEW_TASK,
      root: NEW_ROOT,
      asksAgent: true,
      prefill,
    })
    expect(opened.newTabs[0]?.mode).toEqual({
      kind: "fresh",
      root: NEW_ROOT,
      task: NEW_TASK,
      prefill,
    })
  })

  test("a sent new tab becomes its task once its card is on the canvas, and stays the one you are on, in the sidebar", () => {
    const sent = layoutReducer(newTab(at(initialLayout())), {
      kind: "newTabColumn",
      key: NEW_THREAD,
      action: { kind: "sent", sendId: "s" },
    })
    expect(sync(sent)).toBe(sent)
    const w = written()
    // Its message is written, its card not yet: it stays a new tab.
    const early = resolve(sent, w.index, new Set(), [], [], new Map())
    expect(early.active).toEqual(NEW)
    expect(early.newTabs[0]?.anchor).toBe("7-r3")
    const synced = resolve(sent, w.index, new Set(), [], [], w.canvases)
    expect(synced.newTabs).toEqual([])
    expect(synced.active).toEqual({ kind: "task", task: NEW_TASK })
    // The session puts it in the sidebar as its send is answered; until then
    // it is drawn as the task you are on.
    expect(synced.open).toEqual([NEW_TASK])
    expect(synced.tasks.get(NEW_TASK)?.cards.get(NEW_THREAD)).toEqual({
      unfolded: true,
    })
  })

  test("a sent new tab you have left becomes its task, and you stay where you went", () => {
    const w = written()
    const left = at(newTab(at(initialLayout())), R1)
    const synced = resolve(left, w.index, new Set(), [], [], w.canvases)
    expect(synced.newTabs).toEqual([])
    expect(synced.active).toEqual(R1)
  })

  test("a new tab's column takes the reader's settings, and keeps them as it becomes its task's (ADR-0073)", () => {
    const shown = layoutReducer(newTab(at(initialLayout()), true), {
      kind: "newTabColumn",
      key: NEW_THREAD,
      action: { kind: "details", open: true },
    })
    expect(shown.newTabs[0]?.details).toBe(true)
    const w = written({})
    // Started from another browser tab: no send id here, only its thread's
    // first message.
    const synced = resolve(shown, w.index, new Set(), [], [], w.canvases)
    expect(synced.newTabs).toEqual([])
    expect(synced.tasks.get(NEW_TASK)?.cards.get(NEW_THREAD)).toEqual({
      unfolded: true,
      details: true,
    })
  })

  test("the sidebar is the facts', in its order, and the task you are on wherever it lacks it", () => {
    const l = at(initialLayout(), R2)
    expect(drawn(l, listed("1-r1", "5-r2")).open).toEqual([
      TK("1-r1"),
      TK("5-r2"),
    ])
    expect(drawn(l, listed("5-r2", "1-r1")).open).toEqual([
      TK("5-r2"),
      TK("1-r1"),
    ])
    // Another device's repair took it out: it stays on the screen you are on.
    expect(drawn(l, listed("1-r1")).open).toEqual([TK("1-r1"), TK("5-r2")])
    expect(drawn(at(l, NOTHING), listed("1-r1")).open).toEqual([TK("1-r1")])
  })

  test("a task that leaves the sidebar keeps your view of it, and opening it again brings it back", () => {
    const viewed = layoutReducer(at(initialLayout()), unfold(C))
    const closed = drawn(
      layoutReducer(viewed, { kind: "closeTask", task: TK("1-r1") }),
      [],
    )
    expect(columnsOf(at(closed))).toEqual(columnsOf(viewed))
  })

  test("closing the task you are on shows its neighbour below, else above, else nothing", () => {
    const list = listed("1-r1", "5-r2", "9-r")
    const middle = drawn(at(initialLayout(), R2), list)
    expect(
      layoutReducer(middle, { kind: "closeTask", task: TK("5-r2") }).active,
    ).toEqual({ kind: "task", task: TK("9-r") })
    const last = drawn(
      at(initialLayout(), { kind: "task", task: TK("9-r") }),
      list,
    )
    expect(
      layoutReducer(last, { kind: "closeTask", task: TK("9-r") }).active,
    ).toEqual(R2)
    const one = drawn(at(initialLayout()), listed("1-r1"))
    expect(
      layoutReducer(one, { kind: "closeTask", task: TK("1-r1") }).active,
    ).toEqual(NOTHING)
    // A tab you are not on closes without moving you.
    expect(
      layoutReducer(middle, { kind: "closeTask", task: TK("1-r1") }).active,
    ).toEqual(R2)
    // An unsent new tab, likewise: its neighbour.
    const withNew = newTab(drawn(at(initialLayout()), listed("1-r1")))
    expect(
      layoutReducer(withNew, { kind: "closeNewTab", key: NEW_THREAD }).active,
    ).toEqual(R1)
  })

  test("archived tasks leave the sidebar as drawn, except the one you are on until you leave it", () => {
    const list = listed("1-r1", "5-r2")
    const archived = new Set(list)
    const l = at(initialLayout(), R2)
    const forgotten = resolve(l, index, archived, [], list)
    expect(forgotten.open).toEqual([TK("5-r2")])
    expect(resolve(forgotten, index, archived, [], list)).toBe(forgotten)
    expect(
      resolve(at(forgotten, NOTHING), index, archived, [], list).open,
    ).toEqual([])
  })

  test("showing a task or a new tab closes the board; showing nothing keeps it", () => {
    const open = layoutReducer(at(initialLayout()), {
      kind: "board",
      open: true,
    })
    expect(open.board).toBe(true)
    expect(at(open, R2).board).toBe(false)
    expect(at(open, NOTHING).board).toBe(true)
    expect(newTab(open).board).toBe(false)
  })

  test("resolve is idempotent, and the stored state catches up to what it drew", () => {
    const l = newTab(at(initialLayout()))
    const w = written()
    const archived = new Set([TK("5-r2")])
    const list = listed("1-r1", "5-r2")
    const shown = resolve(l, w.index, archived, [], list, w.canvases)
    expect(resolve(shown, w.index, archived, [], list, w.canvases)).toBe(shown)
    const stored = layoutReducer(l, {
      kind: "resolve",
      index: w.index,
      lanes: [],
      archived,
      list,
      canvases: w.canvases,
      forks: new Map(),
      holders: new Map(),
    })
    expect(stored).toEqual(shown)
  })

  test("a column's anchor moves with its thread's end", () => {
    expect(
      taskColumns(initialLayout(), TK("1-r1"), {
        canvases: TASKS.canvases,
        forks: new Map(),
        holders: new Map(),
        index,
        lanes: [],
      })[0],
    ).toMatchObject({ column: { anchor: entryId("3-b") } })
    const replied = tree({ ...parents, "8-e": "3-b" })
    expect(
      taskColumns(initialLayout(), TK("1-r1"), {
        canvases: tasksIn(replied).canvases,
        forks: new Map(),
        holders: new Map(),
        index: replied,
        lanes: [],
      })[0],
    ).toMatchObject({ column: { anchor: entryId("8-e") } })
  })

  test("prune with nothing stored lands on nothing, with the board open: nothing opens a task by itself", () => {
    const pruned = prune(initialLayout())
    expect(pruned.active).toEqual(NOTHING)
    expect(pruned.board).toBe(true)
  })

  test("prune replaces a task you were on that is archived or gone with the last of the sidebar, and drops a gone task's view", () => {
    const onR1 = at(initialLayout())
    const archivedR1 = prune(
      onR1,
      listed("5-r2", "1-r1"),
      new Set([TK("1-r1")]),
    )
    expect(archivedR1.active).toEqual(R2)
    expect(archivedR1.board).toBe(false)
    const gone = layoutReducer(
      at(initialLayout(), { kind: "task", task: TK("9-x") }),
      view("9-x", { kind: "fold", card: C, unfolded: true }),
    )
    const pruned = prune(gone, listed("1-r1"))
    expect(pruned.tasks.has(TK("9-x"))).toBe(false)
    expect(pruned.active).toEqual(R1)
    expect(prune(gone).active).toEqual(NOTHING)
  })

  test("prune drops a branch whose fork is gone, where the task's roots are held; storing drops the view of a card no longer on the canvas", () => {
    const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const gone = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
    let l = at(initialLayout())
    for (const change of [
      { kind: "openFresh", thread: T, at: entryId("3-b") },
      { kind: "openFresh", thread: gone, at: entryId("9-gone") },
      { kind: "fold", card: threadIdFor("taken"), unfolded: true },
      { kind: "density", card: T, density: "raw" },
    ] as const)
      l = layoutReducer(l, view("1-r1", change))
    const pruned = prune(l, listed("1-r1"))
    const kept = pruned.tasks.get(TK("1-r1"))
    expect([...(kept?.fresh.keys() ?? [])]).toEqual([T])
    const stored = storedLayout(pruned, TASKS.canvases).tasks.get(TK("1-r1"))
    expect([...(stored?.cards.keys() ?? [])]).toEqual([TRUNK, T])
    // A canvas not arrived yet keeps every view.
    expect(storedLayout(pruned, new Map())).toBe(pruned)
    // A task whose roots this tab does not hold keeps its view as it is.
    const elsewhere = prune(
      l,
      listed("1-r1"),
      new Set(),
      index,
      new Map(),
    ).tasks.get(TK("1-r1"))
    expect(elsewhere).toBe(l.tasks.get(TK("1-r1")))
  })

  test("once chosen, what you are on stays when a task appears", () => {
    const grown = tree({ ...parents, "9-r3": null })
    for (const here of [R1, NOTHING]) {
      const settled = prune(at(initialLayout(), here), listed("1-r1"))
      expect(settled.active).toEqual(here)
      const later = prune(
        sync(settled, grown),
        listed("1-r1"),
        new Set(),
        grown,
      )
      expect(later.active).toEqual(here)
    }
  })
})

describe("listOf", () => {
  test("the sidebar as drawn, then new tabs", () => {
    const l = newTab(drawn(at(initialLayout()), listed("5-r2", "1-r1")))
    expect(listOf(l)).toEqual([R2, R1, NEW])
    expect(listOf(initialLayout())).toEqual([])
  })
})

test("unlisted: the tasks not in the sidebar, and not archived (ADR-0077, ADR-0122)", () => {
  const open = { open: [TK("1-r1")] }
  expect(
    unlisted(open, new Set([TK("7-r3")]), [TK("1-r1"), TK("5-r2"), TK("7-r3")]),
  ).toEqual([TK("5-r2")])
})

describe("planOpen", () => {
  const l = at(initialLayout())
  test("scrolls to a message an unfolded column already shows", () => {
    // The task's first column follows its thread, through 2-a to 3-b.
    expect(planOpen(l, index, entryId("2-a"), TASKS, [], new Map())).toEqual({
      kind: "scroll",
      task: TK("1-r1"),
      key: TRUNK,
    })
    expect(planOpen(l, index, entryId("6-d"), TASKS, [], new Map())).toEqual({
      kind: "scroll",
      task: TK("5-r2"),
      key: threadOfEntry("5-r2"),
    })
  })
  test("unfolds the column of a message's thread when no unfolded column shows it", () => {
    // 4-c is a branch at 2-a: another thread, its column folded.
    expect(planOpen(l, index, entryId("4-c"), TASKS, [], new Map())).toEqual({
      kind: "unfold",
      task: TK("1-r1"),
      card: C,
    })
    // The trunk folded, the branch's column shows the shared 2-a.
    const folded = layoutReducer(
      layoutReducer(l, unfold(C)),
      view("1-r1", { kind: "fold", card: TRUNK, unfolded: false }),
    )
    expect(
      planOpen(folded, index, entryId("2-a"), TASKS, [], new Map()),
    ).toEqual({
      kind: "scroll",
      task: TK("1-r1"),
      key: C,
    })
    expect(
      planOpen(folded, index, entryId("3-b"), TASKS, [], new Map()),
    ).toEqual({
      kind: "unfold",
      task: TK("1-r1"),
      card: TRUNK,
    })
  })
  test("an entry the index lacks, or one whose thread is in no task, has no plan", () => {
    expect(planOpen(l, index, entryId("nope"), TASKS, [], new Map())).toBeNull()
    expect(
      planOpen(
        l,
        index,
        entryId("4-c"),
        { taskOfThread: new Map(), canvases: new Map(), forkOf: new Map() },
        [],
        new Map(),
      ),
    ).toBeNull()
  })
})

describe("encodeLayout / decodeLayout", () => {
  const trip = (l: Layout) =>
    decodeLayout(JSON.parse(JSON.stringify(encodeLayout(l))))
  const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
  const VIEW: TaskView = {
    cards: new Map([
      [TRUNK, { unfolded: true, density: "outline" }],
      [C, { details: true }],
    ]),
    task: { unfolded: true },
    fresh: new Map([
      [
        F,
        {
          at: entryId("2-a"),
          sendId: "s-1",
          prefill: { text: "@agent ", blank: true },
        },
      ],
    ]),
  }

  test("a round trip keeps what you are on, each task's view, new tabs and the board; never the sidebar, which is your document's", () => {
    const l: Layout = {
      active: NEW,
      open: [],
      board: true,
      tasks: new Map([[TK("1-r1"), VIEW]]),
      newTabs: [
        {
          key: NEW_THREAD,
          anchor: null,
          thread: NEW_THREAD,
          asksAgent: true,
          density: "raw",
          mode: {
            kind: "fresh",
            root: NEW_ROOT,
            task: NEW_TASK,
            state: workflowStateIdFor("d"),
            prefill: { text: "say it again", blank: false },
          },
        },
      ],
    }
    expect(trip(l)).toEqual(l)
    expect(trip({ ...l, open: [TK("1-r1")] })?.open).toEqual([])
    expect(trip(initialLayout())).toEqual(initialLayout())
  })

  test("a message waiting to be sent is never stored, nor restored: it would be sent again", () => {
    const stored = encodeLayout({
      ...initialLayout(),
      tasks: new Map([
        [
          TK("1-r1"),
          {
            ...defaultView(null),
            fresh: new Map([
              [F, { at: entryId("2-a"), pending: { text: "hello" } }],
            ]),
          },
        ],
      ]),
    })
    expect(JSON.stringify(stored)).not.toContain("hello")
    // A new tab's column, likewise.
    const tab = encodeLayout({
      ...initialLayout(),
      newTabs: [
        {
          key: NEW_THREAD,
          anchor: null,
          thread: NEW_THREAD,
          mode: {
            kind: "fresh",
            root: NEW_ROOT,
            task: NEW_TASK,
            pending: { text: "hello" },
          },
        },
      ],
    })
    expect(JSON.stringify(tab)).not.toContain("hello")
    const raw = {
      ...stored,
      tasks: {
        [TK("1-r1")]: {
          cards: {},
          task: { unfolded: false },
          fresh: { [F]: { at: "2-a", pending: "hello" } },
        },
      },
    }
    expect(decodeLayout(raw)?.tasks.get(TK("1-r1"))?.fresh.get(F)).toEqual({
      at: entryId("2-a"),
    })
  })

  test("a layout that is another version, or partly malformed, restores nothing", () => {
    const good = encodeLayout({
      ...initialLayout(),
      tasks: new Map([[TK("1-r1"), VIEW]]),
    })
    const goodView = good.tasks[TK("1-r1")]
    expect(decodeLayout(good)).toBeDefined()
    for (const raw of [
      { v: 1, columns: [] },
      { v: 6, active: null, roots: {}, newTabs: [], board: false },
      // v7 kept a task's columns, in an order of this tab's (ADR-0116).
      {
        v: 7,
        active: null,
        tasks: { [TK("1-r1")]: [{ key: "a", anchor: "1-r1" }] },
        newTabs: [],
        board: false,
      },
      { ...good, v: 7 },
      // A view keyed by something that is no task.
      { ...good, tasks: { "1-r1": goodView } },
      // A card's view keyed by something that is no card.
      {
        ...good,
        tasks: { [TK("1-r1")]: { ...goodView, cards: { "not a card": {} } } },
      },
      // A branch keyed by something that is no thread.
      {
        ...good,
        tasks: {
          [TK("1-r1")]: {
            ...goodView,
            fresh: { "w-x": { at: "2-a" } },
          },
        },
      },
      // A view as a list: an order of this tab's.
      { ...good, tasks: { [TK("1-r1")]: [TRUNK, C] } },
      { ...good, active: { kind: "root", root: "1-r1" } },
      { ...good, newTabs: [{ key: "n", anchor: null }] },
      { v: 8, active: null, tasks: {}, newTabs: [] },
      "layout",
      null,
    ])
      expect(decodeLayout(raw)).toBeUndefined()
  })

  test("a new tab with no root or task of its own restores nothing (ADR-0066, ADR-0117, ADR-0116)", () => {
    const stored = (column: object) => ({
      ...encodeLayout(initialLayout()),
      newTabs: [column],
    })
    expect(
      decodeLayout(
        stored({
          key: NEW_THREAD,
          anchor: null,
          thread: NEW_THREAD,
          fresh: { root: NEW_ROOT, task: NEW_TASK },
        }),
      )?.newTabs[0]?.mode,
    ).toEqual({ kind: "fresh", root: NEW_ROOT, task: NEW_TASK })
    for (const column of [
      { key: "n", anchor: null, fresh: { root: NEW_ROOT, task: NEW_TASK } },
      { key: "n", anchor: null, thread: NEW_THREAD, fresh: {} },
      { key: "n", anchor: null, thread: NEW_THREAD, fresh: { root: "r-x" } },
      { key: "n", anchor: null, thread: NEW_THREAD, fresh: { root: NEW_ROOT } },
      {
        key: "n",
        anchor: null,
        thread: NEW_THREAD,
        fresh: { root: NEW_ROOT, task: "k-x" },
      },
    ])
      expect(decodeLayout(stored(column))).toBeUndefined()
  })
})
