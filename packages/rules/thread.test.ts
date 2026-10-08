import {
  entryId,
  indexTree,
  type ThreadId,
  threadEnd,
  threadIdFor,
} from "@pinetrie/core"
import { entriesOf, entry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { deriveThreads, type LaneTip } from "./thread.ts"

/** A tree from `child: parent` pairs: ids sort by age, "2-…" before "3-…". */
const tree = (parents: Record<string, string | null>) =>
  indexTree(
    entriesOf(
      Object.entries(parents).map(([id, parent]) =>
        entry(id, parent, { role: "chat", content: id }),
      ),
    ),
  )
const lane = (name: string, tip: string, createdAt: number): LaneTip => ({
  lane: threadIdFor(name),
  tip: entryId(tip),
  createdAt,
})
/** Fresh ids in order, so a test can name each. */
const minter = () => {
  let n = 0
  return () => threadIdFor(`fresh-${++n}`)
}
const derived = (
  parents: Record<string, string | null>,
  lanes: readonly LaneTip[] = [],
) => Object.fromEntries(deriveThreads(tree(parents), lanes, minter()))

/** The index with each derived first entry marked as its thread's start. */
const marked = (
  parents: Record<string, string | null>,
  lanes: readonly LaneTip[],
) => {
  const firsts = deriveThreads(tree(parents), lanes, minter())
  return indexTree(
    entriesOf(
      Object.entries(parents).map(([id, parent]) => {
        const starts = firsts.get(entryId(id))
        return entry(id, parent, {
          role: "chat",
          content: id,
          ...(starts === undefined ? {} : { starts }),
        })
      }),
    ),
  )
}

describe("deriveThreads (ADR-0117)", () => {
  test("the oldest child continues, every other starts a thread, each with a fresh id", () => {
    expect(
      derived({ "1-a": null, "2-b": "1-a", "3-c": "1-a", "4-d": "3-c" }),
    ).toEqual({ "1-a": "t-fresh-1", "3-c": "t-fresh-2" })
  })

  test("a lane's thread continues past a younger branch, and takes the lane's name", () => {
    // The lane runs through 3-c, a younger child than 2-b.
    expect(
      derived({ "1-a": null, "2-b": "1-a", "3-c": "1-a", "4-d": "3-c" }, [
        lane("l", "4-d", 1),
      ]),
    ).toEqual({ "1-a": "t-l", "2-b": "t-fresh-1" })
  })

  test("of two lanes through one entry, the older continues the thread", () => {
    expect(
      derived({ "1-a": null, "2-b": "1-a", "3-c": "1-a" }, [
        lane("young", "2-b", 2),
        lane("old", "3-c", 1),
      ]),
    ).toEqual({ "1-a": "t-old", "2-b": "t-young" })
  })

  test("a conversation stepped down at a lane's tip is a thread of its own, as an edit's sibling is", () => {
    // 3-conv was said at the lane's tip; 4-edit is an edit of 2-q, a sibling.
    expect(
      derived({ "1-a": null, "2-q": "1-a", "3-conv": "2-q", "4-edit": "1-a" }, [
        lane("l", "2-q", 1),
      ]),
    ).toEqual({ "1-a": "t-l", "3-conv": "t-fresh-1", "4-edit": "t-fresh-2" })
  })

  test("an orphan starts a thread", () => {
    expect(derived({ "1-a": null, "3-x": "2-gone" })).toEqual({
      "1-a": "t-fresh-1",
      "3-x": "t-fresh-2",
    })
  })

  test("marked, every thread's end is exact, and none enters another", () => {
    const parents = {
      "1-a": null,
      "2-b": "1-a",
      "3-c": "1-a",
      "4-d": "3-c",
      "5-e": "2-b",
      "6-f": "4-d",
      "7-g": "4-d",
    }
    const i = marked(parents, [lane("l", "6-f", 1)])
    const l: ThreadId = threadIdFor("l")
    expect(threadEnd(i, l)).toBe("6-f")
    // Each entry is in exactly one thread's path from its first entry.
    const ends = [...i.firstOf.keys()].map(t => threadEnd(i, t))
    expect(ends.toSorted()).toEqual(["5-e", "6-f", "7-g"])
  })
})
