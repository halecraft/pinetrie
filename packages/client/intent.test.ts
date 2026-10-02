import {
  type ArchiveRecord,
  type AskIndex,
  atEntry,
  type CardRecord,
  cardId,
  type EntryId,
  entryId,
  indexAsks,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { tree } from "./fixtures.ts"
import {
  afterRestore,
  type CardFacts,
  claimFocus,
  type Effect,
  entryShown,
  type Intent,
  type IntentState,
  nameEffects,
  planIntent,
} from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"

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
      tab: { kind: "root", root: entryId(root) },
    }),
    { index, lanes: [], archive: new Map() },
  )
const onNewTab: Layout = layoutReducer(initialLayout(), {
  kind: "newTab",
  key: "t",
  asksAgent: false,
})
const at = (
  layout: Layout,
  archive = new Map<EntryId, ArchiveRecord>(),
  asks: AskIndex = indexAsks(index),
  cards: CardFacts = NO_CARDS,
) => ({
  layout,
  index,
  archive,
  asks,
  cards,
})
const ME = writerId("ada@x.io")
const NO_CARDS: CardFacts = {
  cards: [],
  lanes: [],
  me: ME,
  slots: {},
  selected: 0,
  history: { undo: [], redo: [] },
  composers: new Map(),
}
const R1 = at(onRoot("1-r1"))
const plan = (intent: Intent, state: IntentState = R1) =>
  planIntent(intent, state, "k")
const column = (
  act: Extract<Intent, { kind: "column" }>["act"],
  position = 0,
): Intent => ({ kind: "column", position, key: "col-k", act })

