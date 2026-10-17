import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ThreadName } from "@pinetrie/core"
import { run } from "@pinetrie/lanes"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  DEFAULT_REPO,
  hostProposedRevset,
  PROPOSED_BOOKMARKS,
} from "./lane/names.ts"
import { readCommits } from "./lane/revisions.ts"
import { immutableHeads, logRevset, markSteps } from "./plan.ts"
import {
  type ProposedRenameFacts,
  planProposedRename,
  proposedRenameFacts,
  RETIRED_OFFER_BOOKMARKS,
  renameProposed,
} from "./pre-proposed.ts"
import { executeRepo, hostJj, hostOps } from "./run.ts"

const A = "amber-fox" as ThreadName
const B = "copper-owl" as ThreadName
const retiredGlob = (v: string) =>
  v.replaceAll(PROPOSED_BOOKMARKS, RETIRED_OFFER_BOOKMARKS)
const OLD_HEADS = retiredGlob(immutableHeads(DEFAULT_REPO, null))
const OLD_LOG = retiredGlob(logRevset(null))
const facts = (
  over: Partial<ProposedRenameFacts> = {},
): ProposedRenameFacts => ({
  retired: [{ name: A, local: true, conflicted: false, hostVersion: true }],
  current: new Set(),
  othersRemote: [],
  heads: OLD_HEADS,
  log: OLD_LOG,
  ...over,
})
const argvs = (f: ProposedRenameFacts) =>
  planProposedRename(f).steps.map(s => `${s.tool} ${s.args.join(" ")}`)

describe("planProposedRename: pinetrie-offer/* becomes pinetrie-proposed/*, once", () => {
  test("each bookmark renamed as the host, its version marked and the old forgotten, then both config values as you", () => {
    expect(argvs(facts())).toEqual([
      "jj bookmark rename pinetrie-offer/amber-fox pinetrie-proposed/amber-fox",
      "git update-ref refs/remotes/pinetrie-host/pinetrie-proposed/amber-fox refs/heads/pinetrie-proposed/amber-fox",
      "jj git import",
      "jj bookmark track pinetrie-proposed/amber-fox --remote pinetrie-host",
      "jj bookmark forget --include-remotes pinetrie-offer/amber-fox",
      `jj config set --repo revset-aliases."immutable_heads()" ${immutableHeads(DEFAULT_REPO, null)}`,
      `jj config set --repo revsets.log ${logRevset(null)}`,
    ])
  })
  test("a name already there is not renamed, its old version kept with it, and said", () => {
    const planned = planProposedRename(
      facts({ current: new Set([A]), heads: null, log: null }),
    )
    expect(planned.steps).toEqual([])
    expect(planned.lines).toEqual([
      "your repo has both pinetrie-offer/amber-fox and pinetrie-proposed/amber-fox: the thread's proposed changes are pinetrie-proposed/amber-fox, so move or delete pinetrie-offer/amber-fox in jj",
    ])
  })
  test("each step from its own fact: a start that stopped before its forget forgets an old version whose bookmark is gone", () => {
    expect(
      argvs(
        facts({
          retired: [
            { name: A, local: false, conflicted: false, hostVersion: true },
          ],
          current: new Set([A]),
        }),
      ),
    ).toEqual([
      "jj bookmark forget --include-remotes pinetrie-offer/amber-fox",
      `jj config set --repo revset-aliases."immutable_heads()" ${immutableHeads(DEFAULT_REPO, null)}`,
      `jj config set --repo revsets.log ${logRevset(null)}`,
    ])
  })
  test("a conflicted bookmark is renamed and its old version forgotten, never marked", () => {
    expect(
      argvs(
        facts({
          retired: [
            { name: B, local: true, conflicted: true, hostVersion: true },
          ],
          heads: null,
          log: null,
        }),
      ),
    ).toEqual([
      "jj bookmark rename pinetrie-offer/copper-owl pinetrie-proposed/copper-owl",
      "jj bookmark forget --include-remotes pinetrie-offer/copper-owl",
    ])
  })
  test("nothing to do plans nothing, and says nothing", () => {
    expect(
      planProposedRename(
        facts({
          retired: [],
          heads: immutableHeads(DEFAULT_REPO, null),
          log: null,
        }),
      ),
    ).toEqual({ steps: [], lines: [] })
  })
  test("another remote's bookmark is named, never moved", () => {
    const planned = planProposedRename(
      facts({
        retired: [],
        othersRemote: ["pinetrie-offer/x@origin"],
        heads: null,
        log: null,
      }),
    )
    expect(planned.steps).toEqual([])
    expect(planned.lines).toEqual([
      "pinetrie-offer/x@origin is a bookmark you pushed: delete it with jj git push --deleted, or jj bookmark forget",
    ])
  })
  test("proposedRenameFacts: each old name once, from its local row and its remotes'", () => {
    expect(
      proposedRenameFacts({
        retiredRows: [
          "pinetrie-offer/amber-fox\t\tfalse",
          "pinetrie-offer/amber-fox\tgit\tfalse",
          "pinetrie-offer/amber-fox\tpinetrie-host\tfalse",
          "pinetrie-offer/copper-owl\t\ttrue",
          "pinetrie-offer/gone-elk\tpinetrie-host\tfalse",
          "pinetrie-offer/x\torigin\tfalse",
          "",
        ].join("\n"),
        currentRows: "pinetrie-proposed/old-yak\n",
        heads: null,
        log: null,
      }),
    ).toEqual({
      retired: [
        { name: A, local: true, conflicted: false, hostVersion: true },
        { name: B, local: true, conflicted: true, hostVersion: false },
        {
          name: "gone-elk",
          local: false,
          conflicted: false,
          hostVersion: true,
        },
      ],
      current: new Set(["old-yak"]),
      othersRemote: ["pinetrie-offer/x@origin"],
      heads: null,
      log: null,
    })
  })
})

