import type { ColumnView, LaneName } from "@pineta/core"
import { expect, test } from "vitest"
import type { LaneJoin } from "./column-view.ts"
import {
  type MessageListProps,
  sameMessageListProps,
} from "./message-list-props.ts"
import { screenMemory } from "./screen-memory.ts"
import type { RowMemory } from "./tool-row.ts"

const view: ColumnView = { tipId: "e2", forkFrom: null, nodes: [] }
const lane = (running = false): MessageListProps["lane"] => ({
  kind: "lane",
  name: "lane-1" as LaneName,
  tip: "e2",
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
})
const joins = (): ReadonlyMap<string, LaneJoin> =>
  new Map([["e1", { name: undefined, from: null }]])
const shared = {
  index: {} as MessageListProps["index"],
  writable: true,
  forks: new Map(),
  shown: new Set<string>(),
  tools: new Map(),
  rows: screenMemory<RowMemory>(),
  nameOf: new Map(),
  doc: {} as MessageListProps["doc"],
  onAct: () => {},
}
const props = (over: Partial<MessageListProps> = {}): MessageListProps => ({
  ...shared,
  view,
  lane: lane(),
  joins: joins(),
  ...over,
})

test("a column's list draws the same from a lane and joins rebuilt unchanged", () => {
  expect(sameMessageListProps(props(), props())).toBe(true)
})

test("a column's list redraws when its lane, joins or view change", () => {
  expect(sameMessageListProps(props(), props({ lane: lane(true) }))).toBe(false)
  expect(
    sameMessageListProps(
      props(),
      props({ joins: new Map([["e2", { name: undefined, from: null }]]) }),
    ),
  ).toBe(false)
  // By identity: comparing a long thread's nodes would spend what skipping saves.
  expect(sameMessageListProps(props(), props({ view: { ...view } }))).toBe(
    false,
  )
})
