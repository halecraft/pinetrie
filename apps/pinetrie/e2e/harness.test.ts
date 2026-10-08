import {
  type CardRecord,
  entryId,
  laneNameForThread,
  rootIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { composeAt, rootHolding, waitForRootHolding } from "./harness.ts"

const R1 = rootIdFor("one")
const R2 = rootIdFor("two")
const E = entryId("e-1")

/** A client whose copy gets `E`, in `R2`, at its `after`th look. */
const lateClient = (after: number) => {
  let looks = 0
  return {
    rootOf: () => (++looks >= after ? R2 : undefined),
  }
}

/** A host holding `entries` in each root. */
const hostWith = (held: Readonly<Record<string, readonly string[]>>) =>
  ({
    docs: {
      loaded: () => Object.keys(held),
      view: (root: string) => ({
        doc: { entries: new Map((held[root] ?? []).map(e => [e, {}])) },
      }),
    },
  }) as unknown as Parameters<typeof rootHolding>[0]

describe("waitForRootHolding", () => {
  test("a client whose copy gets the entry after two polls: its root", async () => {
    expect(await waitForRootHolding(lateClient(3), E)).toBe(R2)
  })
  test("a client that never gets it: refused, naming the entry", async () => {
    await expect(
      waitForRootHolding({ rootOf: () => undefined }, E, 30),
    ).rejects.toThrow("e-1")
  })
  test("no entry: refused", async () => {
    await expect(waitForRootHolding(lateClient(1), null)).rejects.toThrow()
  })
})

describe("rootHolding", () => {
  test("the root of the two that holds the entry", () => {
    expect(rootHolding(hostWith({ [R1]: [], [R2]: ["e-1"] }), E)).toBe(R2)
  })
  test("held nowhere, or no entry: throws", () => {
    expect(() => rootHolding(hostWith({ [R1]: [] }), E)).toThrow("e-1")
    expect(() => rootHolding(hostWith({ [R1]: ["e-1"] }), null)).toThrow()
  })
})

test("composeAt: a composing card at the entry, in the root the client came to hold", async () => {
  const made: Pick<CardRecord, "place" | "carries">[] = []
  const client = {
    ...lateClient(3),
    createCard: (card: Pick<CardRecord, "place" | "carries">) => {
      made.push(card)
      return Promise.resolve({ kind: "moved" })
    },
  } as unknown as Parameters<typeof composeAt>[0]
  const lane = laneNameForThread("1")
  await composeAt(client, { entry: E, lane, command: "split" }, "hi")
  expect(made.map(c => [c.place, c.carries])).toEqual([
    [
      { kind: "composing", root: R2, at: { kind: "entry", id: E }, lane },
      { kind: "message", command: "split" },
    ],
  ])
})