describe("planIntent", () => {
  test("× on a root's tab closes it for you, and writes nothing", () => {
    expect(
      plan({ kind: "closeTab", tab: { kind: "root", root: entryId("1-r1") } }),
    ).toEqual([{ kind: "layout", action: { kind: "closeRoot", root: "1-r1" } }])
  })

  test("× on a new tab closes it; the Archive tab has none", () => {
    expect(plan({ kind: "closeTab", tab: { kind: "new", key: "t" } })).toEqual([
      { kind: "layout", action: { kind: "closeNewTab", key: "t" } },
    ])
    expect(plan({ kind: "closeTab", tab: { kind: "archive" } })).toEqual([])
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
        action: { kind: "newTab", key: "k", asksAgent: true, prefill },
      },
    ])
  })

  test("＋ opens a new tab, which takes focus", () => {
    expect(plan({ kind: "newTab", asksAgent: false })).toEqual([
      { kind: "armFocus", key: "k" },
      {
        kind: "layout",
        action: { kind: "newTab", key: "k", asksAgent: false },
      },
    ])
  })

  test("closing a column discards its card first; a new tab's closes the tab", () => {
    const close = column({ kind: "close", discard: [cardId("c")] }, 1)
    const discard = {
      kind: "discardCard",
      card: "c",
      how: {
        actedAt: { kind: "column", key: "col-k" },
        history: { kind: "none" },
        slot: null,
      },
    }
    expect(plan(close)).toEqual([
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
    expect(plan(close, at(onNewTab))).toEqual([
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
        {
          kind: "layout",
          action: { kind: "show", tab: { kind: "root", root: "1-r1" } },
        },
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

    test("an entry in an archived root is previewed in the Archive tab", () => {
      const archive = new Map<EntryId, ArchiveRecord>([
        [
          entryId("5-r2"),
          {
            root: entryId("5-r2"),
            state: "archived",
            by: writerId("a@x.test"),
            at: 1,
          },
        ],
      ])
      expect(
        plan(
          { kind: "openAt", entry: entryId("6-d") },
          at(onRoot("1-r1"), archive),
        ),
      ).toEqual([
        { kind: "pickArchived", root: "5-r2" },
        { kind: "layout", action: { kind: "show", tab: { kind: "archive" } } },
      ])
    })

    test("a pick into an ask's work opens its fold before it is revealed (ADR-0056)", () => {
      const asks: AskIndex = {
        askOf: new Map([[entryId("4-c"), entryId("2-a")]]),
        work: new Map([[entryId("2-a"), [entryId("4-c")]]]),
        last: new Map([[entryId("2-a"), entryId("4-c")]]),
      }
      const effects = plan(
        { kind: "openAt", entry: entryId("4-c") },
        at(onRoot("1-r1"), new Map(), asks),
      )
      expect(effects.slice(0, 2)).toEqual([
        { kind: "openFold", ask: "2-a" },
        { kind: "reveal", entry: "4-c" },
      ])
      // A message no run wrote opens nothing.
      expect(
        plan(
          { kind: "openAt", entry: entryId("3-b") },
          at(onRoot("1-r1"), new Map(), asks),
        ).some(e => e.kind === "openFold"),
      ).toBe(false)
    })

    test("a message's closed branch opens as openAt does; no entry, nothing", () => {
      const fromColumn = column({ kind: "openAt", entry: entryId("3-b") })
      expect(plan(fromColumn)).toEqual(
        plan({ kind: "openAt", entry: entryId("3-b") }),
      )
      expect(entryShown(fromColumn)).toBe("3-b")
      expect(entryShown({ kind: "openAt", entry: entryId("3-b") })).toBe("3-b")
      expect(entryShown({ kind: "signOut" })).toBe(null)
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
      place: { kind: "drafting", at: where, lane },
      command: null,
      unsent: null,
    }
    const here = { kind: "column", key: "col-k" } as const
    const unrecorded = { actedAt: here, history: { kind: "none" }, slot: null }
    test("queue, unqueue and a command are one write each, on any tab; a card the page holds is recorded", () => {
      for (const state of [R1, at(onNewTab)]) {
        expect(
          plan(column({ kind: "queue", card: c, lane, at: where }), state),
        ).toEqual([
          { kind: "queueCard", card: c, lane, at: where, how: unrecorded },
        ])
        expect(
          plan(column({ kind: "unqueue", card: c, lane, by: ada }), state),
        ).toEqual([
          { kind: "unqueueCard", card: c, lane, by: ada, how: unrecorded },
        ])
        expect(
          plan(column({ kind: "setCommand", card: c, command: null }), state),
        ).toEqual([{ kind: "setCommand", card: c, command: null }])
      }
    })
    test("bring up to date sets the command on your card at the end, and focuses its column", () => {
      expect(
        plan(
          column({
            kind: "bringUpToDate",
            key: "col",
            card: c,
            create: fresh,
            command: "bring-up-to-date",
          }),
        ),
      ).toEqual([
        { kind: "setCommand", card: c, command: "bring-up-to-date" },
        { kind: "armFocus", key: "col" },
      ])
    })
    test("bring up to date with no card of yours there creates one, with the command", () => {
      expect(
        plan(
          column({
            kind: "bringUpToDate",
            key: "col",
            card: null,
            create: fresh,
            command: "bring-up-to-date",
          }),
        ),
      ).toEqual([
        {
          kind: "createCard",
          card: { ...fresh, command: "bring-up-to-date" },
          text: "",
          how: unrecorded,
        },
        { kind: "armFocus", key: "col" },
      ])
    })
    test("an offer's other buttons are one command each", () => {
      expect(
        plan(column({ kind: "offer", lane, action: "split", to: null })),
      ).toEqual([{ kind: "offer", lane, action: "split", to: null }])
    })
    test("continue on the line sets its own command (ADR-0060)", () => {
      expect(
        plan(
          column({
            kind: "bringUpToDate",
            key: "col",
            card: c,
            create: fresh,
            command: "continue-on-line",
          }),
        )[0],
      ).toEqual({ kind: "setCommand", card: c, command: "continue-on-line" })
    })
  })

  test("signing out forgets who you are, then reloads", () => {
    expect(plan({ kind: "signOut" })).toEqual([
      { kind: "forgetIdentity" },
      { kind: "reload" },
    ])
  })

  test("archive, restore and rename are one write each", () => {
    const root = entryId("1-r1")
    expect(plan({ kind: "archive", root })).toEqual([{ kind: "archive", root }])
    expect(plan({ kind: "restore", root })).toEqual([{ kind: "restore", root }])
    expect(plan({ kind: "rename", root, title: "T" })).toEqual([
      { kind: "mark", root, title: "T" },
    ])
  })
})

test("a restore shows its root only once it is restored", () => {
  const root = entryId("1-r1")
  expect(afterRestore({ kind: "restored" }, root)).toEqual<Effect[]>([
    { kind: "layout", action: { kind: "show", tab: { kind: "root", root } } },
  ])
  expect(
    afterRestore({ kind: "refused", code: "x", message: "no" } as never, root),
  ).toEqual([])
})

test("reconcileName's step: the session learns a name, or this device does", () => {
  const identity = { email: "a@x.test", name: "Ada" }
  expect(nameEffects({ kind: "send", name: "Ada" })).toEqual([
    { kind: "setName", name: "Ada" },
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
