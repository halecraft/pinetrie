import { commitId, type ThreadName, threadIdFor } from "@pinetrie/core"
import type { Runner } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { DEFAULT_REPO } from "./lane/names.ts"
import { gatherLane } from "./lane-read.ts"
import type { SharedFacts } from "./shared.ts"

/** The first command a lane's gather runs, over shared facts holding `n` accepted thread commits. */
async function laneReadWith(n: number): Promise<readonly string[]> {
  const commits = Array.from({ length: n }, (_, i) =>
    commitId(i.toString(16).padStart(40, "a")),
  )
  const shared: SharedFacts = {
    op: "op",
    acceptedCommit: commitId("f".repeat(40)),
    acceptedThreadCommits: commits.map(commit => ({
      commit,
      sources: [commit],
    })),
    untraced: [],
    acceptedThreadCommitsRevset: "the-shared-revset",
    editing: new Set(),
  }
  const ran: (readonly string[])[] = []
  // An empty read finds no tip: the gather ends after its first command.
  const jj: Runner = async args => {
    ran.push(args)
    return { ok: true, code: 0, stdout: "", stderr: "" }
  }
  await gatherLane(jj, {
    lane: threadIdFor("0123456789abcdef"),
    name: "amber-fox" as ThreadName,
    repoConfig: DEFAULT_REPO,
    shared,
    known: null,
  })
  const [first = []] = ran
  expect(first.join(" ")).not.toMatch(/a{30}/)
  return first
}

test("a lane read names the accepted thread commits by the shared facts' revset, never one by one", async () => {
  const one = await laneReadWith(1)
  const many = await laneReadWith(500)
  expect(many.join(" ")).toContain("the-shared-revset")
  expect(many.join(" ").length).toBe(one.join(" ").length)
})
