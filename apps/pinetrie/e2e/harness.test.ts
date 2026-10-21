import { ERR, entryId, rootIdFor, threadIdFor } from "@pinetrie/core"
import type { TextCard } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  composeCard,
  isWatchedRunOver,
  rootHolding,
  sendWait,
  waitForRootHolding,
} from "./harness.ts"

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
    rootsRead: () =>
      new Map(
        Object.entries(held).map(([root, entries]) => [
          root,
          { entries: new Map(entries.map(e => [e, {}])) },
        ]),
      ),
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

describe("sendWait", () => {
  const started = { kind: "started", runId: "r-1" } as Parameters<
    typeof sendWait
  >[0]
  test("a run the send started waits while the host is busy, and settles once idle", () => {
    expect(sendWait(started, false).kind).toBe("waiting")
    expect(sendWait(started, true).kind).toBe("settled")
  })
  test("a message appended, or a card queued, settles once the host is idle", () => {
    expect(sendWait({ kind: "appended", id: E }, true).kind).toBe("settled")
    expect(sendWait({ kind: "queued" }, false).kind).toBe("waiting")
  })
  test("a send that started nothing fails the wait, idle or not", () => {
    for (const idle of [true, false]) {
      expect(sendWait({ kind: "busy" }, idle).kind).toBe("started-nothing")
      expect(
        sendWait(
          { kind: "refused", code: ERR.UNKNOWN_TARGET, message: "m" },
          idle,
        ).kind,
      ).toBe("started-nothing")
    }
  })
})

describe("isWatchedRunOver", () => {
  test("an idle host that no run has begun on since the watch is not over", () => {
    expect(isWatchedRunOver(0, true)).toBe(false)
  })
  test("a run begun since, and the host idle again: over", () => {
    expect(isWatchedRunOver(1, true)).toBe(true)
    expect(isWatchedRunOver(1, false)).toBe(false)
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

test("composeCard: a composing card at the entry, in the root the client came to hold", async () => {
  const made: Pick<TextCard, "place" | "content">[] = []
  const client = {
    ...lateClient(3),
    createCard: (card: Pick<TextCard, "place" | "content">) => {
      made.push(card)
      return Promise.resolve({ kind: "moved" })
    },
  } as unknown as Parameters<typeof composeCard>[0]
  const lane = threadIdFor("1")
  await composeCard(client, { entry: E, lane, command: "split" }, "hi")
  expect(made.map(c => [c.place, c.content.command])).toEqual([
    [{ kind: "composing", thread: lane }, "split"],
  ])
})
