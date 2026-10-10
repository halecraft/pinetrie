import {
  type AskIndex,
  atEntry,
  type CardId,
  type CardRecord,
  cardIdOfKind,
  type EntryId,
  entryId,
  INVENTORY_SLOTS,
  indexAsks,
  NO_CONTENT,
  rootIdFor,
  type TaskId,
  type TextCard,
  type TextPlace,
  type ThreadCard,
  taskIdFor,
  textCardId,
  threadIdFor,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { BOARD_SEARCH } from "./board-view.ts"
import type { ColumnKey } from "./columns.ts"
import type { CardFacts, Effect, IntentState } from "./effects.ts"
import {
  NEW_NOTE_COLUMN,
  NEW_ROOT,
  NEW_TASK,
  NEW_THREAD,
  tasksFor,
  threadOfEntry,
  tree,
} from "./fixtures.ts"
import {
  afterTaskMove,
  claimFocus,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import { threadLink } from "./thread-link.ts"

const _TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** Each root's task, by its root entry: the sidebar's key (ADR-0116). */
const R1_ID = taskIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const R2_ID = taskIdFor("01a0ffd2-0000-7000-8000-0000000000a2")
const R9_ID = taskIdFor("01a0ffd2-0000-7000-8000-0000000000a9")
const ROOT_IDS = new Map<EntryId, TaskId>([
  [entryId("1-r1"), R1_ID],
  [entryId("5-r2"), R2_ID],
  [entryId("8-r9"), R9_ID],
])
const TASK_OF = (root: string): TaskId => ROOT_IDS.get(entryId(root)) ?? R9_ID

// r1 -> a -> b, with a branch a -> c; and r2 -> d.
const index = tree({
  "1-r1": null,
  "2-a": "1-r1",
  "3-b": "2-a",
  "4-c": "2-a",
  "5-r2": null,
  "6-d": "5-r2",
})
const TASKS = tasksFor(index, ...[...ROOT_IDS].map(([e, t]) => [t, e] as const))
/** r1's threads: its trunk, through 3-b, and the branch at 2-a, 4-c. */
const TRUNK = threadOfEntry("1-r1")
const C = threadOfEntry("4-c")
/** A branch's thread, and its column's key, in r1's task. */
const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
/** On `root`'s tab, its first column unfolded (`defaultView`). */
const onRoot = (root: string): Layout =>
  resolveLayout(
    layoutReducer(initialLayout(), {
      kind: "show",
      here: { kind: "task", task: TASK_OF(root) },
    }),
    {
      index,
      lanes: [],
      archived: new Set(),
      list: [TASK_OF(root)],
      canvases: TASKS.index.canvases,
      unstarted: new Map(),
      holders: new Map(),
    },
  )
/** On no task. */
const onNothing: Layout = layoutReducer(initialLayout(), {
  kind: "show",
  here: { kind: "nothing" },
})
const at = (
  layout: Layout,
  asks: AskIndex = indexAsks(index),
  cards: CardFacts = NO_CARDS,
): IntentState => ({
  layout,
  index,
  asks,
  cards,
  tasks: TASKS,
  listWidth: "full",
  page: null,
  searching: false,
})
/** A root shown: the root you are on, and in the sidebar, at its end if it was not. */
const shown = (root: string, id: TaskId): Effect[] => [
  {
    kind: "layout",
    action: { kind: "show", here: { kind: "task", task: TASK_OF(root) } },
  },
  { kind: "list", act: { kind: "ensure", task: id } },
]
const ME = writerId("ada@x.io")
/** A thread whose card a link finds (ADR-0117). */
const LINKED = threadIdFor("linked")
const inventoryOf = (holder: WriterId): ThreadCard => ({
  kind: "thread",
  id: LINKED,
  owner: ME,
  placer: holder,
  place: { kind: "inventory", holder },
  content: NO_CONTENT,
})
/** A link to a thread on `task`'s canvas. */
const linkOn = (task: TaskId) =>
  threadLink(
    LINKED,
    [
      {
        ...inventoryOf(ME),
        place: { kind: "canvas", task, order: "1", width: 1 },
      },
    ],
    ME,
  )
const NO_CARDS: CardFacts = {
  cards: [],
  lanes: [],
  laneRecords: new Map(),
  me: ME,
  slots: {},
  selected: 0,
  filled: new Set(),
  composers: new Map(),
}
const R1 = at(onRoot("1-r1"))
const plan = (intent: Intent, state: IntentState = R1) =>
  planIntent(intent, state, {
    key: "k",
    root: NEW_ROOT,
    task: NEW_TASK,
    thread: NEW_THREAD,
    noteColumn: NEW_NOTE_COLUMN,
    reference: cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e1",
    ),
  })
/** The column keys these tests name: a branch's card's, a card's. */
const FRESH: ColumnKey = { kind: "card", card: F }
const CARD_C: ColumnKey = { kind: "card", card: C }
const column = (
  act: Extract<Intent, { kind: "column" }>["act"],
  key: ColumnKey = FRESH,
): Intent => ({ kind: "column", column: key, act })
/** A change to your view of r1's task, as an effect. */
const onR1 = (change: object): Effect =>
  ({
    kind: "layout",
    action: { kind: "view", task: R1_ID, first: TRUNK, change },
  }) as Effect

describe("planIntent", () => {
  test("× on a root closes it for you: it leaves the sidebar, and nothing shared is written", () => {
    expect(
      plan({ kind: "close", here: { kind: "task", task: TASK_OF("1-r1") } }),
    ).toEqual([
      { kind: "list", act: { kind: "close", task: R1_ID } },
      { kind: "layout", action: { kind: "closeTask", task: TASK_OF("1-r1") } },
    ])
  })

  test("× on nothing closes nothing", () => {
    expect(plan({ kind: "close", here: { kind: "nothing" } })).toEqual([])
  })

  test("showing a root opens it in the sidebar; reordering the sidebar places it by id (ADR-0122)", () => {
    expect(
      plan({ kind: "show", here: { kind: "task", task: TASK_OF("5-r2") } }),
    ).toEqual(shown("5-r2", R2_ID))
    expect(plan({ kind: "show", here: { kind: "nothing" } })).toEqual([
      { kind: "layout", action: { kind: "show", here: { kind: "nothing" } } },
    ])
    expect(
      plan({
        kind: "moveInList",
        task: TASK_OF("5-r2"),
        before: TASK_OF("1-r1"),
      }),
    ).toEqual([
      { kind: "list", act: { kind: "place", task: R2_ID, before: R1_ID } },
    ])
    expect(
      plan({ kind: "moveInList", task: TASK_OF("5-r2"), before: null }),
    ).toEqual([
      { kind: "list", act: { kind: "place", task: R2_ID, before: null } },
    ])
  })

  test("a move on the board asks the host; into the archive it closes the root for you once accepted (ADR-0122)", () => {
    const [from, to] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
    const move = (closes: boolean) =>
      plan({ kind: "moveTask", task: R1_ID, from, to, before: null, closes })
    const request = {
      kind: "move-task",
      task: R1_ID,
      from,
      to,
      before: null,
    } as const
    expect(move(false)).toEqual([
      { kind: "moveTask", move: request, moved: [] },
    ])
    expect(move(true)).toEqual([
      {
        kind: "moveTask",
        move: request,
        moved: [
          { kind: "list", act: { kind: "close", task: R1_ID } },
          {
            kind: "layout",
            action: { kind: "closeTask", task: TASK_OF("1-r1") },
          },
        ],
      },
    ])
  })

  test("a workflow edit is a request; the board opens and closes in the layout", () => {
    const edit = {
      action: "add",
      state: null,
      name: "Review",
      before: null,
    } as const
    expect(plan({ kind: "editWorkflow", edit })).toEqual([
      { kind: "request", intent: { kind: "workflow", edit } },
    ])
    expect(plan({ kind: "board", open: true, focus: false })).toEqual([
      { kind: "layout", action: { kind: "board", open: true } },
    ])
    expect(plan({ kind: "board", open: false })).toEqual([
      { kind: "layout", action: { kind: "board", open: false } },
    ])
  })

  test("a person's open of the board arms its search's focus first; the board's own open arms nothing", () => {
    expect(plan({ kind: "board", open: true, focus: true })).toEqual([
      { kind: "armFocus", key: BOARD_SEARCH },
      { kind: "layout", action: { kind: "board", open: true } },
    ])
  })

  test("branch here, after a conflict, opens a thread holding the text, which its column sends", () => {
    const pending = { text: "hi", card: textCardId("c") }
    expect(
      plan(column({ kind: "branchInstead", at: entryId("3-b"), pending })).at(
        -1,
      ),
    ).toEqual(onR1({ kind: "opened", card: NEW_THREAD, pending }))
  })

  test("a new tab from a first message's edit starts with its text", () => {
    const prefill = { text: "again", blank: false }
    expect(
      plan(column({ kind: "newTab", prefill, asksAgent: true })),
    ).toContainEqual({
      kind: "layout",
      action: {
        kind: "view",
        task: NEW_TASK,
        first: null,
        change: {
          kind: "opened",
          card: NEW_THREAD,
          prefill,
          asksAgent: true,
        },
      },
    })
  })

  test("＋ opens a new tab: its task and its thread written now, shown and in the sidebar, its column unfolded, taking focus (ADR-0126)", () => {
    expect(
      plan({ kind: "newTab", asksAgent: true, state: workflowStateIdFor("d") }),
    ).toEqual([
      {
        kind: "request",
        intent: {
          kind: "open-thread",
          thread: NEW_THREAD,
          root: NEW_ROOT,
          at: null,
          task: NEW_TASK,
          state: workflowStateIdFor("d"),
        },
      },
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "task", task: NEW_TASK } },
      },
      { kind: "list", act: { kind: "ensure", task: NEW_TASK } },
      {
        kind: "layout",
        action: {
          kind: "view",
          task: NEW_TASK,
          first: null,
          change: { kind: "opened", card: NEW_THREAD, asksAgent: true },
        },
      },
      { kind: "armFocus", key: NEW_THREAD },
    ])
  })

  test("a branch is opened on the host, just after its thread, its column unfolded with what it starts with, taking focus (ADR-0126)", () => {
    const at2 = entryId("2-a")
    expect(
      plan(
        column(
          {
            kind: "branch",
            branch: { at: at2, prefill: { text: "hi", blank: false } },
          },
          CARD_C,
        ),
      ),
    ).toEqual([
      { kind: "armFocus", key: NEW_THREAD },
      {
        kind: "request",
        intent: {
          kind: "open-thread",
          thread: NEW_THREAD,
          root: TEST_ROOT,
          at: at2,
          task: R1_ID,
          state: null,
        },
      },
      onR1({
        kind: "opened",
        card: NEW_THREAD,
        prefill: { text: "hi", blank: false },
      }),
    ])
    // Off a task, nothing.
    expect(
      plan(
        column(
          { kind: "branch", branch: { at: at2, prefill: undefined } },
          CARD_C,
        ),
        at(onNothing),
      ),
    ).toEqual([])
  })

  test("closing an unstarted thread's column: its card to your trash, your message there kept or trashed with it, in one move; a new tab's task, then empty, leaves the sidebar (ADR-0126)", () => {
    const thread: CardRecord = {
      kind: "thread",
      id: F,
      owner: ME,
      placer: ME,
      place: { kind: "canvas", task: R1_ID, order: "zz", width: 1 },
      content: NO_CONTENT,
    }
    const message: CardRecord = {
      kind: "text",
      id: textCardId("c"),
      owner: ME,
      placer: ME,
      place: { kind: "composing", thread: F },
      content: { command: null, unsent: null, origin: null },
    }
    const state = at(onRoot("1-r1"), undefined, {
      ...NO_CARDS,
      cards: [thread, message],
    })
    const away = {
      move: {
        card: F,
        from: { kind: "canvas", task: R1_ID },
        to: { kind: "trash" },
      },
      slot: null,
    }
    expect(
      plan({ kind: "closeUnstarted", card: F, keep: true }, state),
    ).toEqual([
      {
        kind: "keep",
        moves: [
          {
            move: {
              card: "c",
              from: { kind: "composing", thread: F },
              to: { kind: "inventory", holder: ME },
            },
            slot: 0,
          },
          away,
        ],
        actedAt: { kind: "column", key: F },
        close: [],
        here: R1_ID,
      },
    ])
    expect(
      plan({ kind: "closeUnstarted", card: F, keep: false }, state)[0],
    ).toMatchObject({
      moves: [{ move: { card: "c", to: { kind: "trash" } }, slot: null }, away],
    })
    // Alone on its task's canvas: a new tab's, whose task then leaves the sidebar.
    const alone = { ...thread, place: { ...thread.place, task: NEW_TASK } }
    const onTab = {
      ...at(onRoot("1-r1"), undefined, { ...NO_CARDS, cards: [alone] }),
      tasks: {
        ...TASKS,
        index: { ...TASKS.index, canvases: new Map([[NEW_TASK, [alone]]]) },
      },
    } as IntentState
    expect(
      plan({ kind: "closeUnstarted", card: F, keep: false }, onTab),
    ).toEqual([
      {
        kind: "keep",
        moves: [
          {
            move: {
              card: F,
              from: { kind: "canvas", task: NEW_TASK },
              to: { kind: "trash" },
            },
            slot: null,
          },
        ],
        actedAt: { kind: "column", key: F },
        close: [
          { kind: "list", act: { kind: "close", task: NEW_TASK } },
          { kind: "layout", action: { kind: "closeTask", task: NEW_TASK } },
        ],
        here: NEW_TASK,
      },
    ])
  })

  test("an unstarted thread's first send spends what it started with", () => {
    expect(plan({ kind: "sentFirst", card: F })).toEqual([
      onR1({ kind: "sent", card: F }),
    ])
  })

  test.each([
    [
      "density (ADR-0106)",
      { kind: "density", density: "outline" },
      { kind: "density", card: C, density: "outline" },
    ],
    [
      "details (ADR-0073)",
      { kind: "details", open: true },
      { kind: "details", card: C, open: true },
    ],
  ] as const)("a column's %s is your view of its card", (_, act, change) => {
    expect(plan(column(act, CARD_C))).toEqual([onR1(change)])
    expect(plan(column(act, CARD_C), at(onNothing))).toEqual([])
  })

  test("a fold is your view of the task you are on; off a task, nothing (ADR-0116)", () => {
    expect(plan({ kind: "fold", card: C, unfolded: true })).toEqual([
      onR1({ kind: "fold", card: C, unfolded: true }),
    ])
    expect(
      plan({ kind: "fold", card: C, unfolded: false }, at(onNothing)),
    ).toEqual([])
    expect(plan({ kind: "foldTask", unfolded: true })).toEqual([
      onR1({ kind: "foldTask", unfolded: true }),
    ])
    expect(plan({ kind: "foldTask", unfolded: true }, at(onNothing))).toEqual(
      [],
    )
  })

  test("a note column is made just after a card, or first, on the task you are on, and unfolded; off a task, nothing (ADR-0116)", () => {
    expect(plan({ kind: "addNoteColumn", after: C })).toEqual([
      {
        kind: "moveCard",
        move: {
          card: NEW_NOTE_COLUMN,
          from: null,
          to: { kind: "canvas-at", task: R1_ID, after: C },
        },
        how: { actedAt: { kind: "column", key: NEW_NOTE_COLUMN }, slot: null },
        queuedBy: null,
        fly: false,
        here: null,
      },
      onR1({ kind: "fold", card: NEW_NOTE_COLUMN, unfolded: true }),
    ])
    expect(plan({ kind: "addNoteColumn", after: null })[0]).toMatchObject({
      move: { to: { kind: "canvas-at", task: R1_ID, after: null } },
    })
    expect(plan({ kind: "addNoteColumn", after: C }, at(onNothing))).toEqual([])
  })

  test("a width is asked of the host, from the canvas the card is on; a card on none, nothing (ADR-0116)", () => {
    expect(plan({ kind: "cardWidth", card: C, width: 2 })).toEqual([
      {
        kind: "request",
        intent: {
          kind: "card-width",
          card: C,
          at: { kind: "canvas", task: R1_ID },
          width: 2,
        },
      },
    ])
    expect(plan({ kind: "cardWidth", card: F, width: 2 })).toEqual([])
  })

  test("a move reorders the column's card on the canvas, for everyone; a branch's or a new tab's has nowhere to move (ADR-0116)", () => {
    const move = (card: CardId, to: number): Intent => ({
      kind: "moveColumn",
      column: { kind: "card", card },
      to,
    })
    const moveTask: Intent = {
      kind: "moveColumn",
      // @ts-expect-error: the task column has no place on the canvas to move from
      column: { kind: "task", task: R1_ID },
      to: 0,
    }
    expect(moveTask.kind).toBe("moveColumn")
    expect(plan(move(C, 0))).toEqual([
      {
        kind: "reorderCard",
        reorder: {
          card: C,
          at: { kind: "canvas", task: R1_ID },
          after: null,
          before: TRUNK,
        },
        how: { actedAt: { kind: "column", key: C }, slot: null },
      },
    ])
    expect(plan(move(TRUNK, 1))).toMatchObject([
      { reorder: { card: TRUNK, after: C, before: null } },
    ])
    // Where it is already, past the canvas's end, or no card: nothing.
    expect(plan(move(C, 1))).toEqual([])
    expect(plan(move(C, 5))).toEqual([])
    expect(plan(move(F, 0))).toEqual([])
    expect(plan(move(C, 0), at(onNothing))).toEqual([])
  })

  describe("openAt", () => {
    test("an entry a column shows is scrolled to, on its root's tab", () => {
      expect(plan({ kind: "openAt", entry: entryId("3-b") })).toEqual([
        { kind: "reveal", entry: "3-b" },
        ...shown("1-r1", R1_ID),
      ])
    })

    test("an entry no unfolded column shows unfolds its thread's, revealed, which takes no focus", () => {
      // 4-c is a branch at 2-a: its card's column is folded.
      const effects = plan({ kind: "openAt", entry: entryId("4-c") })
      expect(effects[0]).toEqual({ kind: "reveal", entry: "4-c" })
      expect(effects.at(-1)).toEqual(
        onR1({ kind: "fold", card: C, unfolded: true }),
      )
      expect(effects.some(e => e.kind === "armFocus")).toBe(false)
    })

    test("a pick into an ask's work opens its fold before it is revealed (ADR-0106)", () => {
      const asks: AskIndex = {
        askOf: new Map([[entryId("4-c"), entryId("2-a")]]),
        work: new Map([[entryId("2-a"), [entryId("4-c")]]]),
        last: new Map([[entryId("2-a"), entryId("4-c")]]),
        steered: new Map(),
        stoppedBy: new Map(),
      }
      const effects = plan(
        { kind: "openAt", entry: entryId("4-c") },
        at(onRoot("1-r1"), asks),
      )
      expect(effects.slice(0, 2)).toEqual([
        { kind: "openFold", ask: "2-a" },
        { kind: "reveal", entry: "4-c" },
      ])
      // A message no run wrote opens nothing.
      expect(
        plan(
          { kind: "openAt", entry: entryId("3-b") },
          at(onRoot("1-r1"), asks),
        ).some(e => e.kind === "openFold"),
      ).toBe(false)
    })

    test("copyThread: a copy at the source's end, just after it on its canvas, or into your inventory; refused here into a full one, and nothing here from no canvas (ADR-0127)", () => {
      expect(plan({ kind: "copyThread", source: TRUNK, to: "here" })).toEqual([
        {
          kind: "request",
          intent: {
            kind: "copy-thread",
            source: TRUNK,
            end: entryId("3-b"),
            move: {
              card: NEW_THREAD,
              from: null,
              to: { kind: "canvas-at", task: R1_ID, after: TRUNK },
            },
          },
        },
      ])
      expect(
        plan({ kind: "copyThread", source: TRUNK, to: "inventory" }),
      ).toMatchObject([
        {
          kind: "request",
          intent: { move: { to: { kind: "inventory", holder: ME } } },
        },
      ])
      const slots = Object.fromEntries(
        Array.from({ length: INVENTORY_SLOTS }, (_, n) => [
          String(n),
          cardIdFor(`s${n}`),
        ]),
      )
      expect(
        plan(
          { kind: "copyThread", source: TRUNK, to: "inventory" },
          at(onRoot("1-r1"), indexAsks(index), { ...NO_CARDS, slots }),
        ).map(e => e.kind),
      ).toEqual(["showInventory", "refuse"])
      const nowhere = {
        ...R1,
        tasks: {
          ...TASKS,
          index: { ...TASKS.index, taskOfCard: new Map() },
        },
      }
      expect(
        plan({ kind: "copyThread", source: TRUNK, to: "here" }, nowhere),
      ).toEqual([])
    })

    test("put: a thread's card from your inventory lands on the canvas you are on, just after the column it was put on, unfolded (ADR-0117)", () => {
      const held: CardRecord = {
        kind: "thread",
        id: LINKED,
        owner: ME,
        placer: ME,
        place: { kind: "inventory", holder: ME },
        content: NO_CONTENT,
      }
      const state = at(onRoot("1-r1"), indexAsks(index), {
        ...NO_CARDS,
        cards: [held],
      })
      const effects = plan(
        { kind: "put", card: LINKED, target: { kind: "column", key: TRUNK } },
        state,
      )
      expect(effects[0]).toMatchObject({
        kind: "moveCard",
        move: {
          card: LINKED,
          from: { kind: "inventory", holder: ME },
          to: { kind: "canvas-at", task: R1_ID, after: TRUNK },
        },
      })
      expect(effects[1]).toMatchObject({ kind: "layout" })
    })

    test("openLink: an entry this tab holds opens as openAt does; another root is shown, archived or not, and the entry once it arrives (ADR-0063)", () => {
      expect(
        plan({
          kind: "openLink",
          link: linkOn(TASK_OF("1-r1")),
          entry: entryId("3-b"),
        }),
      ).toEqual(plan({ kind: "openAt", entry: entryId("3-b") }))
      expect(
        plan({
          kind: "openLink",
          link: linkOn(TASK_OF("8-r9")),
          entry: entryId("9-far"),
        }),
      ).toEqual([
        ...shown("8-r9", R9_ID),
        { kind: "openWhenHeld", entry: "9-far" },
      ])
    })

    test("openLink: a thread in your inventory opens its preview there; one someone else holds, or with no card, nothing (ADR-0124)", () => {
      const mine = threadLink(LINKED, [inventoryOf(ME)], ME)
      const slots = { "4": LINKED }
      expect(
        plan(
          { kind: "openLink", link: mine, entry: entryId("3-b") },
          at(onRoot("1-r1"), indexAsks(index), { ...NO_CARDS, slots }),
        ),
      ).toEqual([
        { kind: "showInventory", brief: false },
        { kind: "select", slot: 4 },
        { kind: "openSelected" },
      ])
      const held = threadLink(LINKED, [inventoryOf(writerId("bea@x.io"))], ME)
      expect(
        plan({ kind: "openLink", link: held, entry: entryId("3-b") }),
      ).toEqual([])
      expect(
        plan({
          kind: "openLink",
          link: threadLink(LINKED, [], ME),
          entry: entryId("3-b"),
        }),
      ).toEqual([])
    })

    test("a message's closed branch opens as openAt does; an unknown entry, nothing", () => {
      const fromColumn = column({ kind: "openAt", entry: entryId("3-b") })
      expect(plan(fromColumn)).toEqual(
        plan({ kind: "openAt", entry: entryId("3-b") }),
      )
      expect(plan({ kind: "openAt", entry: entryId("nowhere") })).toEqual([])
    })
  })

  describe("cards (ADR-0048, ADR-0108)", () => {
    const lane = threadIdFor("x")
    const where = atEntry(entryId("3-b"))
    const ada = writerId("ada@x.test")
    const c = cardIdFor("c1")
    const fresh: TextCard = {
      kind: "text",
      id: cardIdFor("c105"),
      owner: ada,
      placer: ada,
      place: { kind: "composing", thread: lane },
      content: { command: null, unsent: null, origin: null },
    }
    const here = { kind: "column", key: F } as const
    const inColumn = { actedAt: here, slot: null }
    const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
    const laneRecords = new Map([
      [lane, { lane, root: OTHER_ROOT, ownCopy: false, by: ada, createdAt: 0 }],
    ])
    const atEnd = {
      kind: "composing",
      thread: lane,
    } as const
    const queuedPlace = {
      kind: "queued",
      thread: lane,
      order: "a",
      by: ada,
      seen: "v",
    } as const
    const withCard = (place: TextPlace, records = laneRecords) =>
      ({
        ...NO_CARDS,
        cards: [{ ...fresh, id: c, place }],
        laneRecords: records,
      }) satisfies CardFacts
    test("a queue is one queueCard, onto its lane, with the hold change asked, said in the column; with no card, nothing", () => {
      const queue = column({
        kind: "queue",
        card: c,
        lane,
        at: where,
        hold: "release",
      })
      for (const layout of [onRoot("1-r1"), onNothing]) {
        const state = at(layout, undefined, withCard(atEnd))
        const move = {
          card: c,
          from: atEnd,
          to: { kind: "queued", thread: lane, seen: "" },
        }
        expect(plan(queue, state)).toEqual([
          {
            kind: "queueCard",
            move,
            hold: "release",
            command: null,
            how: inColumn,
          },
        ])
      }
      expect(plan(queue)).toEqual([])
    })
    test("an unqueue puts the card back where it was queued, saying who queued it; a card not queued, nothing", () => {
      const unqueue = column({ kind: "unqueue", card: c, lane, by: ada })
      const state = at(onRoot("1-r1"), undefined, withCard(queuedPlace))
      const move = {
        card: c,
        from: { kind: "queued", thread: lane, seen: "v" },
        to: { kind: "notes", near: "thread", thread: lane },
      }
      expect(plan(unqueue, state)).toEqual([
        {
          kind: "moveCard",
          move,
          how: inColumn,
          queuedBy: ada,
          fly: false,
          here: null,
        },
      ])
      expect(
        plan(unqueue, at(onRoot("1-r1"), undefined, withCard(atEnd))),
      ).toEqual([])
    })
    test("a reorder moves the card one place among the list as drawn, said in the column; at an edge, or past a fact, nothing (ADR-0048 step 7)", () => {
      const q = (id: string, order: string) =>
        ({
          ...fresh,
          id: textCardId(id),
          place: { ...queuedPlace, order },
        }) satisfies CardRecord
      const [a, b] = [q(cardIdFor("ca"), "a"), q(cardIdFor("cb"), "b")]
      const fact = {
        kind: "fact",
        id: cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1"),
        owner: ada,
        placer: ada,
        place: { ...queuedPlace, order: "c" },
        content: { fact: { kind: "described", lane, by: ada } },
      } satisfies CardRecord
      const state = at(onRoot("1-r1"), undefined, {
        ...NO_CARDS,
        cards: [a, b, fact],
      })
      const among = [a.id, b.id, fact.id]
      expect(
        plan(column({ kind: "reorder", card: b.id, among, step: -1 }), state),
      ).toEqual([
        {
          kind: "reorderCard",
          reorder: {
            card: b.id,
            at: { kind: "queued", thread: lane, seen: "v" },
            after: null,
            before: a.id,
          },
          how: inColumn,
        },
      ])
      expect(
        plan(column({ kind: "reorder", card: a.id, among, step: -1 }), state),
      ).toEqual([])
      expect(
        plan(column({ kind: "reorder", card: b.id, among, step: 1 }), state),
      ).toEqual([])
    })
    test("hold, release and unqueue all are one request each", () => {
      expect(plan(column({ kind: "holdQueue", lane, held: true }))).toEqual([
        { kind: "request", intent: { kind: "queue-hold", lane, held: true } },
      ])
      expect(plan(column({ kind: "unqueueAll", lane }))).toEqual([
        { kind: "request", intent: { kind: "unqueue-all", lane } },
      ])
    })
    test("a command is one write", () => {
      expect(
        plan(column({ kind: "setCommand", card: c, command: null })),
      ).toEqual([
        {
          kind: "request",
          intent: { kind: "set-command", card: c, command: null },
        },
      ])
    })
    test("catching up makes its card in the queue, with the command and no text, never drawn as a note; nothing takes focus", () => {
      expect(
        plan(
          column({
            kind: "queueNew",
            card: fresh.id,
            command: "bring-up-to-date",
            hold: "keep",
            lane,
            at: where,
          }),
        ),
      ).toEqual([
        {
          kind: "queueCard",
          move: {
            card: fresh.id,
            from: null,
            to: { kind: "queued", thread: lane, seen: "" },
          },
          hold: "keep",
          command: "bring-up-to-date",
          how: inColumn,
        },
      ])
    })
    test("an offer's other buttons are one command each", () => {
      expect(
        plan(column({ kind: "offer", lane, action: "squash", to: null })),
      ).toEqual([{ kind: "offer", lane, action: "squash", to: null }])
    })
    test("continue on accepted work queues its own command (ADR-0104)", () => {
      expect(
        plan(
          column({
            kind: "queueNew",
            card: fresh.id,
            command: "continue-on-accepted",
            hold: "keep",
            lane,
            at: where,
          }),
        )[0],
      ).toMatchObject({ kind: "queueCard", command: "continue-on-accepted" })
    })
  })

  test("signing out forgets who you are, then reloads", () => {
    expect(plan({ kind: "signOut" })).toEqual([
      { kind: "forgetIdentity" },
      { kind: "reload" },
    ])
  })

  test("rename and retitle are one request each, by task", () => {
    const task = TASK_OF("1-r1")
    expect(
      plan({ kind: "rename", of: { kind: "task", task }, title: "T" }),
    ).toEqual([
      {
        kind: "request",
        intent: { kind: "mark", of: { kind: "task", task }, title: "T" },
      },
    ])
    expect(plan({ kind: "retitle", task })).toEqual([
      { kind: "request", intent: { kind: "retitle", task } },
    ])
  })
})

