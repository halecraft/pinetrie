import {
  canvasIdFor,
  entryId,
  rootIdFor,
  snapshotId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CardRecord,
  type Gated,
  livePlace,
  type SendAt,
  UNTICKED,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  foreignIn,
  notOnCanvasIn,
  runsIn,
  runThreads,
  takenIn,
  threadSetAside,
} from "./set-aside.ts"

/** `notOnCanvasIn` over `runThreads`: the gate's two steps, as it takes them. */
const setAsideAt = (
  at: Parameters<typeof runThreads>[0],
  cards: Parameters<typeof notOnCanvasIn>[1],
  entryThread: Parameters<typeof runThreads>[1],
  forkOf: Parameters<typeof runThreads>[2],
) => notOnCanvasIn(runThreads(at, entryThread, forkOf), cards)

const T = threadIdFor("t")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const BEA = writerId("bea@x.io")
const said = (at: SendAt): Gated => ({
  kind: "send",
  text: "x",
  root: ROOT,
  at,
  mentions: [],
  card: null,
  pinned: [],
  base: null,
  state: null,
})

describe("runsIn: what each command runs or writes a message in", () => {
  test.each([
    [
      "a send at a thread's end: the thread",
      said({ kind: "end", thread: T, seen: entryId("e") }),
      [{ kind: "thread", thread: T }],
    ],
    [
      "a branch: the entry it forks at, in its root",
      said({
        kind: "branch",
        thread: threadIdFor("n"),
        at: entryId("e"),
        canvas: CANVAS,
      }),
      [{ kind: "entry", root: ROOT, entry: "e", starts: threadIdFor("n") }],
    ],
    [
      "a new root: nothing",
      said({
        kind: "branch",
        thread: threadIdFor("n"),
        at: null,
        canvas: CANVAS,
      }),
      [],
    ],
    [
      "a carry-on: its lane",
      { kind: "carry-on", lane: T },
      [{ kind: "thread", thread: T }],
    ],
    [
      "proposed changes' description, asked of its agent",
      { kind: "proposed", lane: T, action: "describe", to: null, seen: null },
      [{ kind: "thread", thread: T }],
    ],
    [
      "proposed changes' refresh, which may ask for a description",
      { kind: "proposed", lane: T, action: "refresh", to: null, seen: null },
      [{ kind: "thread", thread: T }],
    ],
    [
      "an acceptance: your repo alone",
      { kind: "proposed", lane: T, action: "accept", to: null, seen: null },
      [],
    ],
    [
      "a popped send: its thread",
      said({ kind: "queue", thread: T }),
      [{ kind: "thread", thread: T }],
    ],
    ["a stop: nothing", { kind: "stop", lane: T }, []],
  ] as const)("%s", (_, command, at) => {
    expect(runsIn(command as Gated)).toEqual(at)
  })

  test("notOnCanvasIn: the first thread among them in someone's inventory, an entry's by its tree", () => {
    const inInventory: CardRecord[] = [
      {
        kind: "thread",
        id: T,
        owner: BEA,
        placer: BEA,
        place: { kind: "inventory", holder: BEA },
        content: UNTICKED,
      },
    ]
    const none = new Map()
    expect(
      setAsideAt(
        [{ kind: "thread", thread: T }],
        inInventory,
        () => null,
        none,
      ),
    ).toEqual({ thread: T, setAside: { kind: "in-inventory", holder: BEA } })
    const COPY = threadIdFor("copy")
    const branch = {
      kind: "entry",
      root: ROOT,
      entry: entryId("e"),
      starts: COPY,
    } as const
    expect(setAsideAt([branch], inInventory, () => T, none)).toEqual({
      thread: T,
      setAside: { kind: "in-inventory", holder: BEA },
    })
    // A copy's first send, at its record's fork, runs in the copy.
    expect(
      setAsideAt(
        [branch],
        inInventory,
        () => T,
        new Map([[COPY, { kind: "fork", at: entryId("e"), how: "copy" }]]),
      ),
    ).toBeNull()
    expect(
      setAsideAt([{ kind: "thread", thread: T }], [], () => null, none),
    ).toBeNull()
  })
})

test("foreignIn: a run on a lane of another kind, a thread's own or the one a send at an entry clones", () => {
  const COPY = threadIdFor("copy")
  const lane = (history: "jj" | "folder") => ({
    lane: T,
    root: ROOT,
    history,
    by: BEA,
    createdAt: 0,
  })
  const above = {
    lane: T,
    point: null,
    pointLane: null,
    snapshot: snapshotId("e"),
    snapshotLane: T,
  }
  const facts = (history: "jj" | "folder", kind: "jj" | null = "jj") => ({
    lanes: new Map([[T, lane(history)]]),
    kind,
    aboveAt: () => above,
  })
  const thread = { kind: "thread", thread: T } as const
  // A copy's first send, at the copied thread's entry: the copy's lane would
  // clone T's disk, whatever the copy's own record.
  const copy = {
    kind: "entry",
    root: ROOT,
    entry: entryId("e"),
    starts: COPY,
  } as const
  expect(foreignIn([thread], facts("folder"))).toEqual({
    kind: "foreign",
    lane: T,
    history: "folder",
  })
  expect(foreignIn([copy], facts("folder"))).toEqual({
    kind: "foreign",
    lane: COPY,
    history: "folder",
  })
  expect(foreignIn([thread, copy], facts("jj"))).toBeNull()
  expect(foreignIn([thread, copy], facts("folder", null))).toBeNull()
})

test("takenIn: the threads a change puts in an inventory that were not in one", () => {
  const on: CardRecord = {
    kind: "thread",
    id: T,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", canvas: CANVAS, order: "1", width: 1 },
    content: UNTICKED,
  }
  const away: CardRecord = { ...on, place: { kind: "inventory", holder: BEA } }
  expect(takenIn([on], [away])).toEqual([T])
  expect(takenIn([away], [away])).toEqual([])
  expect(takenIn([away], [on])).toEqual([])
})

test("a trashed thread is in nobody's inventory, but trashing it stops its run and a command in it is refused", () => {
  const on: CardRecord = {
    kind: "thread",
    id: T,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", canvas: CANVAS, order: "1", width: 1 },
    content: UNTICKED,
  }
  const trashed: CardRecord = {
    ...on,
    place: { kind: "trash", left: livePlace(on.place) },
  }
  expect(takenIn([on], [trashed])).toEqual([T])
  expect(takenIn([trashed], [trashed])).toEqual([])
  expect(threadSetAside([trashed], T)).toEqual({ kind: "trashed" })
  expect(
    setAsideAt(
      [{ kind: "thread", thread: T }],
      [trashed],
      () => null,
      new Map(),
    ),
  ).toEqual({ thread: T, setAside: { kind: "trashed" } })
})

test("threadSetAside: nothing keeps a thread on a canvas, or with no card, from running", () => {
  const on: CardRecord = {
    kind: "thread",
    id: T,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", canvas: CANVAS, order: "1", width: 1 },
    content: UNTICKED,
  }
  expect(threadSetAside([on], T)).toBeNull()
  expect(threadSetAside([], T)).toBeNull()
  expect(
    threadSetAside([{ ...on, place: { kind: "inventory", holder: BEA } }], T),
  ).toEqual({ kind: "in-inventory", holder: BEA })
})
