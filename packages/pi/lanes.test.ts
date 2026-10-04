// A lane's directory, as pi uses it (ADR-0032, ADR-0034). Co-located inside packages/pi,
// like agent.test.ts: it drives pi's harness, which only this package may
// import.

import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core"
import {
  type EntryId,
  type LaneName,
  laneNameForThread,
  messageText,
  ROOT,
  THE_AGENT,
  writerId,
} from "@pineta/core"
import { encodeChat, PINNED_RULE } from "@pineta/marginalia"
import { newRootDoc, readEntries, rowMessage } from "@pineta/schema"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createAgent, newId } from "./agent.ts"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import {
  guidanceTool,
  type LaneAccess,
  type LaneFacts,
  laneContext,
  laneGuidelines,
  NOT_LANDING,
  rememberedProgram,
  type SearchProgram,
  systemPromptFor,
  toolContextOf,
} from "./lanes.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { scriptedModel } from "./scripted.ts"
import { assembleTools } from "./tools.ts"

// ── what a lane of its own is told (ADR-0046) ────────────────────────────

/** A lane's facts with nothing granted, no shared directory, on a project's own image. */
const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  dir: "/workspace",
  shared: [],
  grants: { ssh: false, env: [], mounts: [] },
  defaultImage: false,
  install: "/pineta",
  note: "/pineta/packages/pi/lane.md",
  ...over,
})

test("toolContextOf: a direct lane is no lane; a lane of its own carries its facts", () => {
  const direct = toolContextOf({
    kind: "direct",
    dir: "/repo",
    ready: Promise.resolve(),
  })
  expect({ dir: direct.dir, lane: direct.lane }).toEqual({
    dir: "/repo",
    lane: null,
  })
  const own = toolContextOf({
    kind: "lane",
    facts: facts(),
    hostPaths: ["/skills"],
    programs: "/pineta-runtime/bin",
    gate: () => new Promise(() => {}),
  })
  expect({ dir: own.dir, lane: own.lane }).toEqual({
    dir: "/workspace",
    lane: { facts: facts(), hostPaths: ["/skills"] },
  })
})

test("toolContextOf: a lane of its own runs the runtime's programs by path", async () => {
  const own = toolContextOf({
    kind: "lane",
    facts: facts(),
    hostPaths: [],
    programs: "/pineta-runtime/bin",
    gate: () => new Promise(() => {}),
  })
  expect(await own.programs("rg")).toBe("/pineta-runtime/bin/rg")
  expect(await own.programs("fd")).toBe("/pineta-runtime/bin/fd")
})

test("rememberedProgram: a found path is asked once; a null is asked again", async () => {
  const asked: SearchProgram[] = []
  const answers: (string | null)[] = [null, "/bin/rg"]
  const programs = rememberedProgram(async program => {
    asked.push(program)
    const next = answers.shift()
    if (next === undefined) throw new Error("asked a third time")
    return next
  })
  expect(await programs("rg")).toBe(null)
  expect(await programs("rg")).toBe("/bin/rg")
  expect(await programs("rg")).toBe("/bin/rg")
  expect(asked).toEqual(["rg", "rg"])
})

test("the prompt no longer tells the model to search with bash", () => {
  const { files } = assembleTools({
    hooks: { turnDone: async () => {}, askedForGuidance: () => false },
    blobs: undefined,
    bannerAsks: undefined,
  })
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    files,
  )(toolContextOf({ kind: "direct", dir: "/repo", ready: Promise.resolve() }))
  expect(prompt).not.toContain("file operations like ls, rg, find")
  // pi's rule as it is without our tools, so the check above can fail.
  const without = systemPromptFor({ contextFiles: [], skills: [] }, [
    "read",
    "bash",
  ])(toolContextOf({ kind: "direct", dir: "/repo", ready: Promise.resolve() }))
  expect(without).toContain("file operations like ls, rg, find")
})

test("every thread is told what pinned cards are, once, in a line of its own (ADR-0048)", () => {
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    [],
  )(toolContextOf({ kind: "direct", dir: "/repo", ready: Promise.resolve() }))
  expect(prompt.split(PINNED_RULE).length - 1).toBe(1)
  // pi drops a guideline equal to another: the lane's lines stay distinct.
  expect(laneGuidelines(facts())).not.toContain(PINNED_RULE)
})

describe("ask_for_guidance", () => {
  const ask = (taken: boolean) =>
    guidanceTool(() => taken).execute(
      "call-1",
      { question: "which?" },
      undefined,
      undefined,
      undefined,
      laneContext(laneNameForThread("0123456789abcdef"), BACKGROUND_CONTEXT),
    )

  test("in a landing, it asks; elsewhere it says there is nothing to ask", async () => {
    expect((await ask(true)).content[0]?.text).toContain("Asked. Stop here")
    expect((await ask(false)).content[0]?.text).toBe(NOT_LANDING)
  })
})

