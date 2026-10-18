import {
  type AskIndex,
  atEntry,
  type CanvasId,
  type CardId,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  type EntryId,
  ERR,
  entryId,
  INVENTORY_SLOTS,
  indexAsks,
  indexTree,
  NO_CONTENT,
  rootIdFor,
  type Sha256,
  type TextCard,
  type TextPlace,
  type ThreadCard,
  textCardId,
  threadIdFor,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, entriesById, entry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { ColumnKey } from "./columns.ts"
import type { CardFacts, Effect, IntentState } from "./effects.ts"
import {
  canvasesFor,
  NEW_CANVAS,
  NEW_MEDIA,
  NEW_NOTE_COLUMN,
  NEW_ROOT,
  NEW_TEXT,
  NEW_THREAD,
  NO_CLIPS,
  newImage,
  threadOfEntry,
  tree,
} from "./fixtures.ts"
import {
  afterCanvasMove,
  type ColumnAct,
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
import { AGENT_PREFILL } from "./message-tools.ts"
import { threadLink } from "./thread-link.ts"

const _TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** Each root's canvas, by its root entry: the sidebar's key. */
const R1_ID = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const R2_ID = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a2")
const R9_ID = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a9")
const ROOT_IDS = new Map<EntryId, CanvasId>([
  [entryId("1-r1"), R1_ID],
  [entryId("5-r2"), R2_ID],
  [entryId("8-r9"), R9_ID],
])
const ROOT_CANVAS = (root: string): CanvasId =>
  ROOT_IDS.get(entryId(root)) ?? R9_ID

// r1 -> a -> b, with a branch a -> c; and r2 -> d.
const index = tree({
  "1-r1": null,
  "2-a": "1-r1",
  "3-b": "2-a",
  "4-c": "2-a",
  "5-r2": null,
  "6-d": "5-r2",
})
const CANVASES = canvasesFor(
  index,
  ...[...ROOT_IDS].map(([e, t]) => [t, e] as const),
)
/** r1's threads: its trunk, through 3-b, and the branch at 2-a, 4-c. */
const TRUNK = threadOfEntry("1-r1")
const C = threadOfEntry("4-c")
/** A branch's thread, and its column's key, in r1's canvas. */
const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
/** On `root`'s tab, its first column unfolded (`defaultView`). */
const onRoot = (root: string): Layout =>
  resolveLayout(
    layoutReducer(initialLayout(), {
      kind: "show",
      here: { kind: "canvas", canvas: ROOT_CANVAS(root) },
    }),
    {
      index,
      lanes: [],
      archived: new Set(),
      list: [ROOT_CANVAS(root)],
      cardsOn: CANVASES.index.cardsOn,
      unstarted: new Map(),
      holders: new Map(),
    },
  )
/** On no canvas. */
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
  canvases: CANVASES,
  listWidth: "full",
  page: null,
  searching: false,
  clips: NO_CLIPS,
})
/** A root shown: the root you are on, and in the sidebar, at its end if it was not. */
const shown = (root: string, id: CanvasId): Effect[] => [
  {
    kind: "layout",
    moves: false,
    action: {
      kind: "show",
      here: { kind: "canvas", canvas: ROOT_CANVAS(root) },
    },
  },
  { kind: "list", act: { kind: "ensure", canvas: id } },
]
const ME = writerId("ada@x.io")
/** A thread whose card a link finds. */
const LINKED = threadIdFor("linked")
const inventoryOf = (holder: WriterId): ThreadCard => ({
  kind: "thread",
  id: LINKED,
  owner: ME,
  placer: holder,
  place: { kind: "inventory", holder },
  content: NO_CONTENT,
})
/** A link to a thread on `canvas`'s canvas. */
const linkOn = (canvas: CanvasId) =>
  threadLink(
    LINKED,
    [
      {
        ...inventoryOf(ME),
        place: { kind: "canvas", canvas, order: "1", width: 1 },
      },
    ],
    ME,
  )
