import {
  type AskIndex,
  atEntry,
  type CardRecord,
  type EntryId,
  entryId,
  indexAsks,
  rootIdFor,
  type TaskId,
  type TextCard,
  type TextPlace,
  taskIdFor,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { BOARD_SEARCH } from "./board-view.ts"
import type { CardFacts, Effect, IntentState } from "./effects.ts"
import { NEW_ROOT, NEW_TASK, NEW_THREAD, tasksFor, tree } from "./fixtures.ts"
import {
  afterTaskMove,
  claimFocus,
  type Intent,
  nameEffects,
  planIntent,
  readerAction,
} from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"

const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

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
/** On `root`'s tab, its one column following its newest leaf (4-c in r1). */
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
      entries: new Map([...ROOT_IDS].map(([e, t]) => [t, e] as const)),
    },
  )
const onNewTab: Layout = layoutReducer(initialLayout(), {
  kind: "newTab",
  key: "t",
  root: NEW_ROOT,
  task: NEW_TASK,
  thread: NEW_THREAD,
  asksAgent: false,
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
  tasks: tasksFor(...[...ROOT_IDS].map(([e, t]) => [t, e] as const)),
  listWidth: "full",
  page: null,
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
  })
const column = (
  act: Extract<Intent, { kind: "column" }>["act"],
  position = 0,
): Intent => ({ kind: "column", position, key: "col-k", act })

