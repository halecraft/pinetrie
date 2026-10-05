import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NO_EDITOR } from "@pinetrie/core"
import { DEFAULT_LINE, run } from "@pinetrie/lanes"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import type { Moved } from "./observe.ts"
import { headsDir, type RepoOwner, startRepoOwner } from "./owner.ts"
import { operationGone, runnerFor } from "./run.ts"
import { host } from "./step.ts"

let top = ""
beforeAll(async () => {
  top = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-owner-")))
  process.env.JJ_USER = "Probe"
  process.env.JJ_EMAIL = "probe@example.com"
})
afterAll(async () => {
  await rm(top, { recursive: true, force: true })
})

/** A repo with one commit and the line on it, and jj in it as you. */
async function repo(name: string) {
  const dir = path.join(top, name)
  await run("mkdir", ["-p", dir])
  await run("jj", ["git", "init", "--colocate", dir])
  const jj = (...args: string[]) =>
    run("jj", ["-R", dir, ...args], { env: NO_EDITOR })
  await writeFile(path.join(dir, "a.txt"), "a\n")
  await jj("commit", "-m", "base")
  await jj("bookmark", "create", DEFAULT_LINE.onto, "-r", "@-")
  const heads = async () =>
    (await readdir(await headsDir(dir))).filter(h => /^[0-9a-f]+$/.test(h))
  /**
   * Two operation heads, as two jj processes racing leave them. Call it with
   * no owner watching: a live owner's watch merges them.
   */
  const diverge = async () => {
    const op = (await jj("op", "log", "--no-graph", "-n", "1", "-T", "id"))
      .stdout
    await jj("--ignore-working-copy", "describe", "-m", "one")
    await jj("--ignore-working-copy", "--at-op", op, "describe", "-m", "two")
  }
  return { dir, jj, heads, diverge }
}

/** An owner on `dir`, with what it reports and which steps it ran. */
function own(dir: string, backstopMs = 60_000) {
  const steps: (string | null)[] = []
  const moves: Moved[] = []
  const owner = startRepoOwner({
    root: dir,
    line: DEFAULT_LINE,
    slowMs: -1,
    onSlow: s => steps.push(s.key),
    backstopMs,
  })
  owner.onMoved(m => moves.push(m))
  return { owner, steps, moves }
}

const waitFor = async (pred: () => boolean, ms = 5_000) => {
  const t0 = Date.now()
  while (!pred() && Date.now() - t0 < ms)
    await new Promise(r => setTimeout(r, 10))
  return pred()
}

test("a read at an operation your repo no longer holds is told apart from any other failure", async () => {
  const { dir } = await repo("gone")
  const at = (op: string) =>
    runnerFor(dir, { at: op })(["log", "--no-graph", "-r", "@"])
  expect(operationGone(await at("deadbeef"))).toBe(true)
  expect(
    operationGone(
      await runnerFor(dir, "host")(["log", "--no-graph", "-r", "nonesuch"]),
    ),
  ).toBe(false)
})

