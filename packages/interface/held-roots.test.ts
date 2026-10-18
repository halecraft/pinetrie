import {
  canvasIdFor,
  entryId,
  rootIdFor,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { RootRecord } from "@pinetrie/rules"
import { landedThreadCard } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import { canvasesWith } from "./fixtures.ts"
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
  blobs: [],
})
const _directory = new Map(
  ["1", "2", "3", "4"].map(n => [rootIdFor(`r${n}`), record(n)] as const),
)
/** Canvas `k-<n>` holds the thread `t-<n>`, in root `r<n>`. */
const K = (n: string) => canvasIdFor(n)
const canvases = canvasesWith({
  known: ["1", "2", "3", "4"].map(K),
  cards: ["1", "2", "3", "4"].map(n =>
    landedThreadCard({
      thread: threadIdFor(n),
      canvas: K(n),
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

describe("planHeldRoots", () => {
  test("the roots of the threads in your inventory too, which their slots and previews read", () => {
    expect(
      held({
        layout: { open: [], active: null },
        canvases,
        inventory: [threadIdFor("3")],
      }),
    ).toEqual([rootIdFor("r3")])
  })

  test("the roots of the sidebar's canvases and the one you are on, and no other", () => {
    expect(
      held({
        layout: {
          open: [K("1"), K("2")],
          active: { kind: "canvas", canvas: K("3") },
        },
        canvases,
      }),
    ).toEqual([rootIdFor("r1"), rootIdFor("r2"), rootIdFor("r3")])
  })

  test("a canvas the session does not hold holds no root", () => {
    expect(
      held({ layout: { open: [K("9")], active: null }, canvases }),
    ).toEqual([])
  })
})
