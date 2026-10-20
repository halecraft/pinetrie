import {
  canvasIdFor,
  commitId,
  ERR,
  type JjAcceptedRecord,
  type Sha256,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { planAcceptedRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  acceptedRefusal,
  branchOutRefusal,
  copyRefusal,
  gateRefusal,
  HELD_WORDS,
  imageRefusal,
  openRefusal,
  publishUndone,
  spinOffRefusal,
  TRASHED_WORDS,
} from "./answer-words.ts"

const BEA = writerId("bea@x.io")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const T = threadIdFor("t")

test("gateRefusal: an archive names its archiver, a hold and a trash say what to do", () => {
  const nameOf = new Map([[BEA, "Bea"]])
  expect(
    gateRefusal(
      { kind: "archived", canvas: { canvas: CANVAS, by: BEA, at: 1 } },
      nameOf,
    ),
  ).toEqual({
    kind: "refused",
    code: ERR.CANVAS_ARCHIVED,
    message: "archived by Bea: restore the canvas first",
  })
  expect(
    gateRefusal(
      { kind: "held", thread: T, holding: { kind: "held", by: BEA } },
      nameOf,
    ),
  ).toEqual({ kind: "refused", code: ERR.REFUSED, message: HELD_WORDS })
  expect(
    gateRefusal(
      { kind: "held", thread: T, holding: { kind: "trashed" } },
      nameOf,
    ).message,
  ).toBe(TRASHED_WORDS)
})

describe("accepted work's refusals", () => {
  const record = (over: Partial<JjAcceptedRecord> = {}): JjAcceptedRecord => ({
    ...planAcceptedRecord({
      facts: {
        commit: commitId("c1"),
        heads: "trunk()",
        log: null,
        unfinishedWork: [],
        published: { commit: commitId("m1"), behind: 0, ahead: 0 },
        workingCopy: {
          behind: 0,
          ahead: 0,
          getLatest: null,
          conflicts: { commits: 0, files: [] },
        },
      },
      repoConfig: {
        acceptedBookmark: "pinetrie-accepted",
        wipPrefix: "wip/",
        publish: "main",
        publishCatchesUp: true,
      },
      proposed: { heads: "trunk()", log: "logged" },
    }),
    ...over,
  })

  test("acceptedRefusal words each refusal once, naming the bookmark, the counts and the files", () => {
    const ahead = record({
      published: { commit: commitId("m1"), behind: 3, ahead: 2 },
    })
    expect(acceptedRefusal("publish", ERR.NOT_FAST_FORWARD, ahead)).toBe(
      "main has 2 commits accepted work doesn't: bring them into accepted work in jj first",
    )
    expect(acceptedRefusal("publish", ERR.NO_PUBLISH, ahead)).toBe(
      "this repo has no main bookmark to publish to",
    )
    expect(acceptedRefusal("publish", ERR.REFUSED, ahead)).toBe(
      "nothing to publish",
    )
    expect(
      acceptedRefusal(
        "publish",
        ERR.WORKING_COPY_CONFLICT,
        record({
          workingCopy: {
            behind: 0,
            ahead: 1,
            getLatest: null,
            conflicts: { commits: 1, files: ["a", "b", "c", "d", "e"] },
          },
        }),
      ),
    ).toBe("the working copy has conflicts in a, b, c and 2 more")
  })

  test("publishUndone: a reverted catch-up names the conflicts it would have left; main moving is worded as a refusal", () => {
    const after = record({
      published: { commit: commitId("m1"), behind: 1, ahead: 1 },
      workingCopy: {
        behind: 0,
        ahead: 2,
        getLatest: null,
        conflicts: { commits: 2, files: [] },
      },
    })
    expect(publishUndone(ERR.WORKING_COPY_CONFLICT, after)).toBe(
      "bringing the working copy the latest would leave 2 commits of yours with conflicts",
    )
    expect(publishUndone(ERR.NOT_FAST_FORWARD, after)).toBe(
      acceptedRefusal("publish", ERR.NOT_FAST_FORWARD, after),
    )
  })
})

test("a card command's refusals each say what was refused, an unknown target and a taken thread apart", () => {
  expect(openRefusal("unknown")).toMatchObject({ code: ERR.UNKNOWN_TARGET })
  expect(openRefusal("taken")).toMatchObject({ code: ERR.THREAD_TAKEN })
  expect(openRefusal("moved")).toEqual({
    kind: "unmoved",
    code: "moved",
    place: null,
    by: null,
  })
  expect(copyRefusal("held")).toMatchObject({ code: ERR.REFUSED })
  expect(branchOutRefusal("running")).toMatchObject({
    message: "the run that proposed these has not ended",
  })
  expect(branchOutRefusal("taken")).toEqual(openRefusal("taken"))
  const sha = "a".repeat(64) as Sha256
  expect(imageRefusal({ kind: "missing", sha256: sha })).toMatchObject({
    code: ERR.IMAGE_MISSING,
    message: `no blob is stored as ${sha}`,
  })
  expect(imageRefusal({ kind: "not-an-image" })).toMatchObject({
    code: ERR.NOT_AN_IMAGE,
  })
  expect(spinOffRefusal("root-in-use")).toMatchObject({
    code: ERR.ROOT_ID_IN_USE,
  })
})
