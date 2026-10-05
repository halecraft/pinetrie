import {
  type AskIndex,
  atEntry,
  type CardRecord,
  cardId,
  type EntryId,
  entryId,
  indexAsks,
  laneNameForThread,
  type RootId,
  rootIdFor,
  workflowStateIdFor,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { NEW_ROOT, tree } from "./fixtures.ts"
import {
  afterRootMove,
  type CardFacts,
  claimFocus,
  type Effect,
  type Intent,
  type IntentState,
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

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** Each root's id, by its root entry: your list's key. */
const R1_ID = rootIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const R2_ID = rootIdFor("01a0ffd2-0000-7000-8000-0000000000a2")
const R9_ID = rootIdFor("01a0ffd2-0000-7000-8000-0000000000a9")
const ROOT_IDS = new Map<EntryId, RootId>([
  [entryId("1-r1"), R1_ID],
  [entryId("5-r2"), R2_ID],
  [entryId("8-r9"), R9_ID],
])

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
      here: { kind: "root", root: entryId(root) },
    }),
    { index, lanes: [], archived: new Set(), list: [entryId(root)] },
  )
const onNewTab: Layout = layoutReducer(initialLayout(), {
  kind: "newTab",
  key: "t",
  root: NEW_ROOT,
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
  rootEntries: new Map([...ROOT_IDS].map(([e, r]) => [r, e] as const)),
  rootIds: ROOT_IDS,
})
/** A root shown: the root you are on, and in your list, at its end if it was not. */
const shown = (root: string, id: RootId): Effect[] => [
  {
    kind: "layout",
    action: { kind: "show", here: { kind: "root", root: entryId(root) } },
  },
  { kind: "list", act: { kind: "ensure", root: id } },
]
const ME = writerId("ada@x.io")
const NO_CARDS: CardFacts = {
  cards: [],
  lanes: [],
  laneRecords: new Map(),
  me: ME,
  slots: {},
  selected: 0,
  composers: new Map(),
}
const R1 = at(onRoot("1-r1"))
const plan = (intent: Intent, state: IntentState = R1) =>
  planIntent(intent, state, "k", NEW_ROOT)
const column = (
  act: Extract<Intent, { kind: "column" }>["act"],
  position = 0,
): Intent => ({ kind: "column", position, key: "col-k", act })

