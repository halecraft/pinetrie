// Which tools a lane's runs may call, decided without a harness.

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { validateToolArguments } from "@earendil-works/pi-ai"
import {
  BANNER_TOOL,
  type EDIT_TOOL,
  INTENT_FIELD,
  TOOL_IDS,
  type ToolId,
  threadIdFor,
  WRITE_TOOL,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { requireIntent, TAKES_INTENT } from "./intent.ts"
import { threadContext } from "./thread-context.ts"
import { parseCatchUpArgs, proposeTool } from "./thread-tools.ts"
import { assembleTools, TOOLS, toolsChanged } from "./tools.ts"

const unused = async (): Promise<never> => {
  throw new Error("not called")
}
const input = {
  hooks: {
    turnDone: unused,
    askedAboutConflict: unused,
    configWritten: async () => null,
    catchUp: unused,
    resolveConflict: unused,
    askSplit: unused,
    ask: unused,
    leave: unused,
    readBlob: unused,
  },
  blobs: undefined,
  bannerAsks: unused,
}

describe("TOOLS", () => {
  test.each(TOOL_IDS)("%s is the name of the tool made for it", id => {
    expect(TOOLS[id](input).name).toBe(id)
  })

  test("every tool is registered, in the order the model is given them", () => {
    expect(
      assembleTools(input).registered.map(t => (t as { name: string }).name),
    ).toEqual([...TOOL_IDS])
  })
})

describe("a write to the lane's pinetrie.json", () => {
  const LANE = threadIdFor("0123456789abcdef")
  const noted = {
    ...input,
    hooks: { ...input.hooks, configWritten: async () => "the host's note" },
  }
  type Run = (...a: unknown[]) => Promise<{ content: { text?: string }[] }>
  const run = async (
    id: typeof WRITE_TOOL | typeof EDIT_TOOL,
    params: object,
  ) => {
    const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-tools-"))
    const env = new NodeExecutionEnv({ cwd: dir })
    const tool = TOOLS[id](noted) as unknown as { execute: Run }
    const result = await tool.execute(
      "call",
      params,
      () => {},
      { env, dir },
      undefined,
      threadContext(LANE, BACKGROUND_CONTEXT),
    )
    return { texts: result.content.map(c => c.text ?? ""), dir }
  }

  test("its reply carries the host's note; another file's does not", async () => {
    const config = await run(WRITE_TOOL, {
      path: "pinetrie.json",
      content: "{}",
    })
    expect(config.texts.at(-1)).toBe("the host's note")
    expect(await readFile(path.join(config.dir, "pinetrie.json"), "utf8")).toBe(
      "{}",
    )
    const other = await run(WRITE_TOOL, {
      path: "sub/pinetrie.json",
      content: "{}",
    })
    expect(other.texts).not.toContain("the host's note")
  })
})

describe("TOOL_IDS", () => {
  // The order is part of every request's prefix: pinned, not derived.
  test("every tool, in its pinned order, every run", () => {
    expect([...TOOL_IDS]).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ask_about_conflict",
      "catch_up",
      "split_proposed_changes",
      BANNER_TOOL,
      "ask",
      "leave",
      "resolve_conflict",
      "save_blob",
      "propose_branches",
    ])
  })
})

describe("toolsChanged", () => {
  test("the same tools in another order are no change", () => {
    expect(toolsChanged(["a", "b"], ["b", "a"])).toBe(false)
  })

  test("a missing or an extra tool is a change", () => {
    expect(toolsChanged(["a", "b"], ["a"])).toBe(true)
    expect(toolsChanged(["a"], ["a", "b"])).toBe(true)
    expect(toolsChanged(["a", "b"], ["a", "c"])).toBe(true)
  })
})

describe("propose_branches", () => {
  test("a proposal's result holds it as details; a blank brief fails, with no details", async () => {
    const tool = proposeTool()
    const proposal = { branches: [{ title: "one", brief: "do one" }] }
    const done = await tool.execute("c1", proposal)
    expect(done.details).toEqual(proposal)
    expect(done.content[0]?.text).toContain("Proposed 1 branch: one")
    await expect(
      tool.execute("c2", { branches: [{ title: "one", brief: " " }] }),
    ).rejects.toThrow("branch 1 needs a title and a brief")
  })
})

describe("parseCatchUpArgs", () => {
  test("the parent only when named; the base otherwise", () => {
    expect(parseCatchUpArgs({ from: "parent" })).toBe("parent")
    expect(parseCatchUpArgs({ from: "base" })).toBe("base")
    expect(parseCatchUpArgs({})).toBe("base")
    expect(parseCatchUpArgs({ from: "elsewhere" })).toBe("base")
  })
})

describe("a tool's intent", () => {
  type Tool = {
    readonly name: string
    readonly parameters: object
    readonly execute: (...a: unknown[]) => Promise<unknown>
  }
  const registered = () => assembleTools(input).registered as Tool[]
  const call = (name: string, args: Record<string, unknown>) => ({
    type: "toolCall" as const,
    id: "c",
    name,
    arguments: args as never,
  })

  test("a tool requires an intent exactly when its entry says so", () => {
    for (const tool of registered())
      expect([
        tool.name,
        (tool.parameters as { required?: string[] }).required?.includes(
          INTENT_FIELD,
        ) ?? false,
      ]).toEqual([tool.name, TAKES_INTENT[tool.name as ToolId]])
    expect(
      Object.entries(TAKES_INTENT).flatMap(([id, takes]) =>
        takes ? [id] : [],
      ),
    ).toEqual(["bash", "edit", "write"])
  })

  test("a call without an intent is refused by validation", () => {
    const bash = registered().find(t => t.name === "bash")
    if (bash === undefined) throw new Error("no bash")
    expect(() =>
      validateToolArguments(bash as never, call("bash", { command: "ls" })),
    ).toThrow(/intent/)
    expect(
      validateToolArguments(
        bash as never,
        call("bash", { intent: "List the files", command: "ls" }),
      ),
    ).toMatchObject({ intent: "List the files", command: "ls" })
  })

  test("pi's execute never sees the intent", async () => {
    const seen: unknown[] = []
    const tool = requireIntent({
      name: "bash",
      parameters: { properties: { command: {} }, required: ["command"] },
      execute: async (...args: unknown[]) => {
        seen.push(args[1])
        return { content: [] }
      },
    })
    await tool.execute("c", { intent: "List the files", command: "ls" }, null)
    expect(seen).toEqual([{ command: "ls" }])
    expect(tool.parameters.required).toEqual([INTENT_FIELD, "command"])
  })
})
