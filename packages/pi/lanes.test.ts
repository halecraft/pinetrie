// A lane's directory, as pi uses it. In packages/pi because it drives pi's
// harness, which only this package may import.

import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core"
import {
  type EntryId,
  ERR,
  pointId,
  ROOT,
  THE_AGENT,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  BEHIND_TYPE,
  encodeBehind,
  encodeMessage,
  PINNED_RULE,
} from "@pinetrie/rules"
import { type RootDocHandle, readEntries, rowMessage } from "@pinetrie/schema"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { messageText } from "@pinetrie/threads"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { newId } from "./agent.ts"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import {
  conflictTool,
  type LaneAccess,
  type LaneFacts,
  laneGuidelines,
  laneToolContext,
  NO_CONFLICTS,
  skillsInLane,
  systemPromptFor,
} from "./lanes.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { type ScriptedModel, scriptedModel } from "./scripted.ts"
import { startPi } from "./start-pi.ts"
import { threadContext } from "./thread-context.ts"
import { assembleTools } from "./tools.ts"

// ── what a lane of its own is told ───────────────────────────────────────

/** A lane's facts with nothing granted, no shared directory, on a project's own image. */
const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  dir: "/workspace",
  shared: [],
  grants: {
    ssh: { personal: null, services: [] },
    nestedDockerNote: null,
    env: [],
    mounts: [],
  },
  defaultImage: false,
  install: "/pinetrie",
  note: "/pinetrie/packages/pi/lane.md",
  ...over,
})

test("laneToolContext: no access is no lane, named by the project's root, whose every call is refused; a lane of its own carries its facts", async () => {
  const none = laneToolContext(null, "/repo")
  expect({ dir: none.dir, lane: none.lane }).toEqual({
    dir: "/repo",
    lane: null,
  })
  const ran = await none.env.exec("echo hi", undefined, BACKGROUND_CONTEXT)
  expect(ran.ok).toBe(false)
  const own = laneToolContext(
    {
      facts: facts(),
      hostPaths: ["/skills"],
      programs: "/pinetrie-runtime/bin",
      shell: "/pinetrie-runtime/shell/bash",
      gate: () => new Promise(() => {}),
    },
    "/repo",
  )
  expect({ dir: own.dir, lane: own.lane }).toEqual({
    dir: "/workspace",
    lane: { facts: facts(), hostPaths: ["/skills"] },
  })
})

test("laneToolContext: a lane of its own runs the runtime's programs by path", async () => {
  const own = laneToolContext(
    {
      facts: facts(),
      hostPaths: [],
      programs: "/pinetrie-runtime/bin",
      shell: "/pinetrie-runtime/shell/bash",
      gate: () => new Promise(() => {}),
    },
    "/repo",
  )
  expect(await own.programs("rg")).toBe("/pinetrie-runtime/bin/rg")
  expect(await own.programs("fd")).toBe("/pinetrie-runtime/bin/fd")
})

test("the prompt no longer tells the model to search with bash", () => {
  const { files } = assembleTools({
    stream: () => {},
    hooks: {
      turnDone: async () => {},
      storeOutputSplit: async () => {},
      askedAboutConflict: async () => false,
      configWritten: async () => null,
      getLatest: async () => {
        throw new Error("no catch_up here")
      },
      resolveConflict: async () => {
        throw new Error("no conflict here")
      },
      askSplit: async () => {
        throw new Error("no split_proposed_changes here")
      },
      ask: async () => {
        throw new Error("unused")
      },
      leave: async () => {
        throw new Error("unused")
      },
      readCard: async () => {
        throw new Error("read_card was not called")
      },
      putImage: async () => {
        throw new Error("put_image was not called")
      },
      readBlob: async () => {
        throw new Error("unused")
      },
    },
    blobs: undefined,
    bannerAsks: async () => {
      throw new Error("unused")
    },
  })
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    files,
  )(laneToolContext(null, "/repo"))
  expect(prompt).not.toContain("file operations like ls, rg, find")
  // pi's rule as it is without our tools, so the check above can fail.
  const without = systemPromptFor({ contextFiles: [], skills: [] }, [
    "read",
    "bash",
  ])(laneToolContext(null, "/repo"))
  expect(without).toContain("file operations like ls, rg, find")
})

test("every thread is told what pinned cards are, once, in a line of its own", () => {
  const prompt = systemPromptFor(
    { contextFiles: [], skills: [] },
    [],
  )(laneToolContext(null, "/repo"))
  expect(prompt.split(PINNED_RULE).length - 1).toBe(1)
  // pi drops a guideline equal to another: the lane's lines stay distinct.
  expect(laneGuidelines(facts())).not.toContain(PINNED_RULE)
})

