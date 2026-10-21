import { canvasIdFor, ERR, THE_AGENT, writerId } from "@pinetrie/core"
import { cardIdOfKind } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { CARD_TITLE, type CardTitleRecord } from "./card-title.ts"
import { MARK, type MarkRecord, planMark } from "./mark.ts"
import { decodeRecords, deleteRecord, setRecord } from "./records.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const K1 = canvasIdFor("01a0ffd2-0000-7000-8000-000000000001")
const K2 = canvasIdFor("01a0ffd2-0000-7000-8000-000000000002")
const N1 = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-000000000003")
const I1 = cardIdOfKind("image", "01a0ffd2-0000-7000-8000-000000000004")
const T1 = cardIdOfKind("thread", "01a0ffd2-0000-7000-8000-000000000005")

const mark = (title: string): MarkRecord => ({
  canvas: K1,
  title,
  by: BEA,
  at: 1,
})
const titled = (title: string): CardTitleRecord => ({
  card: N1,
  title,
  by: BEA,
  at: 1,
})

const plan = (
  over: Partial<Parameters<typeof planMark>[0]> = {},
): ReturnType<typeof planMark> =>
  planMark({
    of: { kind: "canvas", canvas: K1 },
    title: "Tab names",
    by: ADA,
    now: 5,
    canvases: new Set([K1, K2]),
    marks: new Map(),
    titled: new Set([N1, I1, T1]),
    cardTitles: new Map(),
    ...over,
  })

describe("the records", () => {
  test("a canvas's title round-trips at its canvas; a malformed one is dropped", () => {
    const r = mark("Tab names")
    expect(MARK.home).toBe("session")
    expect(MARK.decode(MARK.encode(r), r.canvas)).toEqual(r)
    expect(MARK.decode({ ...r, title: "" }, r.canvas)).toBeUndefined()
    expect(MARK.decode(r, "r1")).toBeUndefined()
    expect(
      decodeRecords(MARK, [
        { key: r.canvas, value: r },
        { key: K2, value: { nope: 1 } },
      ]).get(K1),
    ).toEqual(r)
  })
  test("a card's title round-trips at its card, in the session; a key that is no titled card is dropped", () => {
    const r = titled("Ideas")
    expect(CARD_TITLE.home).toBe("session")
    expect(CARD_TITLE.decode(CARD_TITLE.encode(r), r.card)).toEqual(r)
    expect(CARD_TITLE.decode(CARD_TITLE.encode(r), I1)).toEqual({
      ...r,
      card: I1,
    })
    expect(CARD_TITLE.decode(CARD_TITLE.encode(r), K1)).toBeUndefined()
    expect(
      CARD_TITLE.decode({ title: "", by: BEA, at: 1 }, r.card),
    ).toBeUndefined()
  })
})

describe("planMark", () => {
  test("titles a canvas, by its writer, at now", () => {
    expect(plan()).toEqual({
      kind: "writes",
      writes: [
        setRecord(MARK, { canvas: K1, title: "Tab names", by: ADA, at: 5 }),
      ],
    })
  })
  test("replaces another title: the last write wins", () => {
    expect(plan({ marks: new Map([[K1, mark("Old")]]) })).toEqual({
      kind: "writes",
      writes: [
        setRecord(MARK, { canvas: K1, title: "Tab names", by: ADA, at: 5 }),
      ],
    })
  })
  test("the title already stored writes nothing", () => {
    expect(plan({ marks: new Map([[K1, mark("Tab names")]]) })).toEqual({
      kind: "unchanged",
    })
  })
  test("clearing a title removes its record", () => {
    expect(plan({ title: null, marks: new Map([[K1, mark("Old")]]) })).toEqual({
      kind: "writes",
      writes: [deleteRecord(MARK, K1)],
    })
  })
  test("clearing a canvas with no title writes nothing", () => {
    expect(plan({ title: null })).toEqual({ kind: "unchanged" })
  })
  test("a canvas the session does not hold is refused", () => {
    expect(
      plan({
        of: {
          kind: "canvas",
          canvas: canvasIdFor("01a0ffd2-0000-7000-8000-000000000009"),
        },
      }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  })
  test("titles a card in the card's title record, and clears it there", () => {
    const of = { kind: "card", card: N1 } as const
    expect(plan({ of, title: "Ideas" })).toEqual({
      kind: "writes",
      writes: [
        setRecord(CARD_TITLE, { card: N1, title: "Ideas", by: ADA, at: 5 }),
      ],
    })
    expect(
      plan({
        of,
        title: null,
        cardTitles: new Map([[N1, titled("Ideas")]]),
      }),
    ).toEqual({ kind: "writes", writes: [deleteRecord(CARD_TITLE, N1)] })
    expect(
      plan({
        of,
        title: "Ideas",
        cardTitles: new Map([[N1, titled("Ideas")]]),
      }),
    ).toEqual({ kind: "unchanged" })
  })
  test("a card in no titled place is refused", () => {
    expect(
      plan({ of: { kind: "card", card: N1 }, titled: new Set() }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  })
  test("a person titles a thread, and clears its title", () => {
    const of = { kind: "card", card: T1 } as const
    expect(plan({ of, title: "Fix the sync bug" })).toEqual({
      kind: "writes",
      writes: [
        setRecord(CARD_TITLE, {
          card: T1,
          title: "Fix the sync bug",
          by: ADA,
          at: 5,
        }),
      ],
    })
    expect(
      plan({
        of,
        title: null,
        cardTitles: new Map([
          [T1, { card: T1, title: "Fix the sync bug", by: BEA, at: 1 }],
        ]),
      }),
    ).toEqual({ kind: "writes", writes: [deleteRecord(CARD_TITLE, T1)] })
  })
  test("the agent never titles a thread", () => {
    expect(
      plan({ of: { kind: "card", card: T1 }, by: THE_AGENT }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  })
  test("the agent titles an image, never a note column", () => {
    expect(
      plan({ of: { kind: "card", card: N1 }, by: THE_AGENT }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
    expect(
      plan({ of: { kind: "card", card: I1 }, by: THE_AGENT, title: "Logo" }),
    ).toEqual({
      kind: "writes",
      writes: [
        setRecord(CARD_TITLE, {
          card: I1,
          title: "Logo",
          by: THE_AGENT,
          at: 5,
        }),
      ],
    })
  })
})