describe("planIntent", () => {
  test("× on a root closes it for you: it leaves the sidebar, and nothing shared is written", () => {
    expect(
      plan({ kind: "close", here: { kind: "task", task: TASK_OF("1-r1") } }),
    ).toEqual([
      { kind: "list", act: { kind: "close", task: R1_ID } },
      { kind: "layout", action: { kind: "closeTask", task: TASK_OF("1-r1") } },
    ])
  })

  test("× on a new tab closes it; nothing has none", () => {
    expect(plan({ kind: "close", here: { kind: "new", key: "t" } })).toEqual([
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
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

  test("a new tab from a board column carries its state", () => {
    const state = workflowStateIdFor("d")
    expect(plan({ kind: "newTab", asksAgent: true, state })).toContainEqual({
      kind: "layout",
      action: {
        kind: "newTab",
        key: "k",
        root: NEW_ROOT,
        task: NEW_TASK,
        thread: NEW_THREAD,
        asksAgent: true,
        state,
      },
    })
  })

  test("a branch opens a fresh column after its own, which takes focus", () => {
    expect(
      plan(
        column(
          {
            kind: "branch",
            branch: { at: entryId("2-a"), prefill: undefined },
          },
          1,
        ),
      ),
    ).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action: {
            kind: "openFresh",
            key: "k",
            thread: NEW_THREAD,
            at: "2-a",
            after: 1,
          },
        },
      },
    ])
  })

  test("branch here, after a conflict, opens a fresh column holding the text", () => {
    const pending = { text: "hi", card: textCardId("c") }
    expect(
      plan(column({ kind: "branchInstead", at: entryId("3-b"), pending }, 2)),
    ).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action: {
            kind: "openFresh",
            key: "k",
            thread: NEW_THREAD,
            at: "3-b",
            after: 2,
            pending,
          },
        },
      },
    ])
  })

  test("a new tab from a first message's edit starts with its text", () => {
    const prefill = { text: "again", blank: false }
    expect(plan(column({ kind: "newTab", prefill, asksAgent: true }))).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: {
          kind: "newTab",
          key: "k",
          root: NEW_ROOT,
          task: NEW_TASK,
          thread: NEW_THREAD,
          asksAgent: true,
          prefill,
        },
      },
    ])
  })

  test("＋ opens a new tab, which takes focus", () => {
    expect(plan({ kind: "newTab", asksAgent: false })).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: {
          kind: "newTab",
          key: "k",
          root: NEW_ROOT,
          task: NEW_TASK,
          thread: NEW_THREAD,
          asksAgent: false,
        },
      },
    ])
  })

  test("closing a column discards its card first; a new tab's closes the tab", () => {
    const close = column({ kind: "close", discard: [textCardId("c")] }, 1)
    const place = {
      kind: "fresh",
      column: "col-k",
      root: TEST_ROOT,
      task: TEST_TASK,
      at: atEntry(entryId("2-a")),
    } as const
    const held: CardRecord = {
      kind: "text" as const,
      id: textCardId("c"),
      owner: ME,
      placer: ME,
      place,
      carries: { kind: "message", command: null },
      unsent: null,
    }
    const holding = { ...NO_CARDS, cards: [held] }
    const R1 = at(onRoot("1-r1"), undefined, holding)
    // Sent with the task you are on, or the new tab's: from no task, a
    // discard's history is its sender's (ADR-0116).
    const discard = (task: TaskId) => ({
      kind: "moveCard",
      move: {
        card: "c",
        from: place,
        to: { kind: "gone", why: { kind: "discarded" } },
      },
      how: {
        actedAt: { kind: "column", key: "col-k" },
        slot: null,
      },
      queuedBy: null,
      fly: false,
      here: task,
    })
    expect(plan(close, R1)).toEqual([
      discard(R1_ID),
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action: { kind: "close", index: 1 },
        },
      },
    ])
    expect(plan(close, at(onNewTab, undefined, holding))).toEqual([
      discard(NEW_TASK),
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
    expect(plan(column({ kind: "close", discard: [] }), at(onNewTab))).toEqual([
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
  })

  test.each([
    ["first send", { kind: "sent", key: "t", sendId: "s" }],
  ] as const)("a column's %s is its root's, or its new tab's", (_, action) => {
    expect(plan(column(action))).toEqual([
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action,
        },
      },
    ])
    expect(plan(column(action), at(onNewTab))).toEqual([
      { kind: "layout", action: { kind: "newTabColumn", key: "t", action } },
    ])
  })

  test.each([
    [
      "density (ADR-0106)",
      { kind: "density", density: "outline" },
      { kind: "density", key: "col-k", density: "outline" },
    ],
    [
      "details (ADR-0073)",
      { kind: "details", open: true },
      { kind: "details", key: "col-k", open: true },
    ],
  ] as const)("a column's %s is set by its key, on its root's tab or its new tab", (_, act, action) => {
    expect(readerAction(act, "col-k")).toEqual(action)
    expect(plan(column(act, 2))).toEqual([
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action,
        },
      },
    ])
    expect(plan(column(act), at(onNewTab))).toEqual([
      { kind: "layout", action: { kind: "newTabColumn", key: "t", action } },
    ])
  })

  test("no other act is a reader's setting", () => {
    expect(readerAction({ kind: "move", to: 0 }, "col-k")).toBeNull()
  })

  test("a move is its root's; a new tab's column has nowhere to move", () => {
    const move = column({ kind: "move", to: 0 }, 2)
    expect(plan(move)).toEqual([
      {
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action: { kind: "move", from: 2, to: 0 },
        },
      },
    ])
    expect(plan(move, at(onNewTab))).toEqual([])
  })

  describe("openAt", () => {
    test("an entry a column shows is scrolled to, on its root's tab", () => {
      expect(plan({ kind: "openAt", entry: entryId("3-b") })).toEqual([
        { kind: "reveal", entry: "3-b" },
        ...shown("1-r1", R1_ID),
      ])
    })

    test("an entry no column shows opens one, revealed, which takes no focus", () => {
      // 4-c is a branch at 2-a: the root's first column follows 3-b.
      const effects = plan({ kind: "openAt", entry: entryId("4-c") })
      expect(effects[0]).toEqual({ kind: "reveal", entry: "4-c" })
      expect(effects.at(-1)).toEqual({
        kind: "layout",
        action: {
          kind: "columns",
          task: TASK_OF("1-r1"),
          entry: "1-r1",
          action: { kind: "open", key: "k", after: 0, anchor: "4-c" },
        },
      })
      expect(effects.some(e => e.kind === "armFocus")).toBe(false)
    })

    test("a pick into an ask's work opens its fold before it is revealed (ADR-0106)", () => {
      const asks: AskIndex = {
        askOf: new Map([[entryId("4-c"), entryId("2-a")]]),
        work: new Map([[entryId("2-a"), [entryId("4-c")]]]),
        last: new Map([[entryId("2-a"), entryId("4-c")]]),
        steered: new Map(),
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

    test("openIn: an entry this tab holds opens as openAt does; another root is shown, archived or not, and the entry once it arrives (ADR-0063)", () => {
      expect(
        plan({ kind: "openIn", entry: entryId("3-b"), task: TASK_OF("1-r1") }),
      ).toEqual(plan({ kind: "openAt", entry: entryId("3-b") }))
      expect(
        plan({
          kind: "openIn",
          entry: entryId("9-far"),
          task: TASK_OF("8-r9"),
        }),
      ).toEqual([
        ...shown("8-r9", R9_ID),
        { kind: "openWhenHeld", entry: "9-far" },
      ])
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
    const c = textCardId("c-1")
    const fresh: TextCard = {
      kind: "text",
      id: textCardId("c-new"),
      owner: ada,
      placer: ada,
      place: { kind: "composing", at: where, thread: lane },
      carries: { kind: "message", command: null },
      unsent: null,
    }
    const here = { kind: "column", key: "col-k" } as const
    const inColumn = { actedAt: here, slot: null }
    const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
    const laneRecords = new Map([
      [lane, { lane, root: OTHER_ROOT, ownCopy: false, by: ada, createdAt: 0 }],
    ])
    const atEnd = {
      kind: "composing",
      at: where,
      thread: lane,
    } as const
    const queuedPlace = {
      kind: "queued",
      at: where,
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
      for (const layout of [onRoot("1-r1"), onNewTab]) {
        const state = at(layout, undefined, withCard(atEnd))
        const move = {
          card: c,
          from: atEnd,
          to: { kind: "queued", at: where, thread: lane, seen: "" },
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
        from: { kind: "queued", at: where, thread: lane, seen: "v" },
        to: { ...atEnd, kind: "note", cell: null },
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
      const [a, b] = [q("c-a", "a"), q("c-b", "b")]
      const fact = {
        ...q("c-f", "c"),
        carries: {
          kind: "fact",
          fact: { kind: "described", lane, by: ada },
        },
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
            at: { kind: "queued", at: where, thread: lane, seen: "v" },
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
            to: { kind: "queued", at: where, thread: lane, seen: "" },
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
    expect(plan({ kind: "rename", task, title: "T" })).toEqual([
      { kind: "request", intent: { kind: "mark", task, title: "T" } },
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

describe("a page over the workspace (ADR-0098)", () => {
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
      kind: "openIn",
      entry: entryId("9-unheld"),
      task: TASK_OF("5-r2"),
    }
    expect(plan(inbox, onPage)[0]).toEqual(leave)
  })
  test("what shows nothing in the workspace leaves the page where it is", () => {
    for (const intent of [
      { kind: "board", open: false },
      { kind: "foldList" },
      { kind: "close", here: { kind: "new", key: "t" } },
    ] satisfies Intent[])
      expect(plan(intent, onPage)).toEqual(plan(intent))
  })
  test("with no page, nothing is added", () => {
    expect(plan(r2)).not.toContainEqual(leave)
  })
})