describe("ask_about_conflict", () => {
  const ask = (taken: boolean) =>
    conflictTool(async () => taken).execute(
      "call-1",
      { question: "which?" },
      undefined,
      undefined,
      undefined,
      threadContext(threadIdFor("0123456789abcdef"), BACKGROUND_CONTEXT),
    )

  test("with a conflict in the copy, it asks; with none, there is nothing to ask", async () => {
    expect((await ask(true)).content[0]?.text).toContain("Asked. Stop here")
    expect((await ask(false)).content[0]?.text).toBe(NO_CONFLICTS)
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

  test("names no bookmark, which changes when the thread is named", () => {
    const told = text(facts())
    expect(told).toContain("your work as one commit, and never sees")
    expect(told).not.toContain("pinetrie-proposed")
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
            ssh: { personal: "all", services: ["deploy", "ci"] },
            nestedDockerNote: null,
            env: ["NPM_TOKEN", "CI"],
            mounts: ["/data", "/ref"],
          },
        }),
      ),
    ).toContain(
      "or credentials except your owner's ssh identity (once they approve this lane), the ssh identities deploy and ci, $NPM_TOKEN, $CI, read-only files at /data, /ref. ",
    )
    expect(
      text(
        facts({
          grants: {
            ssh: { personal: null, services: [] },
            nestedDockerNote: null,
            env: ["CI"],
            mounts: [],
          },
        }),
      ),
    ).toContain("or credentials except $CI. ")
  })

  test("a narrowed identity names its hosts", () => {
    expect(
      text(
        facts({
          grants: {
            ssh: { personal: ["hql", "*.lan"], services: [] },
            nestedDockerNote: null,
            env: [],
            mounts: [],
          },
        }),
      ),
    ).toContain(
      "or credentials except your owner's ssh identity for hql and *.lan (once they approve this lane; no other host). ",
    )
  })

  test("names Docker at $DOCKER_HOST only when lanes inside are granted", () => {
    const without = text(facts())
    expect(without).toContain("No container runtime, model keys or credentials")
    expect(without).not.toContain("DOCKER_HOST")
    const granted = facts().grants
    const told = text(
      facts({
        grants: {
          ...granted,
          nestedDockerNote: "/pinetrie/packages/pi/lane-docker.md",
        },
      }),
    )
    expect(told).toContain("No model keys or credentials")
    expect(told).toContain("at $DOCKER_HOST")
    expect(told).toContain("There is no /var/run/docker.sock")
    expect(told).not.toContain("container runtime")
  })

  test("a nested lane is pointed at the note on its Docker; no other lane is", () => {
    const note = "/pinetrie/packages/pi/lane-docker.md"
    const granted = facts().grants
    expect(
      text(facts({ grants: { ...granted, nestedDockerNote: note } })),
    ).toContain(`Before building or running images here, read ${note}.`)
    expect(text(facts())).not.toContain("lane-docker.md")
  })

  test("names the browser and python3 only on the default image", () => {
    expect(text(facts())).not.toContain("Chromium")
    expect(text(facts())).not.toContain("python3")
    const told = text(facts({ defaultImage: true }))
    expect(told).toContain("Chromium's headless shell is installed")
    expect(told).toContain("and so is python3")
  })

  test("says what is made is the agent's to make, and to keep out of the repo", () => {
    expect(text(facts())).toContain(
      "Nothing installs dependencies for you. After getting the latest, pine·trie removes what commands made from files that changed (node_modules, a build), and its message names what went: make them again as you would after a pull.",
    )
    expect(text(facts())).toContain("add it to .gitignore")
  })

  test("names pine·trie's bash, at the runtime's pinned release, on any image", () => {
    for (const told of [text(facts()), text(facts({ defaultImage: true }))])
      expect(told).toContain(
        "Your bash tool runs commands in pine·trie's own bash 5.3, whatever the image; a script a command runs (#!/bin/bash, bash x.sh) uses the image's bash.",
      )
  })

  test("names the runtime's programs for bash, on any image", () => {
    for (const told of [text(facts()), text(facts({ defaultImage: true }))])
      expect(told).toContain(
        "Search with the grep and find tools. In bash, rg, fd and sd are on PATH: prefer them to grep, find and sed.",
      )
  })

  // The least each note cites, so a change to the comments' form that the
  // pattern below misses fails here rather than passing with none read.
  test.each([
    ["lane.md", 20],
    ["lane-folder.md", 20],
    ["lane-docker.md", 6],
  ])(
    "every source %s names is a file that still has its symbol",
    (name, least) => {
      const repo = path.join(import.meta.dirname, "../..")
      const note = readFileSync(path.join(import.meta.dirname, name), "utf8")
      const sources = [...note.matchAll(/<!-- (\S+) (\S+) -->/g)]
      expect(sources.length).toBeGreaterThan(least)
      const missing = sources.flatMap(([, file = "", symbol = ""]) => {
        const at = path.join(repo, file)
        if (!existsSync(at)) return [`${file} (no such file)`]
        const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const word = new RegExp(`(^|[^\\w$])${escaped}($|[^\\w$])`, "m")
        return word.test(readFileSync(at, "utf8")) ? [] : [`${file} ${symbol}`]
      })
      expect(missing).toEqual([])
    },
  )

  test("no two lines are equal, since pi drops a repeated guideline", () => {
    const lines = laneGuidelines(
      facts({
        shared: [".plans", "notes"],
        defaultImage: true,
        grants: {
          ssh: { personal: "all", services: ["deploy"] },
          nestedDockerNote: "/pinetrie/packages/pi/lane-docker.md",
          env: ["A"],
          mounts: ["/m"],
        },
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
    encodeMessage(
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
    wheres: Map<ThreadId, LaneAccess | null>,
    turns: string[] = [],
  ) {
    const doc = newRootDoc()
    const script = scriptedModel()
    const { agent } = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script },
      project: root,
      tools: {
        bannerAsks: async () => {
          throw new Error("unused")
        },
        access: lane => {
          const where = wheres.get(lane)
          if (where === undefined) throw new Error(`no access for ${lane}`)
          return where
        },
        hooks: {
          storeOutputSplit: async () => {},
          async turnDone(_lane, tip) {
            turns.push(`start ${tip}`)
            await new Promise(r => setTimeout(r, 20))
            turns.push("end")
          },
          askedAboutConflict: async () => false,
          configWritten: async () => null,
          getLatest: async () => {
            throw new Error("no catch_up here")
          },
          resolveConflict: async () => {
            throw new Error("no conflict here")
          },
          askSplit: async () => {
            throw new Error("no split_proposed_changes here")
          },
          ask: async () => {
            throw new Error("unused")
          },
          leave: async () => {
            throw new Error("unused")
          },
          readCard: async () => {
            throw new Error("read_card was not called")
          },
          putImage: async () => {
            throw new Error("put_image was not called")
          },
          readBlob: async () => {
            throw new Error("unused")
          },
        },
      },
    })
    const newLane = async (where: LaneAccess | null) => {
      const made = await agent.createThreadLane(
        { root: ONE_ROOT, at: ROOT },
        threadIdFor(newId()),
      )
      if (made.kind !== "created") throw new Error("no lane")
      wheres.set(made.lane, where)
      return made.lane
    }
    /** Every stored message's text, in id order. */
    // The lane's prompt, which a run writes before its first request, is
    // left out: `agent.test.ts` checks it.
    const texts = () =>
      Object.values(readEntries(doc))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(row => ({ id: row.id, message: rowMessage(row) }))
        .filter(
          t => (t.message as { role?: string } | undefined)?.role !== "system",
        )
    return { agent, script, newLane, texts, doc }
  }

  /** The next process's agent over `doc`, as a restart makes it, its tools unused. */
  async function nextAgent(
    doc: RootDocHandle,
    script: ScriptedModel,
    replicaId: string,
    access: (lane: ThreadId) => LaneAccess | null = () => null,
  ) {
    const { agent } = await startPi(oneRoot(doc), {
      replicaId,
      model: { kind: "scripted", script },
      project: root,
      tools: {
        bannerAsks: async () => {
          throw new Error("unused")
        },
        access,
        hooks: {
          turnDone: async () => {},
          storeOutputSplit: async () => {},
          askedAboutConflict: async () => false,
          configWritten: async () => null,
          getLatest: async () => {
            throw new Error("no catch_up here")
          },
          resolveConflict: async () => {
            throw new Error("no conflict here")
          },
          askSplit: async () => {
            throw new Error("no split_proposed_changes here")
          },
          ask: async () => {
            throw new Error("unused")
          },
          leave: async () => {
            throw new Error("unused")
          },
          readCard: async () => {
            throw new Error("read_card was not called")
          },
          putImage: async () => {
            throw new Error("put_image was not called")
          },
          readBlob: async () => {
            throw new Error("unused")
          },
        },
      },
    })
    return agent
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
      shell: "bash",
      gate: async () => {
        await ready
        return { channel, observation: null }
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
      shell: "bash",
      gate: async () => ({ channel, observation: null }),
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
    // In <rules>: `pi-anthropic-auth` keeps it when it rebuilds the prompt.
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
      shell: "bash",
      gate: async () => ({ channel, observation: null }),
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
    // It ends only as the harness closes under it, below.
    const crashed = first.agent.lane(lane).run(prompt("crash"), [])
    await new Promise(r => setTimeout(r, 300))
    // The next process, over the same document: a second agent.
    const script = scriptedModel()
    const own = where(after)
    const second = await nextAgent(first.doc, script, "after", l =>
      l === lane ? own : where(root),
    )
    expect(await second.interrupted([ONE_ROOT])).toEqual([lane])
    // A lane skipped is not asked of: its inspection would wait for a run.
    expect(await second.interrupted([ONE_ROOT], l => l === lane)).toEqual([])
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
    // The crashed process would be gone: its tool call must not write after.
    await first.agent.close()
    expect(await crashed).toEqual({ kind: "interrupted" })
  })

  /** Resolves once `held`'s request has reached the model. */
  const reached = async (held: { readonly reached: boolean }) => {
    while (!held.reached) await new Promise(r => setTimeout(r, 5))
  }

  test("an agent closed while its run waits on the model: the run is interrupted, and the next agent finds the lane left open", async () => {
    const first = await setUp(new Map())
    const lane = await first.newLane(null)
    const held = first.script.hold("cut off")
    const cut = first.agent.lane(lane).run(prompt("cut off"), [])
    await reached(held)
    await first.agent.close()
    expect(await cut).toEqual({ kind: "interrupted" })
    const next = await nextAgent(first.doc, first.script, "next")
    const handle = next.lane(lane)
    expect(await handle.isLeftOpen()).toBe(true)
    const busy = { kind: "refused", code: ERR.BUSY }
    expect(await handle.run(prompt("again"), [])).toEqual(busy)
    expect(await handle.append(prompt("meanwhile"))).toEqual(busy)
    first.script.use([{ text: "resumed" }])
    expect(await handle.resume()).toEqual({ kind: "ok" })
    expect(await handle.isLeftOpen()).toBe(false)
    first.script.use([{ text: "and then" }])
    expect(await handle.run(prompt("after"), [])).toMatchObject({ kind: "ok" })
    await next.close()
  })

  test("a resume its agent closes under is interrupted, and the lane stays left open", async () => {
    const first = await setUp(new Map())
    const lane = await first.newLane(null)
    const held = first.script.hold("cut off")
    const cut = first.agent.lane(lane).run(prompt("cut off"), [])
    await reached(held)
    await first.agent.close()
    await cut
    const second = await nextAgent(first.doc, first.script, "second")
    const again = first.script.hold("cut off")
    const resumed = second.lane(lane).resume()
    await reached(again)
    await second.close()
    expect(await resumed).toEqual({ kind: "interrupted" })
    const third = await nextAgent(first.doc, first.script, "third")
    expect(await third.lane(lane).isLeftOpen()).toBe(true)
    await third.close()
  })

  test("a lane this agent is driving is not left open, and an append to it is queued into the run", async () => {
    const { agent, script, newLane } = await setUp(new Map())
    const lane = await newLane(null)
    const held = script.hold("driving")
    const ran = agent.lane(lane).run(prompt("driving"), [])
    await reached(held)
    expect(await agent.lane(lane).isLeftOpen()).toBe(false)
    expect(await agent.lane(lane).append(prompt("into the run"))).toMatchObject(
      { kind: "appended" },
    )
    held.finish()
    expect(await ran).toMatchObject({ kind: "ok" })
    await agent.close()
  })

  test("a run's last turn is recorded at its newest entry, however it ends: a Stop, or a model that fails", async () => {
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
    const paused = script.hold("held")
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
      promptChanged: [],
    })
    expect(lastIsNewest()).toBe(true)
    await agent.close()
  })

  test("a steer lands after the tool results of the turn in flight, before the next request", async () => {
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
        to: pointId("l2"),
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
      "pinetrie.message",
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

test("a lane reads a project's skill in its own copy, a granted one under /mnt/host, and no other", () => {
  const skill = (dir: string) => ({
    name: path.basename(dir),
    filePath: `${dir}/SKILL.md`,
    baseDir: dir,
  })
  expect(
    skillsInLane(
      [
        skill("/proj/skills/mine"),
        skill("/ai/duane/skills/plan"),
        skill("/elsewhere/x"),
      ],
      ["/ai/duane"],
      "/proj",
    ).map(s => s.filePath),
  ).toEqual([
    "/workspace/skills/mine/SKILL.md",
    "/mnt/host/ai/duane/skills/plan/SKILL.md",
  ])
})