test("afterTaskMove: what follows a move runs only once the host accepts it", () => {
  const moved: Effect[] = [
    { kind: "layout", action: { kind: "closeTask", task: TASK_OF("1-r1") } },
  ]
  expect(afterTaskMove({ kind: "moved-task" }, moved)).toBe(moved)
  expect(
    afterTaskMove(
      { kind: "refused", code: "task_moved", message: "no" },
      moved,
    ),
  ).toEqual([])
})

test("reconcileName's step: the session learns a name, or this device does", () => {
  const identity = { email: "a@x.test", name: "Ada" }
  expect(nameEffects({ kind: "send", name: "Ada" })).toEqual([
    { kind: "request", intent: { kind: "name", name: "Ada" } },
  ])
  expect(nameEffects({ kind: "store", identity })).toEqual([
    { kind: "storeIdentity", identity },
  ])
  expect(nameEffects(null)).toEqual([])
})

test("the column you opened takes focus once; no other column does", () => {
  expect(claimFocus("k", "k")).toEqual({ focus: true, armed: null })
  expect(claimFocus("k", "other")).toEqual({ focus: false, armed: "k" })
  expect(claimFocus(null, "k")).toEqual({ focus: false, armed: null })
})

test("foldList asks for the width the sidebar does not show", () => {
  expect(plan({ kind: "foldList" }, { ...R1, listWidth: "full" })).toEqual([
    { kind: "listWidth", width: "icons" },
  ])
  expect(plan({ kind: "foldList" }, { ...R1, listWidth: "icons" })).toEqual([
    { kind: "listWidth", width: "full" },
  ])
})

