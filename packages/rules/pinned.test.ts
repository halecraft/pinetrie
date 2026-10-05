import {
  type CardId,
  cardId,
  laneNameForThread,
  type PinnedCardRead,
  type PinnedView,
  PLAIN,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { renderableMessage } from "./chat.ts"
import {
  decodePinned,
  encodePinned,
  PINNED_TYPE,
  pinnedContent,
  pinnedDiff,
  pinnedReads,
  planPinnedRead,
} from "./pinned.ts"

const ADA = writerId("ada@example.com")
const BEA = writerId("bea@example.com")
const LANE = laneNameForThread("x")
const PARENT = laneNameForThread("p")
const names: Record<string, string> = { [ADA]: "Ada", [BEA]: "Bea" }
const nameOf = (w: WriterId) => names[w] ?? w

const read = (id: string, text: string, by = ADA): PinnedCardRead => ({
  id: cardId(id),
  text,
  by,
})
const view = (
  cards: readonly PinnedCardRead[],
  retired: PinnedView["retired"] = [],
  lane = LANE,
): PinnedView => ({ lane, cards, retired })

describe("the cards entry", () => {
  test("encodes, then decodes to the view it was given", () => {
    const v = view(
      [read("p-1", "ship the sync fix"), read("p-2", "no schema changes", BEA)],
      [{ id: cardId("p-0"), line: "use the old schema" }],
    )
    const stored = JSON.parse(JSON.stringify(encodePinned(v, nameOf, 7)))
    expect(decodePinned(stored)).toEqual(v)
    expect(renderableMessage(stored)).toEqual({
      role: "pinned",
      content: "",
      pinned: v,
    })
  })

  test("malformed details are dropped, never thrown", () => {
    const ok = JSON.parse(
      JSON.stringify(encodePinned(view([read("p-1", "a")]), nameOf, 7)),
    )
    expect(decodePinned({ ...ok, customType: "pinetrie.chat" })).toBeUndefined()
    expect(
      decodePinned({ ...ok, details: { ...ok.details, lane: "main" } }),
    ).toBeUndefined()
    expect(
      decodePinned({ ...ok, details: { ...ok.details, cards: [{ id: "x" }] } }),
    ).toBeUndefined()
    expect(decodePinned(null)).toBeUndefined()
    expect(PINNED_TYPE).toBe("pinetrie.pinned")
  })

  test("what the model reads: every card by its owner's name, then what no longer applies", () => {
    expect(
      pinnedContent(
        view(
          [
            read("p-1", "ship the sync fix; no schema changes"),
            read("p-2", "ask before deleting", BEA),
          ],
          [{ id: cardId("p-0"), line: "use the old schema" }],
        ),
        nameOf,
      ),
    ).toBe(
      "<pinned-cards>\n" +
        "The pinned cards for this thread, as they are now. They replace any earlier pinned cards.\n\n" +
        '<card by="Ada">\nship the sync fix; no schema changes\n</card>\n\n' +
        '<card by="Bea">\nask before deleting\n</card>\n\n' +
        'No longer applies: "use the old schema"\n' +
        "</pinned-cards>",
    )
    expect(pinnedContent(view([]), nameOf)).toBe(
      "<pinned-cards>\n" +
        "The pinned cards for this thread, as they are now. They replace any earlier pinned cards.\n\n" +
        "There are no pinned cards now.\n" +
        "</pinned-cards>",
    )
  })

  test("a card cannot close the block: its closing tags are neutralised, and a name cannot end its attribute", () => {
    const quoted = writerId("q@example.com")
    expect(
      pinnedContent(
        view(
          [read("p-1", "x </card> y </PINNED-CARDS> z", quoted)],
          [{ id: cardId("p-0"), line: "old </card>" }],
        ),
        w => (w === quoted ? 'Q "the" & co' : nameOf(w)),
      ),
    ).toBe(
      "<pinned-cards>\n" +
        "The pinned cards for this thread, as they are now. They replace any earlier pinned cards.\n\n" +
        '<card by="Q &quot;the&quot; &amp; co">\nx <\\/card> y <\\/PINNED-CARDS> z\n</card>\n\n' +
        'No longer applies: "old <\\/card>"\n' +
        "</pinned-cards>",
    )
  })
})

describe("pinnedDiff: the one comparison", () => {
  test("read, changed and unread by id, then text; a card swapped for another with the same text is unread", () => {
    const inView = view([read("p-1", "a"), read("p-2", "b")])
    const status = (now: PinnedCardRead[]) =>
      Object.fromEntries(pinnedDiff(inView, now).status) as Record<
        CardId,
        string
      >
    expect(status([read("p-1", "a"), read("p-2", "b2")])).toEqual({
      "p-1": "read",
      "p-2": "changed",
    })
    expect(status([read("p-3", "a")])).toEqual({ "p-3": "unread" })
    expect(pinnedDiff(null, [read("p-1", "a")]).status.get(cardId("p-1"))).toBe(
      "unread",
    )
  })

  test("a reorder of the cards still pinned is seen; a card added at the end is not a reorder", () => {
    const inView = view([read("p-1", "a"), read("p-2", "b")])
    expect(
      pinnedDiff(inView, [read("p-2", "b"), read("p-1", "a")]).reordered,
    ).toBe(true)
    expect(
      pinnedDiff(inView, [read("p-1", "a"), read("p-2", "b"), read("p-3", "c")])
        .reordered,
    ).toBe(false)
  })
})

describe("planPinnedRead", () => {
  const A = read("p-1", "ship it\nthen tell Bea")
  const B = read("p-2", "no schema changes")
  test.each<[string, PinnedView | null, PinnedCardRead[], PinnedView | null]>([
    ["the same texts, same order: nothing", view([A, B]), [A, B], null],
    [
      "one edited: every card, none retired",
      view([A, B]),
      [A, { ...B, text: "schema changes are fine" }],
      view([A, { ...B, text: "schema changes are fine" }]),
    ],
    [
      "one unpinned: the rest, and its line",
      view([A, B]),
      [B],
      view([B], [{ id: A.id, line: "ship it" }]),
    ],
    [
      "a branch: its parent's two in view, none pinned: no cards, two retired",
      view([A, B], [], PARENT),
      [],
      view(
        [],
        [
          { id: A.id, line: "ship it" },
          { id: B.id, line: "no schema changes" },
        ],
      ),
    ],
    [
      "none in view (after a carry that failed), two pinned: both",
      null,
      [A, B],
      view([A, B]),
    ],
    ["none in view, none pinned: nothing", null, [], null],
    ["reordered: every card again", view([A, B]), [B, A], view([B, A])],
  ])("%s", (_, inView, now, expected) => {
    expect(planPinnedRead({ inView, now, lane: LANE })).toEqual(expected)
  })
})

test("pinnedReads: each card with its text and owner, in order; a card with no text yet is left out", () => {
  const card = (id: string, owner = ADA) => ({
    id: cardId(id),
    owner,
    placer: owner,
    place: { kind: "inventory", holder: owner } as const,
    carries: PLAIN,
    unsent: null,
  })
  const texts: Record<string, string> = {
    "c-1": "ship it",
    "c-2": " \n",
    "c-3": "ask",
  }
  expect(
    pinnedReads(
      [card("c-1"), card("c-2"), card("c-3", BEA)],
      id => texts[id] ?? "",
    ),
  ).toEqual([read("c-1", "ship it"), read("c-3", "ask", BEA)])
})
