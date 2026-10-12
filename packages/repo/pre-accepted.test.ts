import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { commitsOf, DEFAULT_REPO, run } from "@pinetrie/lanes"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { acceptedHeads } from "./plan.ts"
import {
  type AcceptedRenameFacts,
  OLD_ACCEPTED,
  planAcceptedRename,
  renameAccepted,
} from "./pre-accepted.ts"
import { executeRepo, hostJj, hostOps } from "./run.ts"

const NEW = DEFAULT_REPO.acceptedBookmark
const OLD_HEADS = `builtin_immutable_heads() | ${acceptedHeads(OLD_ACCEPTED)}`
const facts = (over: Partial<AcceptedRenameFacts> = {}) => ({
  configured: NEW,
  old: true,
  current: false,
  heads: OLD_HEADS,
  ...over,
})
const argvs = (f: AcceptedRenameFacts) =>
  planAcceptedRename(f).steps.map(s => s.args.join(" "))

describe("planAcceptedRename: pinetrie-onto becomes pinetrie-accepted, once", () => {
  test("the bookmark renamed, as the host, and setup's immutable_heads() rewritten, as you", () => {
    const planned = planAcceptedRename(facts())
    expect(planned.steps.map(s => (s.tool === "jj" ? s.as : "git"))).toEqual([
      "host",
      "you",
    ])
    expect(argvs(facts())).toEqual([
      `bookmark rename ${OLD_ACCEPTED} ${NEW}`,
      `config set --repo revset-aliases."immutable_heads()" builtin_immutable_heads() | ${acceptedHeads(NEW)}`,
    ])
    expect(planned.lines).toHaveLength(3)
    expect(planned.lines[2]).toContain("jjui")
  })
  test("each write from its own fact: a start that stopped between them finishes the other", () => {
    expect(
      argvs(
        facts({ heads: `builtin_immutable_heads() | ${acceptedHeads(NEW)}` }),
      ),
    ).toEqual([`bookmark rename ${OLD_ACCEPTED} ${NEW}`])
    expect(argvs(facts({ old: false, current: true }))).toEqual([
      `config set --repo revset-aliases."immutable_heads()" builtin_immutable_heads() | ${acceptedHeads(NEW)}`,
    ])
  })
  test("nothing once done, with no line, or with a config of jj's own", () => {
    for (const heads of [null, "trunk()", `x | ${acceptedHeads(NEW)}`])
      expect(
        planAcceptedRename(facts({ old: false, current: true, heads })),
      ).toEqual({
        steps: [],
        lines: [],
      })
  })
  test("both bookmarks: none renamed, and said", () => {
    const planned = planAcceptedRename(facts({ current: true, heads: null }))
    expect(planned.steps).toEqual([])
    expect(planned.lines).toEqual([
      `your repo has both ${OLD_ACCEPTED} and ${NEW}: accepted work is ${NEW}, so move or delete ${OLD_ACCEPTED} in jj`,
    ])
  })
  test("a config that names its own bookmark is left alone", () => {
    expect(planAcceptedRename(facts({ configured: "trunk" }))).toEqual({
      steps: [],
      lines: [],
    })
  })
})

describe("renameAccepted, with jj", () => {
  let top = ""
  beforeAll(async () => {
    top = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-rename-")))
    process.env.JJ_USER = "Probe"
    process.env.JJ_EMAIL = "probe@example.com"
  })
  afterAll(async () => {
    await rm(top, { recursive: true, force: true })
  })

  test("a repo set up with pinetrie-onto is renamed once; a second start does nothing", async () => {
    const dir = path.join(top, "yours")
    await run("jj", ["git", "init", "--colocate", dir])
    const jj = hostJj(dir)
    await jj(["commit", "-m", "base"])
    await hostOps(dir)(["bookmark", "create", OLD_ACCEPTED, "-r", "@-"])
    await jj([
      "config",
      "set",
      "--repo",
      'revset-aliases."immutable_heads()"',
      OLD_HEADS,
    ])
    const ops = {
      jj: hostOps(dir),
      execute: (steps: Parameters<typeof executeRepo>[1]) =>
        executeRepo(dir, steps),
    }
    expect(await renameAccepted(ops, NEW)).toHaveLength(3)
    expect(await commitsOf(ops.jj, `present(${OLD_ACCEPTED})`)).toEqual([])
    expect(await commitsOf(ops.jj, `present(${NEW})`)).toHaveLength(1)
    const heads = await ops.jj([
      "config",
      "get",
      'revset-aliases."immutable_heads()"',
    ])
    expect(heads.stdout.trim()).toBe(
      `builtin_immutable_heads() | ${acceptedHeads(NEW)}`,
    )
    expect(await renameAccepted(ops, NEW)).toEqual([])
  })
})