describe("a page over the stage (ADR-0098)", () => {
  const onPage: IntentState = { ...R1, page: "profile" }
  const leave: Effect = { kind: "page", to: null }
  const r2: Intent = {
    kind: "show",
    here: { kind: "task", task: TASK_OF("5-r2") },
  }
  test("opening and leaving a page are the page effect", () => {
    expect(plan({ kind: "page", to: "profile" })).toEqual([
      { kind: "page", to: "profile" },
    ])
    expect(plan({ kind: "page", to: null }, onPage)).toEqual([leave])
  })
  test("showing a root, a new tab or the board leaves the page first, once", () => {
    expect(plan(r2, onPage)).toEqual([leave, ...plan(r2)])
    const newTab: Intent = { kind: "newTab", asksAgent: true }
    expect(plan(newTab, onPage)).toEqual([leave, ...plan(newTab)])
    const fromColumn = column({
      kind: "newTab",
      prefill: { text: "again", blank: false },
      asksAgent: false,
    })
    expect(plan(fromColumn, onPage)).toEqual([leave, ...plan(fromColumn)])
    const board: Intent = { kind: "board", open: true, focus: true }
    expect(plan(board, onPage)).toEqual([leave, ...plan(board)])
    const inbox: Intent = {
      kind: "openLink",
      link: linkOn(TASK_OF("5-r2")),
      entry: entryId("9-unheld"),
    }
    expect(plan(inbox, onPage)[0]).toEqual(leave)
  })
  test("what shows nothing in the stage leaves the page where it is", () => {
    for (const intent of [
      { kind: "board", open: false },
      { kind: "foldList" },
      { kind: "close", here: { kind: "nothing" } },
    ] satisfies Intent[])
      expect(plan(intent, onPage)).toEqual(plan(intent))
  })
  test("with no page, nothing is added", () => {
    expect(plan(r2)).not.toContainEqual(leave)
  })
})