const NO_CARDS: CardFacts = {
  cards: [],
  lanes: [],
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
    canvas: NEW_CANVAS,
    thread: NEW_THREAD,
    noteColumn: NEW_NOTE_COLUMN,
    media: NEW_MEDIA,
    images: count => Array.from({ length: count }, (_, i) => newImage(i)),
    reference: cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e1",
    ),
    text: NEW_TEXT,
    branches: count => BRANCHES.slice(0, count),
  })
/** The threads a press on a proposal mints, in order. */
const BRANCHES = [1, 2, 3].map(n =>
  threadIdFor(`01a0ffd2-0000-7000-8000-0000000000c${n}`),
)
/** The column keys these tests name: a branch's card's, a card's. */
const UNSTARTED: ColumnKey = { kind: "card", card: F }
const CARD_C: ColumnKey = { kind: "card", card: C }
const column = (
  act: Extract<Intent, { kind: "column" }>["act"],
  key: ColumnKey = UNSTARTED,
): Intent => ({ kind: "column", column: key, act })
/** A change to your view of r1's canvas, as an effect. */
const onR1 = (change: object): Effect =>
  ({
    kind: "layout",
    moves: false,
    action: { kind: "view", canvas: R1_ID, first: TRUNK, change },
  }) as Effect

describe("planIntent", () => {
  test("× on a root closes it for you: it leaves the sidebar, and nothing shared is written", () => {
    expect(
      plan({
        kind: "close",
        here: { kind: "canvas", canvas: ROOT_CANVAS("1-r1") },
      }),
    ).toEqual([
      { kind: "list", act: { kind: "close", canvas: R1_ID } },
      {
        kind: "layout",
        moves: false,
        action: { kind: "closeCanvas", canvas: ROOT_CANVAS("1-r1") },
      },
    ])
  })

  test("× on nothing closes nothing", () => {
    expect(plan({ kind: "close", here: { kind: "nothing" } })).toEqual([])
  })

  test("showing a root opens it in the sidebar; reordering the sidebar places it by id", () => {
    expect(
      plan({
        kind: "show",
        here: { kind: "canvas", canvas: ROOT_CANVAS("5-r2") },
      }),
    ).toEqual(shown("5-r2", R2_ID))
    expect(plan({ kind: "show", here: { kind: "nothing" } })).toEqual([
      {
        kind: "layout",
        moves: false,
        action: { kind: "show", here: { kind: "nothing" } },
      },
    ])
    expect(
      plan({
        kind: "moveInList",
        canvas: ROOT_CANVAS("5-r2"),
        before: ROOT_CANVAS("1-r1"),
      }),
    ).toEqual([
      { kind: "list", act: { kind: "place", canvas: R2_ID, before: R1_ID } },
    ])
    expect(
      plan({ kind: "moveInList", canvas: ROOT_CANVAS("5-r2"), before: null }),
    ).toEqual([
      { kind: "list", act: { kind: "place", canvas: R2_ID, before: null } },
    ])
  })

  test("a move on the board asks the host; into the archive it closes the root for you once accepted", () => {
    const [from, to] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
    const move = (closes: boolean) =>
      plan({
        kind: "moveCanvas",
        canvas: R1_ID,
        from,
        to,
        before: null,
        closes,
      })
    const request = {
      kind: "move-canvas",
      canvas: R1_ID,
      from,
      to,
      before: null,
    } as const
    expect(move(false)).toEqual([
      { kind: "moveCanvas", move: request, moved: [] },
    ])
    expect(move(true)).toEqual([
      {
        kind: "moveCanvas",
        move: request,
        moved: [
          { kind: "list", act: { kind: "close", canvas: R1_ID } },
          {
            kind: "layout",
            moves: false,
            action: { kind: "closeCanvas", canvas: ROOT_CANVAS("1-r1") },
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
      { kind: "layout", moves: false, action: { kind: "board", open: true } },
    ])
    expect(plan({ kind: "board", open: false })).toEqual([
      { kind: "layout", moves: false, action: { kind: "board", open: false } },
    ])
  })

  test("a person's open of the board arms its search's focus first; the board's own open arms nothing", () => {
    expect(plan({ kind: "board", open: true, focus: true })).toEqual([
      { kind: "armFocus", key: { kind: "board" } },
      { kind: "layout", moves: false, action: { kind: "board", open: true } },
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

  test("a new canvas from a first message's edit starts with its text", () => {
    const prefill = { text: "again", blank: false }
    expect(plan(column({ kind: "newCanvas", prefill }))).toContainEqual({
      kind: "layout",
      moves: false,
      action: {
        kind: "view",
        canvas: NEW_CANVAS,
        first: null,
        change: { kind: "opened", card: NEW_THREAD, prefill },
      },
    })
  })

  test("＋ opens a new canvas: its canvas and its thread written now, shown and in the sidebar, its thread's box starting with @agent, taking focus", () => {
    expect(plan({ kind: "newCanvas", state: workflowStateIdFor("d") })).toEqual(
      [
        { kind: "armFocus", key: { kind: "column", key: NEW_THREAD } },
        {
          kind: "request",
          intent: {
            kind: "open-thread",
            thread: NEW_THREAD,
            root: NEW_ROOT,
            canvas: NEW_CANVAS,
            start: { kind: "new-canvas", state: workflowStateIdFor("d") },
          },
        },
        {
          kind: "layout",
          moves: false,
          action: {
            kind: "view",
            canvas: NEW_CANVAS,
            first: null,
            change: {
              kind: "opened",
              card: NEW_THREAD,
              prefill: AGENT_PREFILL,
            },
          },
        },
        {
          kind: "layout",
          moves: false,
          action: {
            kind: "show",
            here: { kind: "canvas", canvas: NEW_CANVAS },
          },
        },
        { kind: "list", act: { kind: "ensure", canvas: NEW_CANVAS } },
      ],
    )
  })

  test("a branch is opened on the host, just after its thread, its column unfolded with what it starts with, taking focus", () => {
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
      { kind: "armFocus", key: { kind: "column", key: NEW_THREAD } },
      {
        kind: "request",
        intent: {
          kind: "open-thread",
          thread: NEW_THREAD,
          root: TEST_ROOT,
          canvas: R1_ID,
          start: { kind: "branch", at: at2 },
        },
      },
      onR1({
        kind: "opened",
        card: NEW_THREAD,
        prefill: { text: "hi", blank: false },
      }),
    ])
    // Off a canvas, nothing.
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

  test("× on any column trashes its card alone, asking nothing, your message there staying with it; a new canvas's only thread, not yet started, takes its canvas out of the sidebar too", () => {
    const thread: CardRecord = {
      kind: "thread",
      id: F,
      owner: ME,
      placer: ME,
      place: { kind: "canvas", canvas: R1_ID, order: "zz", width: 1 },
      content: NO_CONTENT,
    }
    const state = at(onRoot("1-r1"), undefined, {
      ...NO_CARDS,
      cards: [thread],
    })
    const away = {
      card: F,
      from: { kind: "canvas", canvas: R1_ID },
      to: { kind: "trash" },
    }
    const column = { kind: "column", key: F } as const
    expect(plan({ kind: "discard", card: F, at: column }, state)).toMatchObject(
      [{ kind: "moveCard", move: away, how: { actedAt: column } }],
    )
    // Alone on its canvas: a new canvas's, whose canvas then leaves the sidebar.
    const alone = { ...thread, place: { ...thread.place, canvas: NEW_CANVAS } }
    const onTab = {
      ...at(onRoot("1-r1"), undefined, { ...NO_CARDS, cards: [alone] }),
      canvases: {
        ...CANVASES,
        index: { ...CANVASES.index, cardsOn: new Map([[NEW_CANVAS, [alone]]]) },
      },
    } as IntentState
    expect(plan({ kind: "discard", card: F, at: column }, onTab)).toEqual([
      {
        kind: "moveCards",
        moves: [
          {
            move: {
              card: F,
              from: { kind: "canvas", canvas: NEW_CANVAS },
              to: { kind: "trash" },
            },
            slot: null,
          },
        ],
        actedAt: column,
        close: [
          { kind: "list", act: { kind: "close", canvas: NEW_CANVAS } },
          {
            kind: "layout",
            moves: false,
            action: { kind: "closeCanvas", canvas: NEW_CANVAS },
          },
        ],
        here: NEW_CANVAS,
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
      "density",
      { kind: "density", density: "outline" },
      { kind: "density", card: C, density: "outline" },
    ],
    [
      "details",
      { kind: "details", open: true },
      { kind: "details", card: C, open: true },
    ],
  ] as const)("a column's %s is your view of its card", (_, act, change) => {
    expect(plan(column(act, CARD_C))).toEqual([onR1(change)])
    expect(plan(column(act, CARD_C), at(onNothing))).toEqual([])
  })

  test("a fold you ask for is your view of the canvas you are on, and moves; off a canvas, nothing", () => {
    const moving = (change: object) => ({ ...onR1(change), moves: true })
    expect(plan({ kind: "fold", card: C, unfolded: true })).toEqual([
      moving({ kind: "fold", card: C, unfolded: true }),
    ])
    expect(
      plan({ kind: "fold", card: C, unfolded: false }, at(onNothing)),
    ).toEqual([])
    expect(plan({ kind: "foldCanvas", unfolded: true })).toEqual([
      moving({ kind: "foldCanvas", unfolded: true }),
    ])
    expect(plan({ kind: "foldCanvas", unfolded: true }, at(onNothing))).toEqual(
      [],
    )
  })

  test("images put at a spot make a media column the page mints, unfolded for their putter; put in a column, none", () => {
    const images = [
      { card: newImage(1), sha256: "a".repeat(64) as Sha256, name: "home.png" },
    ]
    const to = { kind: "canvas-at", canvas: R1_ID, after: C } as const
    expect(plan({ kind: "putImages", images, to })).toEqual([
      {
        kind: "request",
        intent: { kind: "put-images", images, to, made: NEW_MEDIA },
      },
      onR1({ kind: "fold", card: NEW_MEDIA, unfolded: true }),
    ])
    const into = { kind: "image", column: NEW_MEDIA } as const
    expect(plan({ kind: "putImages", images, to: into })).toEqual([
      {
        kind: "request",
        intent: { kind: "put-images", images, to: into, made: null },
      },
    ])
  })

  test("a note column is made at its spot on the canvas, and unfolded", () => {
    const at = { kind: "canvas", canvas: R1_ID, after: C } as const
    expect(
      plan({ kind: "addColumn", make: { kind: "note-column" }, at }),
    ).toEqual([
      {
        kind: "moveCard",
        move: {
          card: NEW_NOTE_COLUMN,
          from: null,
          to: { kind: "canvas-at", canvas: R1_ID, after: C },
        },
        how: { actedAt: { kind: "column", key: NEW_NOTE_COLUMN }, slot: null },
        queuedBy: null,
        fly: false,
        here: null,
      },
      onR1({ kind: "fold", card: NEW_NOTE_COLUMN, unfolded: true }),
    ])
    expect(
      plan({
        kind: "addColumn",
        make: { kind: "note-column" },
        at: { ...at, after: null },
      })[0],
    ).toMatchObject({
      move: { to: { kind: "canvas-at", canvas: R1_ID, after: null } },
    })
  })

  test("a thread column is a new root opened at its spot on the canvas, @agent typed in an agent thread's, taking focus", () => {
    const at = { kind: "canvas", canvas: R1_ID, after: C } as const
    const made = (opens: "agent" | "chat") =>
      plan({ kind: "addColumn", make: { kind: "thread", opens }, at })
    expect(made("agent")).toEqual([
      { kind: "armFocus", key: { kind: "column", key: NEW_THREAD } },
      {
        kind: "request",
        intent: {
          kind: "open-thread",
          thread: NEW_THREAD,
          root: NEW_ROOT,
          canvas: R1_ID,
          start: { kind: "new-root", after: C },
        },
      },
      onR1({ kind: "opened", card: NEW_THREAD, prefill: AGENT_PREFILL }),
    ])
    expect(made("chat")[2]).toEqual(onR1({ kind: "opened", card: NEW_THREAD }))
  })

  test("a width is asked of the host, from the canvas the card is on; a card on none, nothing", () => {
    expect(plan({ kind: "cardWidth", card: C, width: 2 })).toEqual([
      {
        kind: "request",
        intent: {
          kind: "card-width",
          card: C,
          at: { kind: "canvas", canvas: R1_ID },
          width: 2,
        },
      },
    ])
    expect(plan({ kind: "cardWidth", card: F, width: 2 })).toEqual([])
  })

  test("a move reorders the column's card on the canvas, for everyone; a branch's or a new canvas's has nowhere to move", () => {
    const move = (card: CardId, to: number): Intent => ({
      kind: "moveColumn",
      column: { kind: "card", card },
      to,
    })
    const moveCanvas: Intent = {
      kind: "moveColumn",
      // @ts-expect-error: the canvas column has no place on the canvas to move from
      column: { kind: "canvas", canvas: R1_ID },
      to: 0,
    }
    expect(moveCanvas.kind).toBe("moveColumn")
    expect(plan(move(C, 0))).toEqual([
      {
        kind: "reorderCard",
        reorder: {
          card: C,
          at: { kind: "canvas", canvas: R1_ID },
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

    test("an entry no unfolded column shows unfolds its thread's, unmoving, revealed, which takes no focus", () => {
      // 4-c is a branch at 2-a: its card's column is folded.
      const effects = plan({ kind: "openAt", entry: entryId("4-c") })
      expect(effects[0]).toEqual({ kind: "reveal", entry: "4-c" })
      expect(effects.at(-1)).toEqual(
        onR1({ kind: "fold", card: C, unfolded: true }),
      )
      expect(effects.some(e => e.kind === "armFocus")).toBe(false)
    })

    test("a pick into an ask's work opens its fold before it is revealed", () => {
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

    test("copyThread: a copy lands after its source, or in your inventory; none into a full one or from no canvas", () => {
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
              to: { kind: "canvas-at", canvas: R1_ID, after: TRUNK },
            },
          },
        },
      ])
      expect(
        plan({ kind: "copyThread", source: TRUNK, to: "inventory" }),
      ).toMatchObject([
        { kind: "inventory", act: { kind: "show", how: "peek" } },
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
      ).toEqual(["inventory", "refuse"])
      const nowhere = {
        ...R1,
        canvases: {
          ...CANVASES,
          index: { ...CANVASES.index, canvasOfCard: new Map() },
        },
      }
      expect(
        plan({ kind: "copyThread", source: TRUNK, to: "here" }, nowhere),
      ).toEqual([])
    })

    test("put: a thread's card from your inventory lands unfolded just after the column it was put on", () => {
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
        {
          kind: "put",
          source: { kind: "card", card: LINKED },
          how: "move",
          target: { kind: "column", key: TRUNK },
        },
        state,
      )
      expect(effects[0]).toMatchObject({
        kind: "moveCard",
        move: {
          card: LINKED,
          from: { kind: "inventory", holder: ME },
          to: { kind: "canvas-at", canvas: R1_ID, after: TRUNK },
        },
      })
      expect(effects[1]).toMatchObject({ kind: "layout" })
    })

    test("openLink: an entry this tab holds opens as openAt does; another root is shown, and the entry once it arrives", () => {
      expect(
        plan({
          kind: "openLink",
          link: linkOn(ROOT_CANVAS("1-r1")),
          entry: entryId("3-b"),
        }),
      ).toEqual(plan({ kind: "openAt", entry: entryId("3-b") }))
      expect(
        plan({
          kind: "openLink",
          link: linkOn(ROOT_CANVAS("8-r9")),
          entry: entryId("9-far"),
        }),
      ).toEqual([
        ...shown("8-r9", R9_ID),
        { kind: "openWhenHeld", entry: "9-far" },
      ])
    })

    test("openLink: a thread in your inventory opens its preview there; one someone else holds, or with no card, nothing", () => {
      const mine = threadLink(LINKED, [inventoryOf(ME)], ME)
      const slots = { "4": LINKED }
      expect(
        plan(
          { kind: "openLink", link: mine, entry: entryId("3-b") },
          at(onRoot("1-r1"), indexAsks(index), { ...NO_CARDS, slots }),
        ),
      ).toEqual([
        { kind: "inventory", act: { kind: "show", how: "held" } },
        { kind: "inventory", act: { kind: "select", slot: 4 } },
        { kind: "inventory", act: { kind: "open" } },
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

  describe("cards", () => {
    const lane = threadIdFor("x")
    const where = atEntry(entryId("3-b"))
    const ada = writerId("ada@x.test")
    const c = cardIdFor("c1")
    const mine: TextCard = {
      kind: "text",
      id: cardIdFor("c105"),
      owner: ada,
      placer: ada,
      place: { kind: "composing", thread: lane },
      content: { command: null, unsent: null, origin: null },
    }
    const here = { kind: "column", key: F } as const
    const inColumn = { actedAt: here, slot: null }
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
    const withCard = (place: TextPlace) =>
      ({
        ...NO_CARDS,
        cards: [{ ...mine, id: c, place }],
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
    test("a reorder moves the card one place among the list as drawn; at an edge, or past a fact, nothing", () => {
      const q = (id: string, order: string) =>
        ({
          ...mine,
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
            card: mine.id,
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
            card: mine.id,
            from: null,
            to: { kind: "queued", thread: lane, seen: "" },
          },
          hold: "keep",
          command: "bring-up-to-date",
          how: inColumn,
        },
      ])
    })
    test("a card handed to its list is armed to take focus there", () => {
      expect(plan(column({ kind: "focusCard", card: mine.id }))).toEqual([
        { kind: "armFocus", key: { kind: "card", card: mine.id } },
      ])
    })
    test("+ add to queue makes its card held in the queue, its box armed to take focus", () => {
      expect(
        plan(
          column({
            kind: "queueNew",
            card: mine.id,
            command: null,
            hold: "hold-if-idle",
            lane,
            at: where,
          }),
        ),
      ).toEqual([
        {
          kind: "queueCard",
          move: {
            card: mine.id,
            from: null,
            to: { kind: "queued", thread: lane, seen: "" },
          },
          hold: "hold-if-idle",
          command: null,
          how: inColumn,
        },
        { kind: "armFocus", key: { kind: "card", card: mine.id } },
      ])
    })
    test("proposed changes' other buttons are one command each", () => {
      expect(
        plan(column({ kind: "proposed", lane, action: "squash", to: null })),
      ).toEqual([{ kind: "proposed", lane, action: "squash", to: null }])
    })
    test("continue on accepted work queues its own command", () => {
      expect(
        plan(
          column({
            kind: "queueNew",
            card: mine.id,
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

  test("rename and retitle are one request each, by canvas", () => {
    const canvas = ROOT_CANVAS("1-r1")
    expect(
      plan({ kind: "rename", of: { kind: "canvas", canvas }, title: "T" }),
    ).toEqual([
      {
        kind: "request",
        intent: { kind: "mark", of: { kind: "canvas", canvas }, title: "T" },
      },
    ])
    expect(plan({ kind: "retitle", canvas })).toEqual([
      { kind: "request", intent: { kind: "retitle", canvas } },
    ])
  })
})

test("afterCanvasMove: what follows a move runs only once the host accepts it; a refusal of its card's move is said on the board", () => {
  const moved: Effect[] = [
    {
      kind: "layout",
      moves: false,
      action: { kind: "closeCanvas", canvas: ROOT_CANVAS("1-r1") },
    },
  ]
  expect(afterCanvasMove({ kind: "moved" }, moved)).toBe(moved)
  expect(
    afterCanvasMove(
      { kind: "refused", code: ERR.CANVAS_BUSY, message: "no" },
      moved,
    ),
  ).toEqual([])
  expect(
    afterCanvasMove(
      {
        kind: "unmoved",
        code: "moved",
        place: { kind: "board", state: workflowStateIdFor("d") },
        by: writerId("bea@x.io"),
      },
      moved,
    ),
  ).toEqual([
    {
      kind: "refuse",
      refusal: {
        card: null,
        actedAt: { kind: "board" },
        code: "moved",
        by: writerId("bea@x.io"),
        fromQueue: false,
      },
    },
  ])
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

test("foldList asks for the width the sidebar does not show", () => {
  expect(plan({ kind: "foldList" }, { ...R1, listWidth: "full" })).toEqual([
    { kind: "listWidth", width: "icons" },
  ])
  expect(plan({ kind: "foldList" }, { ...R1, listWidth: "icons" })).toEqual([
    { kind: "listWidth", width: "full" },
  ])
})

describe("a page over the stage", () => {
  const onPage: IntentState = { ...R1, page: "profile" }
  const leave: Effect = { kind: "page", to: null }
  const r2: Intent = {
    kind: "show",
    here: { kind: "canvas", canvas: ROOT_CANVAS("5-r2") },
  }
  test("opening and leaving a page are the page effect", () => {
    expect(plan({ kind: "page", to: "profile" })).toEqual([
      { kind: "page", to: "profile" },
    ])
    expect(plan({ kind: "page", to: null }, onPage)).toEqual([leave])
  })
  test("showing a root, a new canvas or the board leaves the page first, once", () => {
    expect(plan(r2, onPage)).toEqual([leave, ...plan(r2)])
    const newCanvas: Intent = { kind: "newCanvas" }
    expect(plan(newCanvas, onPage)).toEqual([leave, ...plan(newCanvas)])
    const fromColumn = column({
      kind: "newCanvas",
      prefill: { text: "again", blank: false },
    })
    expect(plan(fromColumn, onPage)).toEqual([leave, ...plan(fromColumn)])
    const board: Intent = { kind: "board", open: true, focus: true }
    expect(plan(board, onPage)).toEqual([leave, ...plan(board)])
    const inbox: Intent = {
      kind: "openLink",
      link: linkOn(ROOT_CANVAS("5-r2")),
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

describe("a search over the root you are on", () => {
  const searching: IntentState = { ...R1, searching: true }
  const close: Effect = { kind: "search", act: { kind: "close" } }
  const openAt: Intent = { kind: "openAt", entry: entryId("3-b") }
  test("a search act is the search effect; opening opens on the canvas you are on, and on no canvas does nothing", () => {
    expect(plan({ kind: "search", act: { kind: "type", query: "x" } })).toEqual(
      [{ kind: "search", act: { kind: "type", query: "x" } }],
    )
    expect(plan({ kind: "search", act: { kind: "open" } })).toEqual([
      { kind: "search", act: { kind: "open", canvas: R1_ID } },
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
  test("another canvas, a new canvas, the board, a link or a new column close it too", () => {
    const r2: Intent = {
      kind: "show",
      here: { kind: "canvas", canvas: ROOT_CANVAS("5-r2") },
    }
    expect(plan(r2, searching)).toEqual([close, ...plan(r2)])
    const board: Intent = { kind: "board", open: true, focus: true }
    expect(plan(board, searching)).toEqual([close, ...plan(board)])
    const inbox: Intent = {
      kind: "openLink",
      link: linkOn(ROOT_CANVAS("5-r2")),
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

describe("a press on a proposal", () => {
  // The trunk's run, below 3-b, proposed three branches; it ended at 3-b.
  const RESULT = entryId("9-res")
  const PROPOSAL = {
    branches: [
      { title: "one", brief: "do one" },
      { title: "two", brief: "do two" },
      { title: "three", brief: "do three" },
    ],
  } as const
  const proposed = indexTree(
    entriesById([
      ...Object.values(index.entries),
      entry(
        "9-res",
        "3-b",
        {
          role: "toolResult",
          toolCallId: "c1",
          content: "ok",
          proposal: PROPOSAL,
        },
        { thread: TRUNK },
      ),
    ]),
  )
  const R1_CANVAS = ROOT_CANVAS("1-r1")
  const state = (cards: CardFacts = NO_CARDS, layout = onRoot("1-r1")) => ({
    ...at(layout, indexAsks(proposed), cards),
    index: proposed,
  })
  const press = (p: Extract<ColumnAct, { kind: "proposal" }>["press"]) =>
    column({ kind: "proposal", proposal: RESULT, press: p }, CARD_C)

  test("Start is one request, its threads minted in the rows' order, each with its brief as left", () => {
    const effects = plan(
      press({
        kind: "start",
        rows: [
          { row: 0, brief: "do one", edited: false },
          { row: 2, brief: "do three, carefully", edited: true },
        ],
      }),
      state(),
    )
    expect(effects).toEqual([
      {
        kind: "request",
        intent: {
          kind: "branch-out",
          how: "start",
          root: TEST_ROOT,
          canvas: R1_CANVAS,
          proposal: RESULT,
          branches: [
            { thread: BRANCHES[0], row: 0, brief: "do one" },
            { thread: BRANCHES[1], row: 2, brief: "do three, carefully" },
          ],
        },
      },
    ])
  })

  test("Open requests the rows, unfolds each column, starts an edited one with its edit, and focuses the first", () => {
    const effects = plan(
      press({
        kind: "open",
        rows: [
          { row: 0, brief: "do one", edited: false },
          { row: 1, brief: "do two now", edited: true },
        ],
      }),
      state(),
    )
    expect(effects[0]).toEqual({
      kind: "armFocus",
      key: { kind: "column", key: BRANCHES[0] },
    })
    expect(effects[1]).toMatchObject({
      kind: "request",
      intent: {
        how: "open",
        branches: [
          { thread: BRANCHES[0], row: 0 },
          { thread: BRANCHES[1], row: 1 },
        ],
      },
    })
    const opened = effects
      .slice(2)
      .map(e =>
        e.kind === "layout" &&
        e.action.kind === "view" &&
        e.action.change.kind === "opened"
          ? e.action.change
          : null,
      )
    expect(opened).toEqual([
      { kind: "opened", card: BRANCHES[0] },
      {
        kind: "opened",
        card: BRANCHES[1],
        prefill: { text: "@agent do two now", blank: false },
      },
    ])
  })

  test("Send sends each unsent thread's composer text: your card's, else its row's brief; a blank one not at all", () => {
    const [mine, untouched, cleared] = BRANCHES
    if (mine === undefined || untouched === undefined || cleared === undefined)
      throw new Error("three threads")
    const myCard = (id: string, thread: typeof mine): TextCard => ({
      kind: "text",
      id: cardIdFor(id),
      owner: ME,
      placer: ME,
      place: { kind: "composing", thread },
      content: { command: null, unsent: null, origin: null },
    })
    const texts = new Map([
      [cardIdFor("c-mine"), "@agent do one my way"],
      [cardIdFor("c-gone"), "  "],
    ])
    const cards = {
      ...NO_CARDS,
      cards: [myCard("c-mine", mine), myCard("c-gone", cleared)],
    }
    const effects = plan(
      press({
        kind: "send",
        fork: entryId("3-b"),
        threads: [
          { thread: mine, row: 0 },
          { thread: untouched, row: 1 },
          { thread: cleared, row: 2 },
        ],
      }),
      {
        ...state(cards),
        clips: { ...NO_CLIPS, textOf: id => texts.get(id) ?? "" },
      },
    )
    expect(effects.filter(e => e.kind === "send")).toEqual([
      {
        kind: "send",
        text: "@agent do one my way",
        at: { kind: "branch", thread: mine, at: "3-b", canvas: R1_CANVAS },
        card: cardIdFor("c-mine"),
      },
      {
        kind: "send",
        text: "@agent do two",
        at: { kind: "branch", thread: untouched, at: "3-b", canvas: R1_CANVAS },
        card: null,
      },
    ])
  })
})