describe("renameProposed, with jj", () => {
  let top = ""
  beforeAll(async () => {
    top = await realpath(
      await mkdtemp(path.join(tmpdir(), "pinetrie-proposed-")),
    )
    process.env.JJ_USER = "Probe"
    process.env.JJ_EMAIL = "probe@example.com"
  })
  afterAll(async () => {
    await rm(top, { recursive: true, force: true })
  })

  test("marked, conflicted and plain bookmarks are renamed whole, yours on top keeps its parent, and a second start does nothing", async () => {
    const dir = path.join(top, "yours")
    await run("jj", ["git", "init", "--colocate", dir])
    const jj = hostJj(dir)
    const host = hostOps(dir)
    const execute = (steps: Parameters<typeof executeRepo>[1]) =>
      executeRepo(dir, steps)
    await jj(["commit", "-m", "base"])
    await host([
      "bookmark",
      "create",
      DEFAULT_REPO.acceptedBookmark,
      "-r",
      "@-",
    ])
    for (const name of ["amber-fox", "copper-owl", "dusty-elk"]) {
      await host([
        "new",
        DEFAULT_REPO.acceptedBookmark,
        "-m",
        `WIP (${name})`,
        "--no-edit",
      ])
      await host([
        "bookmark",
        "create",
        `pinetrie-offer/${name}`,
        "-r",
        `description(substring:"(${name})")`,
      ])
    }
    // The host's versions, as the host kept them under the old names.
    await execute([
      ...markSteps("pinetrie-offer/amber-fox", "pinetrie-offer/copper-owl"),
    ])
    // Your commit on top of one.
    await jj(["new", "pinetrie-offer/amber-fox", "-m", "yours on top"])
    // A race leaves one conflicted.
    const before = (
      await host(["op", "log", "--no-graph", "-n", "1", "-T", "id.short()"])
    ).stdout.trim()
    await host([
      "bookmark",
      "set",
      "pinetrie-offer/copper-owl",
      "-r",
      "root()",
      "--allow-backwards",
    ])
    await host([
      "--at-op",
      before,
      "bookmark",
      "set",
      "pinetrie-offer/copper-owl",
      "-r",
      DEFAULT_REPO.acceptedBookmark,
      "--allow-backwards",
    ])
    await jj([
      "config",
      "set",
      "--repo",
      'revset-aliases."immutable_heads()"',
      OLD_HEADS,
    ])
    await jj(["config", "set", "--repo", "revsets.log", OLD_LOG])
    const ops = { jj: host, execute }
    const rowsNow = async () =>
      (
        await host([
          "bookmark",
          "list",
          "-a",
          "glob:pinetrie-*/*",
          "-T",
          'name ++ "@" ++ remote ++ " " ++ conflict ++ "\\n"',
        ])
      ).stdout
    const was = await rowsNow()
    expect(was).toContain("pinetrie-offer/copper-owl@ true")
    expect(was).toContain("pinetrie-offer/amber-fox@pinetrie-host false")
    expect(was).toContain("pinetrie-offer/copper-owl@pinetrie-host false")

    expect(await renameProposed(ops)).not.toEqual([])

    const rows = await rowsNow()
    expect(rows).not.toContain("pinetrie-offer/")
    expect(rows).toContain("pinetrie-proposed/copper-owl@ true")
    expect(rows).toContain("pinetrie-proposed/dusty-elk@ false")
    const marked = await readCommits(
      host,
      `${hostProposedRevset("pinetrie-proposed/amber-fox")} & "pinetrie-proposed/amber-fox"`,
    )
    expect(marked).toHaveLength(1)
    expect(
      await readCommits(
        host,
        `parents(description(substring:"yours on top")) & "pinetrie-proposed/amber-fox"`,
      ),
    ).toHaveLength(1)
    const heads = await host([
      "config",
      "get",
      'revset-aliases."immutable_heads()"',
    ])
    expect(heads.stdout.trim()).toBe(immutableHeads(DEFAULT_REPO, null))
    const log = await host(["config", "get", "revsets.log"])
    expect(log.stdout.trim()).toBe(logRevset(null))

    expect(await renameProposed(ops)).toEqual([])
  })
})
