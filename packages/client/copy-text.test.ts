import type { ToolCallView, TranscriptMessage } from "@pinetrie/core"
import { entryId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { copyText } from "./copy-text.ts"

const reply = (
  text: string,
  toolCalls: readonly ToolCallView[] = [],
): TranscriptMessage => ({
  id: entryId("5-m"),
  role: "assistant",
  text,
  toolCalls,
})

const done = (text: string, isError = false) => ({
  text,
  isError,
  images: [],
})

test("a message's markdown is copied as stored", () => {
  expect(copyText(reply("@ada **look** at `x`"))).toBe("@ada **look** at `x`")
})

test("then each call: its label in code, and its whole output fenced", () => {
  expect(
    copyText(
      reply("Let me look.", [
        {
          id: "a",
          name: "read",
          label: "read notes.txt",
          result: done("the secret word is MANGO\n"),
        },
        {
          id: "b",
          name: "bash",
          label: "bash false",
          result: done("Command exited with code 1", true),
        },
      ]),
    ),
  ).toBe(
    [
      "Let me look.",
      "`read notes.txt`",
      "```\nthe secret word is MANGO\n```",
      "`bash false`",
      "```\nCommand exited with code 1\n```",
    ].join("\n\n"),
  )
})

test("a call alone, a running one, and one with no output copy their label", () => {
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", label: "bash sleep 5" },
        { id: "b", name: "bash", label: "bash true", result: done("") },
      ]),
    ),
  ).toBe("`bash sleep 5`\n\n`bash true`")
})

test("a cut label is copied whole, fenced when it runs over lines", () => {
  expect(
    copyText(
      reply("", [
        {
          id: "a",
          name: "bash",
          label: "bash cd x…",
          wholeLabel: "bash cd x\npnpm test",
        },
      ]),
    ),
  ).toBe("```\nbash cd x\npnpm test\n```")
})

test("no backticks inside close the code they are copied in", () => {
  expect(
    copyText(
      reply("", [
        {
          id: "a",
          name: "bash",
          label: "bash echo `date`",
          result: done("a\n```\nb"),
        },
      ]),
    ),
  ).toBe("`` bash echo `date` ``\n\n````\na\n```\nb\n````")
})

test("a message with neither text nor calls copies nothing", () => {
  expect(copyText(reply(""))).toBe("")
})

test("an output with more backtick runs than a call takes arguments still copies", () => {
  const output = "`x".repeat(300_000)
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", label: "bash x", result: done(output) },
      ]),
    ),
  ).toBe(`\`bash x\`\n\n\`\`\`\n${output}\n\`\`\``)
})
