import { commitId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planFetch } from "./fetch-plan.ts"

const OURS = commitId("1111")
const ACCEPTED = commitId("2222")
const MERGE = commitId("3333")

describe("planFetch: what a move fetches into your repo", () => {
  test("a clean merge fetches the lane, past the lane before it and what it merged", () => {
    expect(
      planFetch({
        kind: "merge",
        merged: {
          kind: "clean",
          from: ACCEPTED,
          ours: OURS,
          merge: MERGE,
          files: ["a.txt"],
          commits: ["yours one"],
        },
      }),
    ).toEqual([OURS, ACCEPTED])
  })
  test("a move to accepted work is fetched; nothing else is", () => {
    expect(
      planFetch({
        kind: "merge",
        merged: { kind: "nothing", ours: OURS, mark: MERGE },
      }),
    ).toEqual([OURS])
    expect(
      planFetch({
        kind: "merge",
        merged: { kind: "nothing", ours: OURS, mark: null },
      }),
    ).toBeNull()
  })
  test("a conflicted merge fetches nothing: the resolution's turns do", () => {
    expect(
      planFetch({
        kind: "merge",
        merged: {
          kind: "conflicted",
          from: ACCEPTED,
          contents: [{ path: "a.txt", content: "<<<<<<< a" }],
          ours: [],
          theirs: [],
        },
      }),
    ).toBeNull()
  })
  test("a turn that committed fetches past the bookmark before it; one that did not, nothing", () => {
    expect(
      planFetch({
        kind: "turn",
        made: { commit: MERGE, conflicted: false },
        before: OURS,
      }),
    ).toEqual([OURS])
    expect(
      planFetch({
        kind: "turn",
        made: { commit: null, conflicted: false },
        before: OURS,
      }),
    ).toBeNull()
  })
})
