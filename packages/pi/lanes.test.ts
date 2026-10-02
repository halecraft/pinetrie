// A lane's directory, as pi uses it (ADR-0032, ADR-0034). Co-located inside packages/pi,
// like agent.test.ts: it drives pi's harness, which only this package may
// import.

import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type EntryId,
  type LaneName,
  laneNameForThread,
  messageText,
  ROOT,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { encodeChat } from "@pineta/marginalia"
import { newSessionDoc, readEntries, rowMessage } from "@pineta/schema"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createAgent, newId, withoutFrontmatter } from "./agent.ts"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import { type LaneAccess, type LaneFacts, laneGuidelines } from "./lanes.ts"
import { scriptedModel } from "./scripted.ts"

test("withoutFrontmatter: a skill's instructions, not its header", () => {
  expect(withoutFrontmatter("---\nname: x\n---\n\n# Do\nit\n")).toBe("# Do\nit")
  expect(withoutFrontmatter("# plain\n")).toBe("# plain")
})

// ── what a lane of its own is told (ADR-0046) ────────────────────────────

/** A lane's facts with nothing granted, no shared directory and no browser. */
const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  dir: "/workspace",
  shared: [],
  offer: "pineta-offer/quiet-otter",
  grants: { ssh: false, env: [], mounts: [] },
  browser: false,
  install: "/pineta",
  note: "/pineta/packages/pi/lane.md",
  ...over,
})

describe("laneGuidelines", () => {
  const text = (f: LaneFacts) => laneGuidelines(f).join("\n")

  test("names the lane's directory, offer, install and note as given", () => {
    const told = text(facts())
    expect(told).toContain("your own jj repo at /workspace")
    expect(told).toContain("one commit, `pineta-offer/quiet-otter`,")
    expect(told).toContain("/pineta is Pineta's install, not your project")
    expect(told).toContain("when you need it: /pineta/packages/pi/lane.md")
    expect(told).toContain(
      "/mnt/host-working-copy is the person's working copy",
    )
  })

  test("with no name yet, the offer has no bookmark to give", () => {
    const told = text(facts({ offer: null }))
    expect(told).toContain("your work as one commit, and never sees")
    expect(told).not.toContain("pineta-offer")
  })

  test("one line per shared directory, and none without", () => {
    expect(text(facts())).not.toContain("shared live")
    const lines = laneGuidelines(facts({ shared: [".plans", "notes"] }))
    expect(lines.filter(l => l.includes("shared live"))).toEqual([
      "/workspace/.plans is shared live with the person and other threads, never committed.",
      "/workspace/notes is shared live with the person and other threads, never committed.",
    ])
  })

  test("says what is granted, and nothing when nothing is", () => {
    expect(text(facts())).toContain("or credentials. The internet works")
    expect(
      text(
        facts({
          grants: {
            ssh: true,
            env: ["NPM_TOKEN", "CI"],
            mounts: ["/data", "/ref"],
          },
        }),
      ),
    ).toContain(
      "or credentials except your ssh agent, $NPM_TOKEN, $CI, read-only files at /data, /ref. ",
    )
    expect(
      text(facts({ grants: { ssh: false, env: ["CI"], mounts: [] } })),
    ).toContain("or credentials except $CI. ")
  })

  test("names the browser only on an image that has one", () => {
    expect(text(facts())).not.toContain("Chromium")
    expect(text(facts({ browser: true }))).toContain(
      "Chromium's headless shell is installed",
    )
  })

  test("every source lane.md names is a file that still has its symbol", () => {
    const repo = path.join(import.meta.dirname, "../..")
    const note = readFileSync(path.join(import.meta.dirname, "lane.md"), "utf8")
    const sources = [...note.matchAll(/<!-- (\S+) (\S+) -->/g)]
    expect(sources.length).toBeGreaterThan(20)
    const missing = sources.flatMap(([, file = "", symbol = ""]) => {
      const at = path.join(repo, file)
      if (!existsSync(at)) return [`${file} (no such file)`]
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const word = new RegExp(`(^|[^\\w$])${escaped}($|[^\\w$])`, "m")
      return word.test(readFileSync(at, "utf8")) ? [] : [`${file} ${symbol}`]
    })
    expect(missing).toEqual([])
  })

  test("no two lines are equal, since pi drops a repeated guideline", () => {
    const lines = laneGuidelines(
      facts({
        shared: [".plans", "notes"],
        browser: true,
        grants: { ssh: true, env: ["A"], mounts: ["/m"] },
      }),
    )
    expect(new Set(lines).size).toBe(lines.length)
  })
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
      const made = await agent.createThreadLane(
        ROOT,
        laneNameForThread(newId()),
      )
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

  test("a lane of its own runs its tools through its helper, and its rules tell it about the lane", async () => {
    const dir = path.join(root, "own")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const channel: LaneChannel = openChannel([
      "env",
      `PINETA_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({
      kind: "lane",
      facts: facts({ dir, shared: [".plans"] }),
      hostPaths: [],
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
    // In <rules>: `pi-anthropic-auth` keeps it when it rebuilds the prompt (S23).
    const rules = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(told)?.[1] ?? ""
    for (const line of laneGuidelines(facts({ dir, shared: [".plans"] })))
      expect(rules).toContain(`- ${line}`)
    expect(rules).toContain("one commit, `pineta-offer/quiet-otter`,")
    expect(rules).toContain(`${dir}/.plans is shared live with the person`)
    expect(rules).toContain("when you need it: /pineta/packages/pi/lane.md")
    channel.close()
    await channel.closed
    await agent.close()
  })

  test("a lane that works directly is told nothing of a lane", async () => {
    const dir = path.join(root, "plain")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const { agent, script, newLane } = await setUp(new Map())
    const lane = await newLane(where(dir))
    let told = ""
    script.use([
      {
        reply: context => {
          told = context[0] ?? ""
          return "done"
        },
      },
    ])
    await agent.lane(lane).run(prompt("look"))
    expect(told).toContain("<rules>")
    expect(told).not.toContain("Pineta lane")
    expect(told).not.toContain("Pineta commits your changes")
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
