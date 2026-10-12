import {
  type CardRecord,
  entryId,
  type Intent,
  livePlaceOf,
  NO_CONTENT,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  heldIn,
  holdingOf,
  holdingWords,
  runsIn,
  TRASHED_WORDS,
  takenIn,
} from "./held.ts"

const T = threadIdFor("t")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const BEA = writerId("bea@x.io")
const chat = (at: Extract<Intent, { kind: "chat" }>["at"]): Intent => ({
  kind: "chat",
  text: "x",
  root: ROOT,
  at,
  asksAgent: false,
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
      chat({ kind: "end", thread: T, seen: entryId("e") }),
      [{ kind: "thread", thread: T }],
    ],
    [
      "a branch: the entry it forks at, in its root",
      chat({
        kind: "branch",
        thread: threadIdFor("n"),
        at: entryId("e"),
        task: TASK,
      }),
      [{ kind: "entry", root: ROOT, entry: "e", starts: threadIdFor("n") }],
    ],
    [
      "a new root: nothing",
      chat({ kind: "branch", thread: threadIdFor("n"), at: null, task: TASK }),
      [],
    ],
    [
      "a carry-on: its lane",
      { kind: "carry-on", lane: T },
      [{ kind: "thread", thread: T }],
    ],
    [
      "an offer's description, asked of its agent",
      { kind: "offer", lane: T, action: "describe", to: null, seen: null },
      [{ kind: "thread", thread: T }],
    ],
    [
      "an offer's refresh, which may ask for a description",
      { kind: "offer", lane: T, action: "refresh", to: null, seen: null },
      [{ kind: "thread", thread: T }],
    ],
    [
      "an acceptance: your repo alone",
      { kind: "offer", lane: T, action: "accept", to: null, seen: null },
      [],
    ],
    [
      "a pop: its thread",
      { kind: "pop", thread: T },
      [{ kind: "thread", thread: T }],
    ],
    ["a stop: nothing", { kind: "stop", lane: T }, []],
  ] as const)("%s", (_, command, at) => {
    expect(runsIn(command as Intent)).toEqual(at)
  })

  test("heldIn: the first thread among them someone holds, an entry's by its tree", () => {
    const held: CardRecord[] = [
      {
        kind: "thread",
        id: T,
        owner: BEA,
        placer: BEA,
        place: { kind: "inventory", holder: BEA },
        content: NO_CONTENT,
      },
    ]
    const none = new Map()
    expect(
      heldIn([{ kind: "thread", thread: T }], held, () => null, none),
    ).toEqual({ thread: T, holding: { kind: "held", by: BEA } })
    const COPY = threadIdFor("copy")
    const branch = {
      kind: "entry",
      root: ROOT,
      entry: entryId("e"),
      starts: COPY,
    } as const
    expect(heldIn([branch], held, () => T, none)).toEqual({
      thread: T,
      holding: { kind: "held", by: BEA },
    })
    // A copy's first send, at its record's fork, runs in the copy.
    expect(
      heldIn(
        [branch],
        held,
        () => T,
        new Map([[COPY, { kind: "fork", at: entryId("e"), how: "copy" }]]),
      ),
    ).toBeNull()
    expect(
      heldIn([{ kind: "thread", thread: T }], [], () => null, none),
    ).toBeNull()
  })
})

test("takenIn: the threads a change puts in an inventory that were not in one", () => {
  const on: CardRecord = {
    kind: "thread",
    id: T,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", task: TASK, order: "1", width: 1 },
    content: NO_CONTENT,
  }
  const held: CardRecord = { ...on, place: { kind: "inventory", holder: BEA } }
  expect(takenIn([on], [held])).toEqual([T])
  expect(takenIn([held], [held])).toEqual([])
  expect(takenIn([held], [on])).toEqual([])
})

test("a trashed thread is held by nobody, but its discard stops its run and a command in it is refused", () => {
  const on: CardRecord = {
    kind: "thread",
    id: T,
    owner: BEA,
    placer: BEA,
    place: { kind: "canvas", task: TASK, order: "1", width: 1 },
    content: NO_CONTENT,
  }
  const trashed: CardRecord = {
    ...on,
    place: { kind: "trash", left: livePlaceOf(on.place) },
  }
  expect(takenIn([on], [trashed])).toEqual([T])
  expect(takenIn([trashed], [trashed])).toEqual([])
  expect(holdingOf([trashed], T)).toEqual({ kind: "trashed" })
  expect(holdingOf([on], T)).toEqual({ kind: "free" })
  expect(
    heldIn([{ kind: "thread", thread: T }], [trashed], () => null, new Map()),
  ).toEqual({ thread: T, holding: { kind: "trashed" } })
  expect(holdingWords({ kind: "trashed" })).toBe(TRASHED_WORDS)
})