describe("a search over the root you are on (ADR-0101)", () => {
  const searching: IntentState = { ...R1, searching: true }
  const close: Effect = { kind: "search", act: { kind: "close" } }
  const openAt: Intent = { kind: "openAt", entry: entryId("3-b") }
  test("a search act is the search effect; opening opens on the task you are on, and on no task does nothing", () => {
    expect(plan({ kind: "search", act: { kind: "type", query: "x" } })).toEqual(
      [{ kind: "search", act: { kind: "type", query: "x" } }],
    )
    expect(plan({ kind: "search", act: { kind: "open" } })).toEqual([
      { kind: "search", act: { kind: "open", task: R1_ID } },
    ])
    expect(
      plan({ kind: "search", act: { kind: "open" } }, at(onNothing)),
    ).toEqual([])
  })
  test("openAt while searching closes the search first and marks the message last", () => {
    expect(plan(openAt, searching)).toEqual([
      close,
      ...plan(openAt),
      { kind: "landed", entry: "3-b" },
    ])
  })
  test("another task, a new tab, the board, a link or a new column close it too", () => {
    const r2: Intent = {
      kind: "show",
      here: { kind: "task", task: TASK_OF("5-r2") },
    }
    expect(plan(r2, searching)).toEqual([close, ...plan(r2)])
    const board: Intent = { kind: "board", open: true, focus: true }
    expect(plan(board, searching)).toEqual([close, ...plan(board)])
    const inbox: Intent = {
      kind: "openLink",
      link: linkOn(TASK_OF("5-r2")),
      entry: entryId("9-unheld"),
    }
    expect(plan(inbox, searching)[0]).toEqual(close)
    const branch = column({
      kind: "branch",
      branch: { at: entryId("2-a"), prefill: undefined },
    })
    expect(plan(branch, searching)).toEqual([close, ...plan(branch)])
  })
  test("what shows nothing new leaves the search open", () => {
    for (const intent of [
      { kind: "foldList" },
      { kind: "board", open: false },
      column({ kind: "density", density: "raw" }),
    ] satisfies Intent[])
      expect(plan(intent, searching)).toEqual(plan(intent))
  })
  test("while not searching, openAt plans exactly as before", () => {
    expect(plan(openAt)).not.toContainEqual(close)
    expect(plan(openAt).some(e => e.kind === "landed")).toBe(false)
  })
})
