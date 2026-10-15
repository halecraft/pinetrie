import { TOOL_IDS, type ToolCall, type ToolId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { callLabel, PREVIEW_LENGTH, toolWord } from "./tool-words.ts"

describe("toolWord", () => {
  const WORDS: Readonly<Record<ToolId, string>> = {
    read: "read",
    write: "write",
    edit: "edit",
    bash: "shell",
    grep: "search",
    find: "find",
    ask_about_conflict: "ask",
    catch_up: "catch up",
    split_offer: "split",
    set_banner: "banner",
    ask: "asked",
    leave: "left",
    resolve_conflict: "resolve",
  }
  test.each(TOOL_IDS)("%s reads as its word", id => {
    expect(toolWord(id)).toBe(WORDS[id])
  })
  test("a tool pine·trie does not register goes by its own name", () => {
    expect(toolWord("mystery")).toBe("mystery")
    expect(toolWord("constructor")).toBe("constructor")
  })
})

describe("callLabel", () => {
  const call = (name: string, subject?: string): ToolCall =>
    subject === undefined ? { id: "c", name } : { id: "c", name, subject }

  test.each([
    [call("read", "a.ts"), "read a.ts"],
    [call("bash", "pnpm test\necho done"), "shell pnpm test…"],
    [call("grep", "TODO src"), "search TODO src"],
    [call("find", "*.ts"), "find *.ts"],
    [call("split_offer"), "split"],
    [call("mystery"), "mystery"],
  ])("cut, %o reads %s", (c, label) => {
    expect(callLabel(c, "cut")).toBe(label)
  })

  test("a long subject is cut at PREVIEW_LENGTH, and whole keeps every line", () => {
    const long = `echo ${"x".repeat(200)}`
    expect(callLabel(call("bash", long), "cut")).toBe(
      `shell ${long.slice(0, PREVIEW_LENGTH)}…`,
    )
    expect(callLabel(call("bash", `${long}\nls`), "whole")).toBe(
      `shell ${long}\nls`,
    )
    expect(callLabel(call("read", "a.ts"), "whole")).toBe("read a.ts")
  })
})
