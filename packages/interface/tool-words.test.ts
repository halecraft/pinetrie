import { TOOL_IDS, type ToolCall, type ToolId } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { callLabel, PREVIEW_LENGTH, toolWord } from "./tool-words.ts"

describe("toolWord", () => {
  const WORDS: Readonly<Record<ToolId, string>> = {
    read: "read",
    write: "wrote",
    edit: "edited",
    bash: "ran",
    grep: "searched",
    find: "looked for",
    ask_about_conflict: "asked you",
    catch_up: "got the latest",
    split_proposed_changes: "split",
    set_banner: "banner",
    ask: "asked",
    leave: "left",
    resolve_conflict: "resolve",
    save_blob: "save",
    put_image: "image",
    read_card: "read",
    propose_branches: "propose",
  }
  test.each(TOOL_IDS)("%s reads as its word", id => {
    expect(toolWord(id)).toBe(WORDS[id])
  })
  test("a tool pine·trie does not register goes by its own name", () => {
    expect(toolWord("mystery")).toBe("mystery")
    expect(toolWord("function Object() { [native code] }")).toBe(
      "function Object() { [native code] }",
    )
  })
})

describe("callLabel", () => {
  const call = (name: string, subject?: string): ToolCall =>
    subject === undefined ? { id: "c", name } : { id: "c", name, subject }

  test.each([
    [call("read", "a.ts"), "read a.ts"],
    [call("bash", "pnpm test\necho done"), "ran pnpm test…"],
    [call("grep", "TODO src"), "searched TODO src"],
    [call("find", "*.ts"), "looked for *.ts"],
    [call("split_proposed_changes"), "split"],
    [call("mystery"), "mystery"],
  ])("cut, %o reads %s", (c, label) => {
    expect(callLabel(c, "cut")).toBe(label)
  })

  test("a long subject is cut at PREVIEW_LENGTH, and whole keeps every line", () => {
    const long = `echo ${"x".repeat(200)}`
    expect(callLabel(call("bash", long), "cut")).toBe(
      `ran ${long.slice(0, PREVIEW_LENGTH)}…`,
    )
    expect(callLabel(call("bash", `${long}\nls`), "whole")).toBe(
      `ran ${long}\nls`,
    )
    expect(callLabel(call("read", "a.ts"), "whole")).toBe("read a.ts")
  })
})
