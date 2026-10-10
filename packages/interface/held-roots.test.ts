import {
  entryId,
  type RootRecord,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { threadCardOf } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import { tasksWith } from "./fixtures.ts"
import { planHeldRoots } from "./held-roots.ts"

const record = (n: string): RootRecord => ({
  root: rootIdFor(`r${n}`),
  entry: entryId(`e${n}`),
  first: entryId(`e${n}`),
  firstLine: n,
  messages: 1,
  newest: entryId(`e${n}`),
  writers: [],
  threads: {},
  mentions: [],
  images: [],
})
const _directory = new Map(
  ["1", "2", "3", "4"].map(n => [rootIdFor(`r${n}`), record(n)] as const),
)
/** Task `k-<n>` holds the thread `t-<n>`, in root `r<n>` (ADR-0116). */
const K = (n: string) => taskIdFor(n)
const tasks = tasksWith({
  known: ["1", "2", "3", "4"].map(K),
  cards: ["1", "2", "3", "4"].map(n =>
    threadCardOf({
      thread: threadIdFor(n),
      task: K(n),
      by: writerId("a"),
      cards: [],
    }),
  ),
  threads: new Map(
    ["1", "2", "3", "4"].map(n => [
      threadIdFor(n),
      {
        thread: threadIdFor(n),
        root: rootIdFor(`r${n}`),
        by: writerId("a"),
        createdAt: 0,
        origin: { kind: "root" },
      },
    ]),
  ),
})
const held = (
  input: Omit<Parameters<typeof planHeldRoots>[0], "inventory"> & {
    inventory?: readonly ThreadId[]
  },
) => [...planHeldRoots({ inventory: [], ...input })].sort()

describe("planHeldRoots (ADR-0116)", () => {
  test("the roots of the threads in your inventory too, which their slots and previews read (ADR-0124)", () => {
    expect(
      held({
        layout: { open: [], active: null },
        tasks,
        inventory: [threadIdFor("3")],
      }),
    ).toEqual([rootIdFor("r3")])
  })

  test("the roots of the sidebar's tasks and the one you are on, and no other", () => {
    expect(
      held({
        layout: {
          open: [K("1"), K("2")],
          active: { kind: "task", task: K("3") },
        },
        tasks,
      }),
    ).toEqual([rootIdFor("r1"), rootIdFor("r2"), rootIdFor("r3")])
  })

  test("a task the session does not hold holds no root", () => {
    expect(held({ layout: { open: [K("9")], active: null }, tasks })).toEqual(
      [],
    )
  })
})
