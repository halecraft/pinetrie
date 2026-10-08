import type { ToolCall, TranscriptMessage } from "@pinetrie/core"
import { entryId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { copyText } from "./copy-text.ts"

const reply = (
  text: string,
  toolCalls: readonly ToolCall[] = [],
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

test("then each call: its tool's word and subject in code, and its whole output fenced", () => {
  expect(
    copyText(
      reply("Let me look.", [
        {
          id: "a",
          name: "read",
          subject: "notes.txt",
          result: done("the secret word is MANGO\n"),
        },
        {
          id: "b",
          name: "bash",
          subject: "false",
          result: done("Command exited with code 1", true),
        },
      ]),
    ),
  ).toBe(
    [
      "Let me look.",
      "`read notes.txt`",
      "```\nthe secret word is MANGO\n```",
      "`shell false`",
      "```\nCommand exited with code 1\n```",
    ].join("\n\n"),
  )
})

test("a call alone, a running one, and one with no output copy their label", () => {
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", subject: "sleep 5" },
        { id: "b", name: "bash", subject: "true", result: done("") },
      ]),
    ),
  ).toBe("`shell sleep 5`\n\n`shell true`")
})

test("a subject is copied whole, fenced when it runs over lines", () => {
  expect(
    copyText(
      reply("", [
        {
          id: "a",
          name: "bash",
          subject: "cd x\npnpm test",
        },
      ]),
    ),
  ).toBe("```\nshell cd x\npnpm test\n```")
})

test("no backticks inside close the code they are copied in", () => {
  expect(
    copyText(
      reply("", [
        {
          id: "a",
          name: "bash",
          subject: "echo `date`",
          result: done("a\n```\nb"),
        },
      ]),
    ),
  ).toBe("`` shell echo `date` ``\n\n````\na\n```\nb\n````")
})

test("a message with neither text nor calls copies nothing", () => {
  expect(copyText(reply(""))).toBe("")
})

test("an output with more backtick runs than a call takes arguments still copies", () => {
  const output = "`x".repeat(300_000)
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", subject: "x", result: done(output) },
      ]),
    ),
  ).toBe(`\`shell x\`\n\n\`\`\`\n${output}\n\`\`\``)
})