describe("laneGuidelines", () => {
  const text = (f: LaneFacts) => laneGuidelines(f).join("\n")

  test("names the lane's directory, install and note as given", () => {
    const told = text(facts())
    expect(told).toContain("your own jj repo at /workspace")
    expect(told).toContain("/pineta is Pineta's install, not your project")
    expect(told).toContain("when you need it: /pineta/packages/pi/lane.md")
    expect(told).toContain(
      "/mnt/host-working-copy is the person's working copy",
    )
  })

  test("names no bookmark, which changes when the thread is named (S85)", () => {
    const told = text(facts())
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

  test("names the browser and python3 only on the default image", () => {
    expect(text(facts())).not.toContain("Chromium")
    expect(text(facts())).not.toContain("python3")
    const told = text(facts({ defaultImage: true }))
    expect(told).toContain("Chromium's headless shell is installed")
    expect(told).toContain("and so is python3")
  })

  test("names the runtime's programs for bash, on any image", () => {
    for (const told of [text(facts()), text(facts({ defaultImage: true }))])
      expect(told).toContain(
        "Search with the grep and find tools. In bash, rg, fd and sd are on PATH: prefer them to grep, find and sed.",
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
        defaultImage: true,
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
    const doc = newRootDoc()
    const script = scriptedModel()
    const agent = await createAgent({
      documents: oneRoot(doc),
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
          askedForGuidance: () => false,
        },
      },
    })
    const newLane = async (where: LaneAccess) => {
      const made = await agent.createThreadLane(
        { root: ONE_ROOT, at: ROOT },
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
      agent.lane(la).run(prompt("go a"), null),
      agent.lane(lb).run(prompt("go b"), null),
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
    const running = agent.lane(lane).run(prompt("read the marker"), null)
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
      programs: path.join(dir, "bin"),
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
    await agent.lane(lane).run(prompt("write, then look"), null)
    const all = texts().map(t => messageText(t.message as never))
    expect(all.some(t => t.includes(`${dir}\nin the lane`))).toBe(true)
    // In <rules>: `pi-anthropic-auth` keeps it when it rebuilds the prompt (S23).
    const rules = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(told)?.[1] ?? ""
    for (const line of laneGuidelines(facts({ dir, shared: [".plans"] })))
      expect(rules).toContain(`- ${line}`)
    expect(rules).toContain(`${dir}/.plans is shared live with the person`)
    expect(rules).toContain("when you need it: /pineta/packages/pi/lane.md")
    channel.close()
    await channel.closed
    await agent.close()
  })

  test("grep runs the lane's own rg by path, through its helper, keeping the first lines", async () => {
    const dir = path.join(root, "search")
    const { chmod, mkdir } = await import("node:fs/promises")
    await mkdir(path.join(dir, "bin"), { recursive: true })
    // A stand-in rg: its arguments, then 299 matches, 300 lines in all.
    await writeFile(
      path.join(dir, "bin", "rg"),
      '#!/bin/sh\necho "args $*"\ni=1; while [ $i -lt 300 ]; do echo "f.txt:$i: hit"; i=$((i+1)); done\n',
    )
    await chmod(path.join(dir, "bin", "rg"), 0o755)
    const channel: LaneChannel = openChannel([
      "env",
      `PINETA_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({
      kind: "lane",
      facts: facts({ dir }),
      hostPaths: [],
      programs: path.join(dir, "bin"),
      gate: async () => channel,
    })
    script.use([
      { tool: "grep", args: { pattern: "it's", glob: "*.txt" } },
      { text: "done" },
    ])
    await agent.lane(lane).run(prompt("search"), null)
    const found =
      texts()
        .map(t => messageText(t.message as never))
        .find(t => t.startsWith("args ")) ?? ""
    expect(found).toContain("-g *.txt -- it's")
    expect(found).toContain("f.txt:199: hit")
    expect(found).not.toContain("f.txt:200: hit")
    expect(found).toContain("[limit of 200 lines reached")
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
    await agent.lane(lane).run(prompt("look"), null)
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
    void first.agent.lane(lane).run(prompt("crash"), null)
    await new Promise(r => setTimeout(r, 300))
    // The next process, over the same document: a second agent.
    const wheres = new Map([[lane, where(after)]])
    const script = scriptedModel()
    const second = await createAgent({
      documents: oneRoot(first.doc),
      replicaId: "after",
      model: { kind: "scripted", script },
      tools: {
        project: root,
        access: l => wheres.get(l) ?? where(root),
        hooks: { turnDone: async () => {}, askedForGuidance: () => false },
      },
    })
    expect(await second.interrupted([ONE_ROOT])).toEqual([lane])
    expect(await second.lane(lane).run(prompt("again"), null)).toMatchObject({
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
    expect(await second.interrupted([ONE_ROOT])).toEqual([])
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
    await agent.lane(lane).run(prompt("turns"), null)
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
