// A lane's directory, as pi uses it (ADR-0032, ADR-0034). Co-located inside packages/pi,
// like agent.test.ts: it drives pi's harness, which only this package may
// import.

import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core"
import {
  commitId,
  type EntryId,
  type LaneName,
  laneNameForThread,
  messageText,
  ROOT,
  THE_AGENT,
  writerId,
} from "@pinetrie/core"
import {
  BEHIND_TYPE,
  encodeBehind,
  encodeChat,
  PINNED_RULE,
} from "@pinetrie/rules"
import { readEntries, rowMessage } from "@pinetrie/schema"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { newId } from "./agent.ts"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import {
  conflictTool,
  type LaneAccess,
  type LaneFacts,
  laneContext,
  laneGuidelines,
  NO_CONFLICTS,
  systemPromptFor,
  toolContextOf,
} from "./lanes.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { scriptedModel } from "./scripted.ts"
import { startPi } from "./start-pi.ts"
import { assembleTools } from "./tools.ts"

// ── what a lane of its own is told (ADR-0046) ────────────────────────────

/** A lane's facts with nothing granted, no shared directory, on a project's own image. */
const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  dir: "/workspace",
  shared: [],
  grants: { ssh: false, env: [], mounts: [] },
  defaultImage: false,
  install: "/pinetrie",
  note: "/pinetrie/packages/pi/lane.md",
  ...over,
})

test("toolContextOf: no access is no lane, named by the project's root, whose every call is refused; a lane of its own carries its facts", async () => {
  const none = toolContextOf(null, "/repo")
  expect({ dir: none.dir, lane: none.lane }).toEqual({
    dir: "/repo",
    lane: null,
  })
  const ran = await none.env.exec("echo hi", undefined, BACKGROUND_CONTEXT)
  expect(ran.ok).toBe(false)
  const own = toolContextOf(
    {
      facts: facts(),
      hostPaths: ["/skills"],
      programs: "/pinetrie-runtime/bin",
      gate: () => new Promise(() => {}),
    },
    "/repo",
  )
  expect({ dir: own.dir, lane: own.lane }).toEqual({
    dir: "/workspace",
    lane: { facts: facts(), hostPaths: ["/skills"] },
  })
})

test("toolContextOf: a lane of its own runs the runtime's programs by path", async () => {
  const own = toolContextOf(
    {
      facts: facts(),
      hostPaths: [],
      programs: "/pinetrie-runtime/bin",
      gate: () => new Promise(() => {}),
    },
    "/repo",
  )
  expect(await own.programs("rg")).toBe("/pinetrie-runtime/bin/rg")
  expect(await own.programs("fd")).toBe("/pinetrie-runtime/bin/fd")
})

test("the prompt no longer tells the model to search with bash", () => {
  const { files } = assembleTools({
    hooks: {
      turnDone: async () => {},
      askedAboutConflict: async () => false,
      catchUp: async () => {
        throw new Error("no catch_up here")
      },
      askSplit: async () => {
        throw new Error("no split_offer here")
      },
    },
    blobs: undefined,
    bannerAsks: undefined,
  })
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    files,
  )(toolContextOf(null, "/repo"))
  expect(prompt).not.toContain("file operations like ls, rg, find")
  // pi's rule as it is without our tools, so the check above can fail.
  const without = systemPromptFor({ contextFiles: [], skills: [] }, [
    "read",
    "bash",
  ])(toolContextOf(null, "/repo"))
  expect(without).toContain("file operations like ls, rg, find")
})

test("every thread is told what pinned cards are, once, in a line of its own (ADR-0048)", () => {
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    [],
  )(toolContextOf(null, "/repo"))
  expect(prompt.split(PINNED_RULE).length - 1).toBe(1)
  // pi drops a guideline equal to another: the lane's lines stay distinct.
  expect(laneGuidelines(facts())).not.toContain(PINNED_RULE)
})

describe("ask_about_conflict (ADR-0080)", () => {
  const ask = (taken: boolean) =>
    conflictTool(async () => taken).execute(
      "call-1",
      { question: "which?" },
      undefined,
      undefined,
      undefined,
      laneContext(laneNameForThread("0123456789abcdef"), BACKGROUND_CONTEXT),
    )

  test("with a conflict in the copy, it asks, and its details say so; with none, there is nothing to ask", async () => {
    const taken = await ask(true)
    expect(taken.content[0]?.text).toContain("Asked. Stop here")
    expect(taken.details).toEqual({ asked: true })
    const refused = await ask(false)
    expect(refused.content[0]?.text).toBe(NO_CONFLICTS)
    expect(refused.details).toBeUndefined()
  })
})

