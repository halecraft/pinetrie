import { type AcceptedFacts, commitId, ERR } from "@pinetrie/core"
import type { RepoOps, RepoOwner, RepoStep } from "@pinetrie/jj"
import { DEFAULT_REPO } from "@pinetrie/jj"
import { describe, expect, test } from "vitest"
import { applyWrites, basics, record } from "../fakes.ts"
import { createAcceptedWork } from "./accepted.ts"

const facts = (
  over: Partial<AcceptedFacts["workingCopy"]> = {},
): AcceptedFacts => ({
  commit: commitId("c1"),
  heads: null,
  log: null,
  wips: [],
  published: { commit: commitId("m0"), behind: 1, ahead: 0 },
  workingCopy: {
    behind: 1,
    ahead: 0,
    getLatest: { changes: 1, conflicts: [], heads: 0 },
    conflicts: { commits: 0, files: [] },
    ...over,
  },
})

/**
 * A publish on a fake owner: `facts()` is accepted work until the catch-up runs,
 * `after` from then on; the move's step throws when `moveFails`.
 */
function rig(
  after: AcceptedFacts,
  {
    moveFails = false,
    getLatest = true,
  }: { moveFails?: boolean; getLatest?: boolean } = {},
) {
  const b = basics()
  const ran: RepoStep[][] = []
  let now = facts()
  let op = "op0"
  const ops = record<RepoOps>({
    shared: async () => ({
      op,
      acceptedCommit: now.commit,
      acceptedThreadCommits: [],
      untraced: [],
      editing: new Set(),
    }),
    acceptedFacts: async () => now,
    execute: async steps => {
      ran.push([...steps])
      const [first] = steps
      if (first?.tool === "jj" && first.args[0] === "rebase") {
        now = after
        op = "op-catch-up"
      }
      if (moveFails && first?.tool === "jj" && first.args[0] === "bookmark")
        throw new Error("jj refused the move")
    },
  }).port
  const owner = record<Pick<RepoOwner, "later" | "command">>({
    command: async step => step(ops),
  }).port
  const accepted = createAcceptedWork({
    owner,
    basics: b,
    repoConfig: { ...DEFAULT_REPO, publishCatchesUp: getLatest },
    writeValues: async w => applyWrites(b, w),
  })
  const argv = () => ran.map(steps => steps.map(s => s.args.join(" ")))
  return { line: accepted, argv }
}

describe("a publish with publish.catchUp off moves main alone", () => {
  test("the working copy behind and your commits below @ stay where they are", async () => {
    const { line, argv } = rig(facts(), { getLatest: false })
    expect(await line.act("publish")).toBeNull()
    expect(argv()).toEqual([['bookmark move main --to "pinetrie-accepted"']])
  })
})

describe("a publish with publish.catchUp on, in two rounds", () => {
  test("the catch-up, then the move, from accepted work read after it", async () => {
    const { line, argv } = rig(facts({ behind: 0, ahead: 0, getLatest: null }))
    expect(await line.act("publish")).toBeNull()
    expect(argv()).toEqual([
      ['rebase -b @ -d "pinetrie-accepted"'],
      ['bookmark move main --to "pinetrie-accepted"'],
    ])
  })
  test("your commits conflicted by the catch-up: it is reverted, and the refusal said", async () => {
    const { line, argv } = rig(
      facts({ behind: 0, ahead: 1, conflicts: { commits: 1, files: [] } }),
    )
    const answer = await line.act("publish")
    expect(answer?.code).toBe(ERR.WORKING_COPY_CONFLICT)
    expect(argv()).toEqual([
      ['rebase -b @ -d "pinetrie-accepted"'],
      ["op revert op-catch-up"],
    ])
  })
  test("a move jj refuses after the catch-up reverts it, then fails", async () => {
    const { line, argv } = rig(
      facts({ behind: 0, ahead: 0, getLatest: null }),
      {
        moveFails: true,
      },
    )
    await expect(line.act("publish")).rejects.toThrow("jj refused the move")
    expect(argv()).toEqual([
      ['rebase -b @ -d "pinetrie-accepted"'],
      ['bookmark move main --to "pinetrie-accepted"'],
      ["op revert op-catch-up"],
    ])
  })
})
