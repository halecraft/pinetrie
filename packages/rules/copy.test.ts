import {
  type CardRecord,
  entryId,
  INVENTORY_SLOTS,
  indexTree,
  rootIdFor,
  type ThreadRecord,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, fromParents, threadOfEntry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { type CopyThread, planCopy } from "./copy.ts"
import { threadCardOf } from "./task.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
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
  origin: { kind: "started" },
})
const threads = new Map([[SOURCE, record(SOURCE)]])
const onCanvas = threadCardOf({
  thread: SOURCE,
  task: TASK,
  by: ADA,
  cards: [],
})
const copy = (over: Partial<CopyThread> = {}): CopyThread => ({
  source: SOURCE,
  end: entryId("b"),
  move: {
    card: COPY,
    from: null,
    to: { kind: "canvas-at", task: TASK, after: SOURCE },
  },
  ...over,
})
const plan = (
  over: Partial<CopyThread> = {},
  cards: readonly CardRecord[] = [onCanvas],
  sender = ADA,
) => planCopy({ copy: copy(over), sender, cards, threads, index, now: 7 })

describe("planCopy (ADR-0117, ADR-0124)", () => {
  test("a copy is a new thread forked at the end its copier saw, its card where it was dropped, and no entry", () => {
    const planned = plan()
    expect(planned).toMatchObject({
      kind: "copy",
      record: {
        thread: COPY,
        root: ROOT,
        by: ADA,
        createdAt: 7,
        origin: { kind: "copy", source: SOURCE, fork: "b" },
      },
    })
    const card = planned.kind === "copy" ? planned.steps.at(-1) : undefined
    expect(card).toMatchObject({
      kind: "write",
      record: {
        kind: "thread",
        id: COPY,
        owner: ADA,
        placer: ADA,
        place: { kind: "canvas", task: TASK, width: 1 },
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

  test("refused: an end in another thread, or none; an id in use; a thread someone else holds; another's inventory, or a full one", () => {
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
          to: { kind: "canvas-at", task: TASK, after: null },
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
    ).toEqual({ kind: "refused", why: "not-yours" })
    const full = Array.from({ length: INVENTORY_SLOTS }, (_, n) => ({
      kind: "text" as const,
      id: cardIdFor(`f${n}`),
      owner: ADA,
      placer: ADA,
      place: { kind: "inventory" as const, holder: ADA },
      carries: { kind: "message" as const, command: null },
      unsent: null,
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
