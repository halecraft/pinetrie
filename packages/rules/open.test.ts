import {
  type CardId,
  canvasIdFor,
  entryId,
  indexTree,
  livePlace,
  rootIdFor,
  type ThreadRecord,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { canvasCard, fromParents, threadOfEntry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { unstartedThreads } from "./canvas-index.ts"
import { landedThreadCard } from "./fixtures.ts"
import { planOpenThread } from "./open.ts"
import { emptiedCanvases, planCanvasesTrashed } from "./root.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const ADA = writerId("ada@x.io")
// r -> a -> b: thread `r`; c, a branch at a, starts thread `c`.
const index = indexTree(fromParents({ r: null, a: "r", b: "a", c: "a" }))
const R = threadOfEntry("r")
const NEW = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const record = (thread: typeof R, root = ROOT): ThreadRecord => ({
  thread,
  root,
  by: ADA,
  createdAt: 1,
  origin: { kind: "root" },
})
const onCanvas = landedThreadCard({
  thread: R,
  canvas: CANVAS,
  by: ADA,
  cards: [],
})
const STATE = workflowStateIdFor("d")
const WORKFLOW = {
  open: [{ id: STATE, name: "Doing" }],
  archive: { id: workflowStateIdFor("x"), name: "Done" },
}
const BRANCH = { kind: "branch", at: entryId("b"), index } as const
const plan = (
  open: Partial<Parameters<typeof planOpenThread>[0]["open"]> = {},
  over: Partial<Parameters<typeof planOpenThread>[0]> = {},
) =>
  planOpenThread({
    open: { thread: NEW, root: ROOT, canvas: CANVAS, ...open },
    start: BRANCH,
    sender: ADA,
    cards: [onCanvas],
    threads: new Map([[R, record(R)]]),
    roots: new Set([ROOT]),
    canvases: new Set([CANVAS]),
    workflow: WORKFLOW,
    now: 7,
    ...over,
  })
const newTab = (state: typeof STATE | null = null) =>
  ({ start: { kind: "new-canvas", state } }) as const
const newRoot = (after: CardId | null) =>
  ({ start: { kind: "new-root", after } }) as const

describe("planOpenThread", () => {
  test("a branch: its record forks at its entry, its card just after the thread it forks from, and no canvas is written", () => {
    const opened = plan()
    expect(opened.kind).toBe("open")
    if (opened.kind !== "open") return
    expect(opened.records).toMatchObject([
      {
        namespace: "pinetrie.thread",
        key: NEW,
        value: {
          root: ROOT,
          by: ADA,
          createdAt: 7,
          origin: { kind: "fork", at: "b", how: "branch" },
        },
      },
    ])
    expect(opened.steps.at(-1)).toMatchObject({
      kind: "write",
      record: {
        kind: "thread",
        id: NEW,
        place: { kind: "canvas", canvas: CANVAS, width: 1 },
      },
    })
  })

  test("a branch a column opens records no proposal", () => {
    const opened = plan()
    expect(
      opened.kind === "open" && opened.records[0]?.kind === "set"
        ? opened.records[0].value
        : undefined,
    ).toMatchObject({ origin: { how: "branch" } })
    expect(
      opened.kind === "open" && opened.records[0]?.kind === "set"
        ? (opened.records[0].value as { origin: object }).origin
        : {},
    ).not.toHaveProperty("proposal")
  })

  test("a new canvas: a new root's first thread, in a new canvas whose card ends its state", () => {
    const opened = plan({ root: NEW_ROOT, canvas: NEW_CANVAS }, newTab(STATE))
    expect(
      opened.kind === "open" && opened.records.map(r => r.namespace),
    ).toEqual(["pinetrie.thread"])
    expect(opened.kind === "open" && opened.records[0]).toMatchObject({
      value: { root: NEW_ROOT, origin: { kind: "root" } },
    })
    expect(opened.kind === "open" && opened.steps[0]).toMatchObject({
      record: {
        kind: "canvas",
        id: NEW_CANVAS,
        owner: ADA,
        place: { kind: "board", state: STATE },
      },
    })
    expect(opened.kind === "open" && opened.steps.at(-1)).toMatchObject({
      record: { id: NEW, place: { kind: "canvas", canvas: NEW_CANVAS } },
    })
  })

  test("a new canvas before the board has states is refused", () => {
    expect(
      plan(
        { root: NEW_ROOT, canvas: NEW_CANVAS },
        { ...newTab(), workflow: null },
      ),
    ).toEqual({ kind: "refused", why: "no-place" })
  })

  test("a new root in a canvas the session holds: its card where a drop after `after` lands, and no canvas is written", () => {
    const ranked = (after: CardId | null) => {
      const opened = plan({ root: NEW_ROOT }, newRoot(after))
      if (opened.kind !== "open") throw new Error(opened.why)
      expect(opened.records).toMatchObject([
        { value: { root: NEW_ROOT, origin: { kind: "root" } } },
      ])
      expect(opened.steps).toHaveLength(1)
      const [made] = opened.steps
      if (made?.kind !== "write" || made.record.place.kind !== "canvas")
        throw new Error("not made on a canvas")
      expect(made.record.place.canvas).toBe(CANVAS)
      return made.record.place.order
    }
    const existing =
      onCanvas.place.kind === "canvas" ? onCanvas.place.order : ""
    expect(ranked(R) > existing).toBe(true)
    expect(ranked(null) < existing).toBe(true)
    // A card that has left the canvas: at its end.
    expect(ranked(threadIdFor("gone")) > existing).toBe(true)
  })

  test.each([
    ["its id names a recorded thread", plan({ thread: R }), "taken"],
    [
      "its entry is in no root it holds",
      plan({}, { start: { ...BRANCH, at: entryId("x") } }),
      "unknown",
    ],
    [
      "its canvas is not the session's",
      plan({ canvas: NEW_CANVAS }),
      "unknown",
    ],
    [
      "a new canvas's root is in use",
      plan({ canvas: NEW_CANVAS }, newTab()),
      "taken",
    ],
    [
      "a new canvas's id is in use",
      plan({ root: NEW_ROOT }, newTab()),
      "taken",
    ],
    ["a new root is in use", plan({}, newRoot(null)), "taken"],
    [
      "a new root's canvas is not the session's",
      plan({ root: NEW_ROOT, canvas: NEW_CANVAS }, newRoot(null)),
      "unknown",
    ],
  ] as const)("refused: %s", (_, planned, why) => {
    expect(planned).toEqual({ kind: "refused", why })
  })
})

describe("unstartedThreads", () => {
  test("a thread with no entry: a branch at its fork when its fork is held here", () => {
    const threads = new Map<typeof R, ThreadRecord>([
      [R, record(R)],
      [
        NEW,
        {
          ...record(NEW),
          origin: { kind: "fork", at: entryId("b"), how: "branch" },
        },
      ],
      [threadIdFor("tab"), record(threadIdFor("tab"), NEW_ROOT)],
      [
        threadIdFor("far"),
        {
          ...record(threadIdFor("far")),
          origin: { kind: "fork", at: entryId("far"), how: "copy" },
        },
      ],
    ])
    expect(unstartedThreads(threads, index, new Set([ROOT]), ADA)).toEqual(
      new Map([
        [NEW, { root: ROOT, fork: "b" }],
        [threadIdFor("tab"), { root: NEW_ROOT, fork: null }],
      ]),
    )
    // Its first entry written, and its root in the directory: started.
    expect(
      unstartedThreads(threads, index, new Set([ROOT, NEW_ROOT]), ADA).has(
        threadIdFor("tab"),
      ),
    ).toBe(false)
  })
})

describe("closing a new canvas before its first send", () => {
  const tab = landedThreadCard({
    thread: NEW,
    canvas: NEW_CANVAS,
    by: ADA,
    cards: [],
  })
  const trashed = {
    ...tab,
    place: { kind: "trash", left: livePlace(tab.place) },
  } as const
  const threads = new Map([[NEW, record(NEW, NEW_ROOT)]])
  test("its thread trashed, the empty canvas's card goes to the closer's trash, remembering the canvas", () => {
    expect(
      emptiedCanvases({
        before: [tab],
        after: [trashed],
        threads,
        started: new Set([ROOT]),
      }),
    ).toEqual([NEW_CANVAS])
    const card = canvasCard(NEW_CANVAS)
    expect(
      planCanvasesTrashed([card, canvasCard(CANVAS)], [NEW_CANVAS], ADA),
    ).toEqual([
      {
        kind: "write",
        record: {
          ...card,
          place: { kind: "trash", left: livePlace(card.place) },
          placer: ADA,
        },
      },
    ])
  })
  test("never a canvas that holds another card, nor one whose root has started, nor a branch's", () => {
    const other = landedThreadCard({
      thread: R,
      canvas: NEW_CANVAS,
      by: ADA,
      cards: [tab],
    })
    const cases = [
      { after: [trashed, other] },
      { started: new Set([NEW_ROOT]) },
      {
        threads: new Map([
          [
            NEW,
            {
              ...record(NEW, NEW_ROOT),
              origin: { kind: "fork", at: entryId("b"), how: "branch" },
            } as ThreadRecord,
          ],
        ]),
      },
    ]
    for (const over of cases)
      expect(
        emptiedCanvases({
          before: [tab],
          after: [trashed],
          threads,
          started: new Set([ROOT]),
          ...over,
        }),
      ).toEqual([])
  })
})
