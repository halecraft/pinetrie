import {
  canvasIdFor,
  entryId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CardRecord,
  INVENTORY_SLOTS,
  indexTree,
  type ThreadRecord,
  type TitledCardId,
  UNTICKED,
} from "@pinetrie/threads"
import {
  cardIdFor,
  fromParents,
  threadOfEntry,
} from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { CARD_TITLE, type CardTitleRecord } from "./card-title.ts"
import { type CopyThread, planCopy } from "./copy.ts"
import { landedThreadCard } from "./fixtures.ts"
import { setRecord } from "./records.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
// r -> a -> b: thread `r` ends at b; c, a branch at a, starts thread `c`.
const index = indexTree(fromParents({ r: null, a: "r", b: "a", c: "a" }))
const SOURCE = threadOfEntry("r")
const COPY = threadIdFor("copy")
const record = (thread: typeof SOURCE): ThreadRecord => ({
  thread,
  root: ROOT,
  by: ADA,
  createdAt: 1,
  origin: { kind: "root" },
})
const threads = new Map([[SOURCE, record(SOURCE)]])
const onCanvas = landedThreadCard({
  thread: SOURCE,
  canvas: CANVAS,
  by: ADA,
  cards: [],
})
const copy = (over: Partial<CopyThread> = {}): CopyThread => ({
  source: SOURCE,
  end: entryId("b"),
  move: {
    card: COPY,
    from: null,
    to: { kind: "canvas-at", canvas: CANVAS, after: SOURCE },
  },
  ...over,
})
const plan = (
  over: Partial<CopyThread> = {},
  cards: readonly CardRecord[] = [onCanvas],
  sender = ADA,
  titles: ReadonlyMap<TitledCardId, CardTitleRecord> = new Map(),
) =>
  planCopy({ copy: copy(over), sender, cards, threads, titles, index, now: 7 })

describe("planCopy", () => {
  test("a copy is a new thread forked at the end its copier saw, its card where it was dropped, and no entry", () => {
    const planned = plan()
    expect(planned).toMatchObject({
      kind: "copy",
      records: [
        {
          namespace: "pinetrie.thread",
          key: COPY,
          value: {
            root: ROOT,
            by: ADA,
            createdAt: 7,
            origin: { kind: "fork", at: "b", how: "copy" },
          },
        },
      ],
    })
    const card = planned.kind === "copy" ? planned.steps.at(-1) : undefined
    expect(card).toMatchObject({
      kind: "write",
      record: {
        kind: "thread",
        id: COPY,
        owner: ADA,
        placer: ADA,
        place: { kind: "canvas", canvas: CANVAS, width: 1 },
        content: UNTICKED,
      },
    })
    // Into the copier's own inventory.
    expect(
      plan({
        move: {
          card: COPY,
          from: null,
          to: { kind: "inventory", holder: ADA },
        },
      }),
    ).toMatchObject({ kind: "copy" })
  })

  test("a titled source's copy has its title, naming who set it; an untitled one's has none", () => {
    const titles = new Map<TitledCardId, CardTitleRecord>([
      [SOURCE, { card: SOURCE, title: "The parser", by: BEA, at: 1 }],
    ])
    const planned = plan({}, [onCanvas], ADA, titles)
    expect(planned.kind === "copy" ? planned.records.at(-1) : null).toEqual(
      setRecord(CARD_TITLE, {
        card: COPY,
        title: "The parser",
        by: BEA,
        at: 7,
      }),
    )
    const untitled = plan()
    expect(
      untitled.kind === "copy"
        ? untitled.records.some(r => r.namespace === CARD_TITLE.namespace)
        : null,
    ).toBe(false)
  })

  test("refused: an end elsewhere, an id in use, a held thread, or another's or a full inventory", () => {
    expect(plan({ end: entryId("c") })).toEqual({
      kind: "refused",
      why: "unknown",
    })
    expect(plan({ end: entryId("x") })).toEqual({
      kind: "refused",
      why: "unknown",
    })
    expect(
      plan({
        move: {
          card: SOURCE,
          from: null,
          to: { kind: "canvas-at", canvas: CANVAS, after: null },
        },
      }),
    ).toEqual({ kind: "refused", why: "taken" })
    const held = {
      ...onCanvas,
      place: { kind: "inventory", holder: BEA },
    } as const
    expect(plan({}, [held])).toEqual({ kind: "refused", why: "held" })
    // Your own held thread copies.
    expect(plan({}, [held], BEA).kind).toBe("copy")
    expect(
      plan({
        move: {
          card: COPY,
          from: null,
          to: { kind: "inventory", holder: BEA },
        },
      }),
    ).toEqual({ kind: "refused", why: "someone-elses" })
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, n) => ({
      kind: "text" as const,
      id: cardIdFor(`f${n}`),
      owner: ADA,
      placer: ADA,
      place: { kind: "inventory" as const, holder: ADA },
      content: { command: null, unsent: null, origin: null },
    }))
    expect(
      plan(
        {
          move: {
            card: COPY,
            from: null,
            to: { kind: "inventory", holder: ADA },
          },
        },
        [onCanvas, ...full],
      ),
    ).toEqual({ kind: "refused", why: "full" })
  })
})
