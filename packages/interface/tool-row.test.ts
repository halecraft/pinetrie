import {
  type ImageRef,
  isSha256,
  type ToolCall,
  type ToolResult,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  CALL_MARK,
  callStatus,
  click,
  NO_MEMORY,
  type RowFacts,
  type RowSize,
  type Run,
  rowSize,
  rowSummary,
  toolBody,
} from "./tool-row.ts"

test.each<[RowFacts, RowSize]>([
  [{ revealed: false, shows: false, reader: null }, "closed"],
  [{ revealed: true, shows: false, reader: null }, "capped"],
  [{ revealed: false, shows: true, reader: null }, "capped"],
  [{ revealed: false, shows: false, reader: "full" }, "full"],
  [{ revealed: true, shows: false, reader: "closed" }, "closed"],
  [{ revealed: false, shows: true, reader: "closed" }, "closed"],
  [{ revealed: true, shows: false, reader: "full" }, "full"],
  [{ revealed: false, shows: true, reader: "full" }, "full"],
])("rowSize(%o) is %s", (facts, size) => {
  expect(rowSize(facts)).toBe(size)
})

test("a row never drawn before starts closed, unless its result shows an image", () => {
  expect(rowSize({ ...NO_MEMORY, shows: false })).toBe("closed")
  expect(rowSize({ ...NO_MEMORY, shows: true })).toBe("capped")
})

test.each<[RowSize, "full" | "closed"]>([
  ["closed", "full"],
  ["capped", "full"],
  ["full", "closed"],
])("a click on a %s row makes it %s", (size, next) => {
  expect(click(size)).toBe(next)
})

const sha = "a".repeat(64)
if (!isSha256(sha)) throw new Error("not a sha")
const IMAGE: ImageRef = {
  sha256: sha,
  mimeType: "image/png",
  width: 40,
  height: 30,
}
const result = (images: readonly ImageRef[]): ToolResult => ({
  text: "Read image file [image/png]",
  isError: false,
  images,
})

test("a result with an image shows the image, its caption as the note", () => {
  expect(toolBody(result([IMAGE]))).toEqual({
    kind: "images",
    images: [IMAGE],
    note: "Read image file [image/png]",
  })
})

test("a result without an image, or no result yet, shows text", () => {
  expect(toolBody(result([]))).toEqual({ kind: "text" })
  expect(toolBody(undefined)).toEqual({ kind: "text" })
})

test("a call's status: running without a result, failed by its result's error", () => {
  const result = (isError: boolean): ToolResult => ({
    text: "",
    isError,
    images: [],
  })
  expect(callStatus(undefined)).toBe("pending")
  expect(callStatus(result(true))).toBe("error")
  expect(callStatus(result(false))).toBe("ok")
  expect(CALL_MARK).toEqual({ pending: "…", error: "✗", ok: "✓" })
})

describe("rowSummary (ADR-0114)", () => {
  const call = (name: string, subject?: string): ToolCall =>
    subject === undefined ? { id: "c", name } : { id: "c", name, subject }
  const text = (runs: readonly Run[] | undefined) =>
    runs?.map(r => r.text).join("")

  test("a long chain is tagged shell, highlighted, and opened a step a line", () => {
    const chain =
      "mkdir -p /tmp/wc && cd /tmp/wc && git init -q && git commit -m init && ls -la"
    const s = rowSummary(call("bash", chain))
    expect(s.tag).toBe("shell")
    expect(text(s.preview)).toBe(chain)
    expect(s.preview.filter(r => r.role === "command").length).toBe(5)
    expect(text(s.whole)?.split("\n")).toEqual([
      "mkdir -p /tmp/wc &&",
      "  cd /tmp/wc &&",
      "  git init -q &&",
      "  git commit -m init &&",
      "  ls -la",
    ])
  })

  test("a short command opens as it closed", () => {
    expect(rowSummary(call("bash", "pnpm test")).whole).toBeUndefined()
  })

  test("a command of many lines previews its first, and opens whole", () => {
    const s = rowSummary(call("bash", "cd x\npnpm test"))
    expect(text(s.preview)).toBe("cd x…")
    expect(text(s.whole)).toBe("cd x\npnpm test")
  })

  test("a path is one plain run, and a long one opens whole", () => {
    expect(rowSummary(call("read", "a.ts"))).toEqual({
      tag: "read",
      preview: [{ text: "a.ts", role: "plain" }],
      whole: undefined,
    })
    const long = `${"dir/".repeat(40)}a.ts`
    expect(text(rowSummary(call("read", long)).whole)).toBe(long)
  })

  test("a call with no subject is its word, untagged; an unknown tool is tagged with its name", () => {
    expect(rowSummary(call("split_offer"))).toEqual({
      tag: undefined,
      preview: [{ text: "split", role: "plain" }],
      whole: undefined,
    })
    expect(rowSummary(call("mystery", "x")).tag).toBe("mystery")
  })
})