describe("laneGuidelines", () => {
  const text = (f: LaneFacts) => laneGuidelines(f).join("\n")

  test("names the lane's directory, install and note as given", () => {
    const told = text(facts())
    expect(told).toContain("your own jj repo at /workspace")
    expect(told).toContain("/pinetrie is pine·trie's install, not your project")
    expect(told).toContain("when you need it: /pinetrie/packages/pi/lane.md")
    expect(told).toContain(
      "/mnt/host-working-copy is the person's working copy",
    )
  })

  test("names no bookmark, which changes when the thread is named (S85)", () => {
    const told = text(facts())
    expect(told).toContain("your work as one commit, and never sees")
    expect(told).not.toContain("pinetrie-offer")
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
    root = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-lanes-")))
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
    wheres: Map<LaneName, LaneAccess | null>,
    turns: string[] = [],
  ) {
    const doc = newRootDoc()
    const script = scriptedModel()
    const { agent } = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script },
      project: root,
      tools: {
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
          askedAboutConflict: async () => false,
          catchUp: async () => {
            throw new Error("no catch_up here")
          },
          askSplit: async () => {
            throw new Error("no split_offer here")
          },
        },
      },
    })
    const newLane = async (where: LaneAccess | null) => {
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

  /** Channels to the helpers `where` opened, closed after each test. */
  const opened: LaneChannel[] = []
  afterEach(async () => {
    for (const channel of opened.splice(0)) {
      channel.close()
      await channel.closed
    }
  })
  /**
   * A lane of its own in `dir`, its helper a local process, as
   * `lane-env.test.ts`'s is: its tools wait for `ready`, the model does not.
   */
  const where = (dir: string, ready = Promise.resolve()): LaneAccess => {
    const channel = openChannel([
      "env",
      `PINETRIE_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    opened.push(channel)
    return {
      facts: facts({ dir }),
      hostPaths: [],
      programs: path.join(dir, "bin"),
      gate: async () => {
        await ready
        return channel
      },
    }
  }

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
      agent.lane(la).run(prompt("go a"), []),
      agent.lane(lb).run(prompt("go b"), []),
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
    const lane = await newLane(where(dir, ready))
    script.use([
      { tool: "bash", args: { command: "cat marker.txt" } },
      { text: "done" },
    ])
    const running = agent.lane(lane).run(prompt("read the marker"), [])
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
      `PINETRIE_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({
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
    await agent.lane(lane).run(prompt("write, then look"), [])
    const all = texts().map(t => messageText(t.message as never))
    expect(all.some(t => t.includes(`${dir}\nin the lane`))).toBe(true)
    // In <rules>: `pi-anthropic-auth` keeps it when it rebuilds the prompt (S23).
    const rules = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(told)?.[1] ?? ""
    for (const line of laneGuidelines(facts({ dir, shared: [".plans"] })))
      expect(rules).toContain(`- ${line}`)
    expect(rules).toContain(`${dir}/.plans is shared live with the person`)
    expect(rules).toContain("when you need it: /pinetrie/packages/pi/lane.md")
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
      `PINETRIE_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      path.join(import.meta.dirname, "lane-helper.ts"),
    ])
    const { agent, script, newLane, texts } = await setUp(new Map())
    const lane = await newLane({
      facts: facts({ dir }),
      hostPaths: [],
      programs: path.join(dir, "bin"),
      gate: async () => channel,
    })
    script.use([
      { tool: "grep", args: { pattern: "it's", glob: "*.txt" } },
      { text: "done" },
    ])
    await agent.lane(lane).run(prompt("search"), [])
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

  test("a lane with no copy of its own is told nothing of a lane", async () => {
    const { agent, script, newLane } = await setUp(new Map())
    const lane = await newLane(null)
    let told = ""
    script.use([
      {
        reply: context => {
          told = context[0] ?? ""
          return "done"
        },
      },
    ])
    await agent.lane(lane).run(prompt("look"), [])
    expect(told).toContain("<rules>")
    expect(told).not.toContain("pine·trie lane")
    expect(told).not.toContain("pine·trie commits your changes")
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
    void first.agent.lane(lane).run(prompt("crash"), [])
    await new Promise(r => setTimeout(r, 300))
    // The next process, over the same document: a second agent.
    const wheres = new Map([[lane, where(after)]])
    const script = scriptedModel()
    const { agent: second } = await startPi(oneRoot(first.doc), {
      replicaId: "after",
      model: { kind: "scripted", script },
      project: root,
      tools: {
        access: l => wheres.get(l) ?? where(root),
        hooks: {
          turnDone: async () => {},
          askedAboutConflict: async () => false,
          catchUp: async () => {
            throw new Error("no catch_up here")
          },
          askSplit: async () => {
            throw new Error("no split_offer here")
          },
        },
      },
    })
    expect(await second.interrupted([ONE_ROOT])).toEqual([lane])
    expect(await second.lane(lane).run(prompt("again"), [])).toMatchObject({
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

  test("a run's last turn is recorded at its newest entry, however it ends: a Stop, or a model that fails (S104)", async () => {
    const dir = path.join(root, "endings")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const turns: string[] = []
    const { agent, script, newLane, texts } = await setUp(new Map(), turns)
    /** Whether the last turn recorded is the lane's newest entry. */
    const lastIsNewest = () => {
      const tips = turns
        .filter(t => t.startsWith("start "))
        .map(t => t.slice(6))
      return tips.at(-1) === texts().at(-1)?.id
    }
    const until = async (f: () => boolean) => {
      while (!f()) await new Promise(r => setTimeout(r, 10))
    }
    // A Stop while the model's reply is held.
    const held = await newLane(where(dir))
    const paused = script.pause("held")
    const holding = agent.lane(held).run(prompt("held"), [])
    await until(() => paused.reached)
    await agent.lane(held).abort()
    await holding
    expect(lastIsNewest()).toBe(true)
    // A Stop while a tool runs.
    const running = await newLane(where(dir))
    script.use([{ tool: "bash", args: { command: "sleep 5" } }])
    const ran = agent.lane(running).run(prompt("running"), [])
    // The call is out once its assistant message is stored.
    await until(() =>
      texts().some(t => {
        const { content } = t.message as { content?: unknown }
        return (
          Array.isArray(content) &&
          content.some(p => (p as { type?: string }).type === "toolCall")
        )
      }),
    )
    await new Promise(r => setTimeout(r, 100))
    await agent.lane(running).abort()
    await ran
    expect(lastIsNewest()).toBe(true)
    // A model that fails: nothing queued, no standing answer.
    const failing = await newLane(where(dir))
    expect(await agent.lane(failing).run(prompt("failing"), [])).toEqual({
      kind: "ok",
    })
    expect(lastIsNewest()).toBe(true)
    await agent.close()
  })

  test("a steer lands after the tool results of the turn in flight, before the next request, which keeps the cache; that request's turn is recorded from it (ADR-0080, S103)", async () => {
    const dir = path.join(root, "steer")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dir)
    const turns: string[] = []
    const { agent, script, newLane, texts } = await setUp(new Map(), turns)
    const lane = await newLane(where(dir))
    script.use([
      { tool: "bash", args: { command: "sleep 0.3" } },
      { text: "done" },
    ])
    const news = encodeBehind(
      {
        from: { kind: "accepted" },
        to: commitId("l2"),
        files: ["a.ts"],
        overlap: [],
        conflicts: [],
      },
      1,
    )
    const ran = agent.lane(lane).run(prompt("steer me"), [])
    // While its bash runs.
    while (
      !texts().some(t => {
        const { content } = t.message as { content?: unknown }
        return (
          Array.isArray(content) &&
          content.some(p => (p as { type?: string }).type === "toolCall")
        )
      })
    )
      await new Promise(r => setTimeout(r, 10))
    expect(await agent.lane(lane).steer(news)).toEqual({ kind: "ok" })
    await ran
    await agent.close()
    const roles = texts().map(t => {
      const m = t.message as { role?: string; customType?: string }
      return m.customType ?? m.role
    })
    expect(roles).toEqual([
      "pinetrie.chat",
      "assistant",
      "toolResult",
      BEHIND_TYPE,
      "assistant",
    ])
    const steered = texts()[3]?.id
    expect(turns).toContain(`start ${steered}`)
    const usage = texts()
      .map(
        t =>
          t.message as {
            role?: string
            usage?: { cacheRead: number; cacheWrite: number }
          },
      )
      .filter(m => m.role === "assistant")
      .map(m => m.usage)
    const [first, second] = usage
    if (first === undefined || second === undefined)
      throw new Error("two replies, each with its usage")
    expect(second.cacheRead).toBeGreaterThanOrEqual(
      first.cacheRead + first.cacheWrite - 1,
    )
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
    await agent.lane(lane).run(prompt("turns"), [])
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
