import { entryId } from "@pinetrie/core"
import type { ToolCall, TranscriptMessage } from "@pinetrie/threads"
import { FIXTURE_THREAD } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import { copyText } from "./copy-text.ts"

const reply = (
  text: string,
  toolCalls: readonly ToolCall[] = [],
): TranscriptMessage => ({
  id: entryId("5-m"),
  thread: FIXTURE_THREAD,
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
      "`ran false`",
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
  ).toBe("`ran sleep 5`\n\n`ran true`")
})

test("a copied call is its command", () => {
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", subject: "ls", intent: "List the files" },
      ]),
    ),
  ).toBe("`ran ls`")
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
  ).toBe("```\nran cd x\npnpm test\n```")
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
  ).toBe("`` ran echo `date` ``\n\n````\na\n```\nb\n````")
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
  ).toBe(`\`ran x\`\n\n\`\`\`\n${output}\n\`\`\``)
})

test("a bash output is copied without its escape sequences, a read file as stored", () => {
  const styled = "\u001b[32mok\u001b[0m"
  expect(
    copyText(
      reply("", [
        { id: "a", name: "bash", subject: "x", result: done(styled) },
        { id: "b", name: "read", subject: "f", result: done(styled) },
      ]),
    ),
  ).toBe(
    `\`ran x\`\n\n\`\`\`\nok\n\`\`\`\n\n\`read f\`\n\n\`\`\`\n${styled}\n\`\`\``,
  )
})