describe("planIntent", () => {
  test("× on a root closes it for you: it leaves your list, and nothing shared is written", () => {
    expect(
      plan({ kind: "close", here: { kind: "root", root: entryId("1-r1") } }),
    ).toEqual([
      { kind: "list", act: { kind: "close", root: R1_ID } },
      { kind: "layout", action: { kind: "closeRoot", root: "1-r1" } },
    ])
  })

  test("× on a new tab closes it; nothing has none", () => {
    expect(plan({ kind: "close", here: { kind: "new", key: "t" } })).toEqual([
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
    expect(plan({ kind: "close", here: { kind: "nothing" } })).toEqual([])
  })

  test("showing a root opens it in your list; reordering your list places it by id (ADR-0085)", () => {
    expect(
      plan({ kind: "show", here: { kind: "root", root: entryId("5-r2") } }),
    ).toEqual(shown("5-r2", R2_ID))
    expect(plan({ kind: "show", here: { kind: "nothing" } })).toEqual([
      { kind: "layout", action: { kind: "show", here: { kind: "nothing" } } },
    ])
    expect(
      plan({
        kind: "moveInList",
        root: entryId("5-r2"),
        before: entryId("1-r1"),
      }),
    ).toEqual([
      { kind: "list", act: { kind: "place", root: R2_ID, before: R1_ID } },
    ])
    expect(
      plan({ kind: "moveInList", root: entryId("5-r2"), before: null }),
    ).toEqual([
      { kind: "list", act: { kind: "place", root: R2_ID, before: null } },
    ])
  })

  test("a move on the board asks the host; into the closed state it closes the root for you once accepted (ADR-0085)", () => {
    const [from, to] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
    const move = (closes: boolean) =>
      plan({ kind: "moveRoot", root: R1_ID, from, to, before: null, closes })
    const request = {
      kind: "move-root",
      root: R1_ID,
      from,
      to,
      before: null,
    } as const
    expect(move(false)).toEqual([
      { kind: "moveRoot", move: request, moved: [] },
    ])
    expect(move(true)).toEqual([
      {
        kind: "moveRoot",
        move: request,
        moved: [
          { kind: "list", act: { kind: "close", root: R1_ID } },
          { kind: "layout", action: { kind: "closeRoot", root: "1-r1" } },
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
    expect(plan({ kind: "board", open: true })).toEqual([
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
          root: "1-r1",
          action: { kind: "openFresh", key: "k", at: "2-a", after: 1 },
        },
      },
    ])
  })

  test("branch here, after a conflict, opens a fresh column holding the text", () => {
    const pending = { text: "hi", card: cardId("c") }
    expect(
      plan(column({ kind: "branchInstead", at: entryId("3-b"), pending }, 2)),
    ).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: {
          kind: "columns",
          root: "1-r1",
          action: { kind: "openFresh", key: "k", at: "3-b", after: 2, pending },
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
        action: { kind: "newTab", key: "k", root: NEW_ROOT, asksAgent: false },
      },
    ])
  })

  test("closing a column discards its card first; a new tab's closes the tab", () => {
    const close = column({ kind: "close", discard: [cardId("c")] }, 1)
    const place = {
      kind: "fresh",
      column: "col-k",
      root: TEST_ROOT,
      at: atEntry(entryId("2-a")),
    } as const
    const held: CardRecord = {
      id: cardId("c"),
      owner: ME,
      placer: ME,
      place,
      carries: { kind: "message", command: null },
      unsent: null,
    }
    const holding = { ...NO_CARDS, cards: [held] }
    const R1 = at(onRoot("1-r1"), undefined, holding)
    const discard = {
      kind: "moveCard",
      move: { card: "c", from: place, to: null },
      how: {
        actedAt: { kind: "column", key: "col-k" },
        slot: null,
      },
      queuedBy: null,
      fly: false,
    }
    expect(plan(close, R1)).toEqual([
      discard,
      {
        kind: "layout",
        action: {
          kind: "columns",
          root: "1-r1",
          action: { kind: "close", index: 1 },
        },
      },
    ])
    expect(plan(close, at(onNewTab, undefined, holding))).toEqual([
      discard,
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
    expect(plan(column({ kind: "close", discard: [] }), at(onNewTab))).toEqual([
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
  })

  test.each([
    ["first send", { kind: "sent", key: "t", sendId: "s" }],
    [
      "reservation (ADR-0057)",
      { kind: "reserve", key: "t", lane: laneNameForThread("r") },
    ],
  ] as const)("a column's %s is its root's, or its new tab's", (_, action) => {
    expect(plan(column(action))).toEqual([
      {
        kind: "layout",
        action: { kind: "columns", root: "1-r1", action },
      },
    ])
    expect(plan(column(action), at(onNewTab))).toEqual([
      { kind: "layout", action: { kind: "newTabColumn", key: "t", action } },
    ])
  })

  test.each([
    [
      "density (ADR-0056)",
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
      { kind: "layout", action: { kind: "columns", root: "1-r1", action } },
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
          root: "1-r1",
          action: { kind: "move", from: 2, to: 0 },
        },
      },
    ])
    expect(plan(move, at(onNewTab))).toEqual([])
  })

  describe("openAt", () => {
    test("an entry a column shows is scrolled to, on its root's tab", () => {
      expect(plan({ kind: "openAt", entry: entryId("4-c") })).toEqual([
        { kind: "reveal", entry: "4-c" },
        ...shown("1-r1", R1_ID),
      ])
    })

    test("an entry no column shows opens one, revealed, which takes no focus", () => {
      const effects = plan({ kind: "openAt", entry: entryId("3-b") })
      expect(effects[0]).toEqual({ kind: "reveal", entry: "3-b" })
      expect(effects.at(-1)).toEqual({
        kind: "layout",
        action: {
          kind: "columns",
          root: "1-r1",
          action: { kind: "open", key: "k", after: 0, anchor: "3-b" },
        },
      })
      expect(effects.some(e => e.kind === "armFocus")).toBe(false)
    })

    test("a pick into an ask's work opens its fold before it is revealed (ADR-0056)", () => {
      const asks: AskIndex = {
        askOf: new Map([[entryId("4-c"), entryId("2-a")]]),
        work: new Map([[entryId("2-a"), [entryId("4-c")]]]),
        last: new Map([[entryId("2-a"), entryId("4-c")]]),
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
        plan({ kind: "openIn", entry: entryId("3-b"), root: entryId("1-r1") }),
      ).toEqual(plan({ kind: "openAt", entry: entryId("3-b") }))
      expect(
        plan({
          kind: "openIn",
          entry: entryId("9-far"),
          root: entryId("8-r9"),
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

  describe("cards (ADR-0048, ADR-0055)", () => {
    const lane = laneNameForThread("x")
    const where = atEntry(entryId("3-b"))
    const ada = writerId("ada@x.test")
    const c = cardId("c-1")
    const fresh: CardRecord = {
      id: cardId("c-new"),
      owner: ada,
      placer: ada,
      place: { kind: "drafting", root: TEST_ROOT, at: where, lane },
      carries: { kind: "message", command: null },
      unsent: null,
    }
    const here = { kind: "column", key: "col-k" } as const
    const inColumn = { actedAt: here, slot: null }
    const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
    const laneRecords = new Map([
      [lane, { lane, root: OTHER_ROOT, work: null, by: ada, createdAt: 0 }],
    ])
    const drafting = {
      kind: "drafting",
      root: TEST_ROOT,
      at: where,
      lane,
    } as const
    const queuedPlace = {
      kind: "queued",
      root: TEST_ROOT,
      at: where,
      lane,
      order: "a",
      by: ada,
      seen: "v",
    } as const
    const withCard = (place: CardRecord["place"], records = laneRecords) =>
      ({
        ...NO_CARDS,
        cards: [{ ...fresh, id: c, place }],
        laneRecords: records,
      }) satisfies CardFacts
    test("a queue is one move, into its lane's root, said in the column; with no root, or no card, nothing", () => {
      const queue = column({ kind: "queue", card: c, lane, at: where })
      for (const layout of [onRoot("1-r1"), onNewTab]) {
        const state = at(layout, undefined, withCard(drafting))
        const move = {
          card: c,
          from: drafting,
          to: { kind: "queued", root: OTHER_ROOT, at: where, lane, seen: "" },
        }
        expect(plan(queue, state)).toEqual([
          {
            kind: "moveCard",
            move,
            how: inColumn,
            queuedBy: null,
            fly: false,
          },
        ])
      }
      const fresh = withCard(
        { kind: "fresh", column: "f", root: TEST_ROOT, at: where },
        new Map(),
      )
      expect(plan(queue, at(onNewTab, undefined, fresh))).toEqual([])
      expect(plan(queue)).toEqual([])
    })
    test("an unqueue puts the card back where it was queued, saying who queued it; a card not queued, nothing", () => {
      const unqueue = column({ kind: "unqueue", card: c, lane, by: ada })
      const state = at(onRoot("1-r1"), undefined, withCard(queuedPlace))
      const move = {
        card: c,
        from: { kind: "queued", root: TEST_ROOT, at: where, lane, seen: "v" },
        to: drafting,
      }
      expect(plan(unqueue, state)).toEqual([
        {
          kind: "moveCard",
          move,
          how: inColumn,
          queuedBy: ada,
          fly: false,
        },
      ])
      expect(
        plan(unqueue, at(onRoot("1-r1"), undefined, withCard(drafting))),
      ).toEqual([])
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
    test("catching up makes a card with the command and no text, and queues it at once; nothing takes focus", () => {
      expect(
        plan(
          column({
            kind: "queueCommand",
            create: fresh,
            command: "bring-up-to-date",
            lane,
            at: where,
          }),
        ),
      ).toEqual([
        {
          kind: "createCard",
          card: {
            ...fresh,
            carries: { kind: "message", command: "bring-up-to-date" },
          },
          text: "",
          how: inColumn,
        },
        {
          kind: "moveCard",
          move: {
            card: fresh.id,
            from: fresh.place,
            to: { kind: "queued", root: TEST_ROOT, at: where, lane, seen: "" },
          },
          how: inColumn,
          queuedBy: null,
          fly: false,
        },
      ])
    })
    test("an offer's other buttons are one command each", () => {
      expect(
        plan(column({ kind: "offer", lane, action: "squash", to: null })),
      ).toEqual([{ kind: "offer", lane, action: "squash", to: null }])
    })
    test("continue on the line queues its own command (ADR-0060)", () => {
      expect(
        plan(
          column({
            kind: "queueCommand",
            create: fresh,
            command: "continue-on-line",
            lane,
            at: where,
          }),
        )[0],
      ).toMatchObject({
        kind: "createCard",
        card: { carries: { kind: "message", command: "continue-on-line" } },
      })
    })
  })

  test("signing out forgets who you are, then reloads", () => {
    expect(plan({ kind: "signOut" })).toEqual([
      { kind: "forgetIdentity" },
      { kind: "reload" },
    ])
  })

  test("rename and retitle are one write each", () => {
    const root = entryId("1-r1")
    expect(plan({ kind: "rename", root, title: "T" })).toEqual([
      { kind: "mark", root, title: "T" },
    ])
    expect(plan({ kind: "retitle", root })).toEqual([{ kind: "retitle", root }])
  })
})

test("afterRootMove: what follows a move runs only once the host accepts it", () => {
  const moved: Effect[] = [
    { kind: "layout", action: { kind: "closeRoot", root: entryId("1-r1") } },
  ]
  expect(afterRootMove({ kind: "moved-root" }, moved)).toBe(moved)
  expect(
    afterRootMove(
      { kind: "refused", code: "root_moved", message: "no" },
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
