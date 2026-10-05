import type { ColumnView, EntryId, LaneName } from "@pinetrie/core"
import { entryId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { foldMemory } from "./ask-fold.ts"
import type { LaneJoin } from "./column-view.ts"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { screenMemory } from "./screen-memory.ts"
import type { RowMemory } from "./tool-row.ts"

const view: ColumnView = { tipId: entryId("e2"), forkFrom: null, nodes: [] }
const lane = (running = false): MessageListProps["lane"] => ({
  kind: "lane",
  name: "lane-1" as LaneName,
  tip: entryId("e2"),
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})
const joins = (): ReadonlyMap<EntryId, LaneJoin> =>
  new Map([[entryId("e1"), { name: undefined, from: null }]])
const shared = {
  index: {} as MessageListProps["index"],
  writable: true,
  forks: new Map(),
  shown: new Set<string>(),
  tools: new Map(),
  rows: screenMemory<RowMemory>(),
  nameOf: new Map(),
  live: {} as MessageListProps["live"],
  onAct: () => {},
  asks: {
    askOf: new Map(),
    work: new Map(),
    last: new Map(),
    steered: new Map(),
  },
  stops: new Map(),
  revisions: new Map(),
  folds: foldMemory(),
  digests: new Map(),
}
const props = (over: Partial<MessageListProps> = {}): MessageListProps => ({
  ...shared,
  view,
  lane: lane(),
  joins: joins(),
  landmarks: [entryId("e1")],
  density: "story",
  releasedTip: null,
  runningAsk: null,
  leftBefore: null,
  ...over,
})

test("a column's list draws the same from a lane and joins rebuilt unchanged", () => {
  expect(sameMessageListProps(props(), props())).toBe(true)
})

test("a column's list redraws when its density, its reader's release or its landmarks change, and not when they are rebuilt unchanged", () => {
  expect(
    sameMessageListProps(props(), props({ landmarks: [entryId("e1")] })),
  ).toBe(true)
  expect(sameMessageListProps(props(), props({ density: "outline" }))).toBe(
    false,
  )
  expect(
    sameMessageListProps(props(), props({ releasedTip: entryId("e1") })),
  ).toBe(false)
  expect(sameMessageListProps(props(), props({ landmarks: [] }))).toBe(false)
})

test("a column's list redraws when its lane, joins or view change", () => {
  expect(sameMessageListProps(props(), props({ lane: lane(true) }))).toBe(false)
  expect(
    sameMessageListProps(
      props(),
      props({
        joins: new Map([[entryId("e2"), { name: undefined, from: null }]]),
      }),
    ),
  ).toBe(false)
  // By identity: comparing a long thread's nodes would spend what skipping saves.
  expect(sameMessageListProps(props(), props({ view: { ...view } }))).toBe(
    false,
  )
})
