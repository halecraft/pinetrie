// A lane's directory, as pi uses it (ADR-0032, ADR-0034). Co-located inside packages/pi,
// like agent.test.ts: it drives pi's harness, which only this package may
// import.

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type EntryId,
  type LaneName,
  messageText,
  ROOT,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { encodeChat } from "@pineta/marginalia"
import { newSessionDoc, readEntries, rowMessage } from "@pineta/schema"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createAgent, withoutFrontmatter } from "./agent.ts"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import type { LaneAccess } from "./lanes.ts"
import { scriptedModel } from "./scripted.ts"

test("withoutFrontmatter: a skill's instructions, not its header", () => {
  expect(withoutFrontmatter("---\nname: x\n---\n\n# Do\nit\n")).toBe("# Do\nit")
  expect(withoutFrontmatter("# plain\n")).toBe("# plain")
})

// ── a harness with a scripted model ───────────────────────────────────────

describe("lanes in a harness", () => {
  let root = ""
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "pineta-lanes-")))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const ADA = writerId("ada")
  const prompt = (text: string) =>
    encodeChat(
      {
        author: ADA,
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: text,
      },
      Date.now(),
    )

  /** An agent whose lanes work where `wheres` says, recording what happens. */
  async function setUp(
    wheres: Map<LaneName, LaneAccess>,
    turns: string[] = [],
  ) {
    const doc = newSessionDoc()
    const script = scriptedModel()
    const agent = await createAgent({
      doc,
      replicaId: "test",
      model: { kind: "scripted", script },
      tools: {
        project: root,
        access: lane => {
          const where = wheres.get(lane)
          if (where === undefined) throw new Error(`no access for ${lane}`)
          return where
        },
        hooks: {
          async turnDone(_lane, tip) {
            turns.push(`start ${tip}`)
            await new Promise(r => setTimeout(r, 20))
            turns.push("end")
          },
          askedForGuidance() {},
        },
      },
    })
    const newLane = async (where: LaneAccess) => {
      const made = await agent.createThreadLane(ROOT)
      if (made.kind !== "created") throw new Error("no lane")
      wheres.set(made.lane, where)
      return made.lane
    }
    /** Every stored message's text, in id order. */
    const texts = () =>
      Object.values(readEntries(doc))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(row => ({ id: row.id, message: rowMessage(row) }))
    return { agent, script, newLane, texts, doc }
  }

  const where = (dir: string): LaneAccess => ({
    kind: "direct",
    dir,
    ready: Promise.resolve(),
  })

  test("two lanes at once each run their tools in their own directory", async () => {
    const [a, b] = [path.join(root, "a"), path.join(root, "b")]
    const { mkdir } = await import("node:fs/promises")
    await mkdir(a)
    await mkdir(b)
    const { agent, script, newLane, texts } = await setUp(new Map())
    const la = await newLane(where(a))
    const lb = await newLane(where(b))
    // The two runs take steps from one script as they request them; the
    // steps are alike, so their order does not matter.
    script.use([
      { tool: "bash", args: { command: "pwd" } },
      { tool: "bash", args: { command: "pwd" } },
      { text: "done" },
      { text: "done" },
    ])
    await Promise.all([
      agent.lane(la).run(prompt("go a")),
      agent.lane(lb).run(prompt("go b")),
    ])
    const results = texts()
      .filter(t => (t.message as { role?: string }).role === "toolResult")
      .map(t => messageText(t.message as never).trim())
    expect(results.sort()).toEqual([a, b].sort())
    await agent.close()
  })

  test("a tool waits for setup; the model does not", async () => {
    const dir = path.join(root, "slow")
    let release = () => {}
    const ready = new Promise<void>(r => {
      release = r
    })
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({ kind: "direct", dir, ready })
    script.use([
      { tool: "bash", args: { command: "cat marker.txt" } },
      { text: "done" },
    ])
    const running = agent.lane(lane).run(prompt("read the marker"))
    // The directory only exists once "setup" makes it.
    await new Promise(r => setTimeout(r, 100))
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    await writeFile(path.join(dir, "marker.txt"), "set up\n")
    release()
    await running
    expect(
      texts().some(t => messageText(t.message as never).includes("set up")),
    ).toBe(true)
    await agent.close()
  })

  test("a lane of its own runs its tools through its helper, and is told where your working copy is", async () => {
    const dir = path.join(root, "own")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const channel: LaneChannel = openChannel([
      "env",
      `PINETA_LANE_DIR=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({
      kind: "lane",
      dir,
      gate: async () => channel,
    })
    script.use([
      { tool: "write", args: { path: "made.txt", content: "in the lane\n" } },
      { tool: "bash", args: { command: "pwd; cat made.txt" } },
      {
        // The system prompt is the first message the model is sent.
        reply: context => {
          told = context[0] ?? ""
          return "done"
        },
      },
    ])
    let told = ""
    await agent.lane(lane).run(prompt("write, then look"))
    const all = texts().map(t => messageText(t.message as never))
    expect(all.some(t => t.includes(`${dir}\nin the lane`))).toBe(true)
    expect(told).toContain(`at ${dir}`)
    expect(told).toContain("working copy is at /yours, read-only")
    channel.close()
    await channel.closed
    await agent.close()
  })

  test("after a crash, the lane is resumed in its own directory", async () => {
    const [before, after] = [path.join(root, "c1"), path.join(root, "c2")]
    const { mkdir } = await import("node:fs/promises")
    await mkdir(before)
    await mkdir(after)
    // The first process: its tool call is still running when it "crashes".
    const first = await setUp(new Map())
    const lane = await first.newLane(where(before))
    first.script.use([{ tool: "bash", args: { command: "sleep 2" } }])
    void first.agent.lane(lane).run(prompt("crash"))
    await new Promise(r => setTimeout(r, 300))
    // The next process, over the same document: a second agent.
    const wheres = new Map([[lane, where(after)]])
    const script = scriptedModel()
    const second = await createAgent({
      doc: first.doc,
      replicaId: "after",
      model: { kind: "scripted", script },
      tools: {
        project: root,
        access: l => wheres.get(l) ?? where(root),
        hooks: { turnDone: async () => {}, askedForGuidance() {} },
      },
    })
    expect(await second.interrupted()).toEqual([lane])
    expect(await second.lane(lane).run(prompt("again"))).toMatchObject({
      kind: "refused",
    })
    script.use([{ tool: "bash", args: { command: "pwd" } }, { text: "done" }])
    expect(await second.lane(lane).resume()).toEqual({ kind: "ok" })
    const results = first
      .texts()
      .filter(t => (t.message as { role?: string }).role === "toolResult")
      .map(t => messageText(t.message as never))
    expect(results.some(r => r.includes("interrupted"))).toBe(true)
    expect(results.some(r => r.trim() === after)).toBe(true)
    expect(await second.interrupted()).toEqual([])
    await second.close()
  })

  test("each turn is recorded before the next request, the first at the prompt", async () => {
    const dir = path.join(root, "turns")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const turns: string[] = []
    const { agent, script, newLane, texts } = await setUp(new Map(), turns)
    const lane = await newLane(where(dir))
    script.use([
      { tool: "bash", args: { command: "true" } },
      {
        reply: () => {
          turns.push("request")
          return "done"
        },
      },
    ])
    await agent.lane(lane).run(prompt("turns"))
    const ids = texts().map(t => t.id)
    const [promptId, , resultId, finalId] = ids as EntryId[]
    expect(turns).toEqual([
      `start ${promptId}`,
      "end",
      `start ${resultId}`,
      "end",
      "request",
      `start ${finalId}`,
      "end",
    ])
    await agent.close()
  })
})