describe("the owner of your repo", () => {
  const close = (o: RepoOwner) => o.close()

  test("the first observation reports everything", async () => {
    const { dir } = await repo("first")
    const { owner, moves } = own(dir)
    await owner.idle()
    expect(moves[0]?.all).toBe(true)
    close(owner)
  })

  test("a command queued behind a slow later step starts as soon as it ends, before the upkeep behind it", async () => {
    const { dir } = await repo("order")
    const { owner } = own(dir)
    await owner.idle()
    const order: string[] = []
    const held = Promise.withResolvers<void>()
    void owner.later("line", async () => {
      await held.promise
      order.push("line")
    })
    await new Promise(r => setTimeout(r, 5))
    void owner.later("shared", async () => void order.push("shared"))
    void owner.command(async () => void order.push("command"))
    held.resolve()
    await owner.idle()
    expect(order).toEqual(["line", "command", "shared"])
    close(owner)
  })

  test("a move of the publish bookmark is observed as the line's alone (ADR-0076)", async () => {
    const { dir, jj } = await repo("publish")
    // A commit nothing else the owner watches points at: main alone reads it.
    await jj("new", "root()", "-m", "side")
    const side = (
      await jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    ).stdout.trim()
    await jj("new", DEFAULT_LINE.onto)
    const { owner, moves } = own(dir)
    await owner.idle()
    await owner.command(ops =>
      ops.execute([host("bookmark", "create", "main", "-r", side)]),
    )
    await owner.idle()
    expect(moves.at(-1)).toEqual({
      all: false,
      onto: false,
      line: true,
      yours: false,
      lanes: new Set(),
      offers: new Set(),
    })
    close(owner)
  })

  test("a write by the owner moves only what it moved; a step that only read queues no observation", async () => {
    const { dir } = await repo("own-write")
    const { owner, steps, moves } = own(dir)
    await owner.idle()
    const observed = () => steps.filter(k => k === "observe").length
    const before = observed()
    await owner.command(async ops => {
      await ops.jj(["log", "--no-graph", "-r", "@"])
    })
    await owner.idle()
    expect(observed()).toBe(before)
    await owner.command(ops =>
      ops.execute([
        host("bookmark", "create", "pinetrie-offer/amber-fox", "-r", "@-"),
      ]),
    )
    await owner.idle()
    expect(moves.at(-1)).toEqual({
      all: false,
      onto: false,
      line: false,
      yours: false,
      lanes: new Set(),
      offers: new Set(["amber-fox"]),
    })
    // A read after the command is pinned to what it wrote.
    const read = await owner.read(ops =>
      ops.jj([
        "log",
        "--no-graph",
        "-r",
        "pinetrie-offer/amber-fox",
        "-T",
        "commit_id",
      ]),
    )
    expect(read.ok).toBe(true)
    close(owner)
  })

  test("a read inside a step, after its write, sees the write: what a record written then names is readable", async () => {
    const { dir } = await repo("in-step")
    const { owner } = own(dir)
    await owner.idle()
    const seen = await owner.command(async ops => {
      await ops.execute([
        host("bookmark", "create", "pinetrie-offer/x", "-r", "@-"),
      ])
      return owner.read(r =>
        r.jj([
          "log",
          "--no-graph",
          "-r",
          "pinetrie-offer/x",
          "-T",
          "commit_id",
        ]),
      )
    })
    expect(seen.ok).toBe(true)
    close(owner)
  })

  test("the shared facts are read once per operation: a second lane's step at the same head reads none again; a write reads them anew", async () => {
    const { dir } = await repo("shared")
    const { owner } = own(dir)
    await owner.idle()
    const first = await owner.command(ops => ops.shared())
    const again = await owner.command(ops => ops.shared())
    expect(again).toBe(first)
    const afterWrite = await owner.command(async ops => {
      await ops.execute([host("bookmark", "create", "wip/x", "-r", "@-")])
      return ops.shared()
    })
    expect(afterWrite).not.toBe(first)
    expect(afterWrite.op).not.toBe(first.op)
    close(owner)
  })

  test("your jj describe is observed through the watch, with no timer", async () => {
    const { dir, jj } = await repo("watched")
    const { owner, moves } = own(dir, 10 * 60_000)
    await owner.idle()
    const count = moves.length
    await jj("describe", "-m", "yours")
    expect(await waitFor(() => moves.length > count)).toBe(true)
    expect(moves.at(-1)).toMatchObject({ all: false, yours: true })
    close(owner)
  })

  test("an owner started on two heads observes before it reads: the observation merges them and names the result", async () => {
    const { dir, heads, diverge } = await repo("divergent")
    await diverge()
    expect(await heads()).toHaveLength(2)
    const { owner } = own(dir, 10 * 60_000)
    await owner.idle()
    expect(await heads()).toHaveLength(1)
    const seen = await owner.read(
      async ops =>
        (
          await ops.jj([
            "op",
            "log",
            "--no-graph",
            "-n",
            "1",
            "-T",
            "description",
          ])
        ).stdout,
    )
    expect(seen).toContain("reconcile divergent operations")
    close(owner)
  })

  test("a pinned read with two heads leaves two", async () => {
    const { dir, heads, diverge } = await repo("pinned")
    const { owner } = own(dir, 10 * 60_000)
    await owner.idle()
    // `close` stops the watch and `idle` waits out an observation already
    // queued, so only the read could merge the heads. A closed owner still
    // reads: `read` does not go through the keeper.
    owner.close()
    await owner.idle()
    await diverge()
    await owner.read(ops => ops.jj(["log", "--no-graph", "-r", "@"]))
    expect(await heads()).toHaveLength(2)
  })
})
