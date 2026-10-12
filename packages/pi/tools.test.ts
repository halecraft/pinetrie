// Which tools a lane's runs may call, decided without a harness.

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import {
  BANNER_TOOL,
  type EDIT_TOOL,
  TOOL_IDS,
  threadIdFor,
  WRITE_TOOL,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { threadContext } from "./thread-context.ts"
import { parseCatchUpArgs } from "./thread-tools.ts"
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
    askSplit: unused,
    ask: unused,
    leave: unused,
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
      "split_offer",
      BANNER_TOOL,
      "ask",
      "leave",
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

describe("parseCatchUpArgs", () => {
  test("the parent only when named; the base otherwise", () => {
    expect(parseCatchUpArgs({ from: "parent" })).toBe("parent")
    expect(parseCatchUpArgs({ from: "base" })).toBe("base")
    expect(parseCatchUpArgs({})).toBe("base")
    expect(parseCatchUpArgs({ from: "elsewhere" })).toBe("base")
  })
})
