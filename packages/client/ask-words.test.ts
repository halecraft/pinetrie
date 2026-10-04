import { type WorkStats, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  askWords,
  durationWords,
  foldWords,
  outcomeWords,
  workWords,
} from "./ask-words.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")
const nameOf = (w: string) => (w === ada ? "Ada" : "Bea")

describe("askWords", () => {
  test.each<[string, Parameters<typeof askWords>[0], string]>([
    [
      "a person's message names them as they are named now",
      {
        role: "chat",
        text: "Fix the rail\nplease",
        writer: ada,
        author: "old",
      },
      'Ada: "Fix the rail"',
    ],
    [
      "a long first line is cut",
      { role: "chat", text: "x".repeat(60), writer: bea },
      `Bea: "${"x".repeat(48)}…"`,
    ],
    [
      "a land message is its own line",
      { role: "land", text: "✓ catching up: no conflicts" },
      "✓ catching up: no conflicts",
    ],
  ])("%s", (_, prompt, words) => {
    expect(askWords(prompt, nameOf)).toBe(words)
  })
})

const stats = (over: Partial<WorkStats> = {}): WorkStats => ({
  people: 0,
  writers: [],
  agent: 0,
  calls: 0,
  failed: 0,
  files: [],
  first: 0,
  last: 0,
  ...over,
})

describe("workWords", () => {
  test.each<[string, WorkStats, string]>([
    [
      "every part that is not zero, failures last",
      stats({
        agent: 38,
        calls: 61,
        files: ["a", "b"],
        first: 1_000,
        last: 253_000,
        failed: 2,
      }),
      "38 steps · 61 tool calls · 2 files · 4m 12s · 2 failed",
    ],
    [
      "people, named",
      stats({ people: 12, writers: [ada, bea], agent: 3 }),
      "12 messages from Ada and Bea · 3 steps",
    ],
    [
      "under a second takes no time",
      stats({ agent: 1, first: 5, last: 400 }),
      "1 step",
    ],
  ])("%s", (_, s, words) => {
    expect(workWords(s, nameOf)).toBe(words)
  })
  test("durations", () => {
    expect([42_000, 252_000, 7_500_000].map(durationWords)).toEqual([
      "42s",
      "4m 12s",
      "2h 5m",
    ])
  })
})

describe("outcomeWords", () => {
  test.each<[string, Parameters<typeof outcomeWords>[0], string | null]>([
    [
      "a stop names who stopped it",
      { kind: "stopped", by: bea },
      "stopped by Bea",
    ],
    [
      "a stop from before stops were recorded names no one",
      { kind: "stopped", by: null },
      "stopped",
    ],
    [
      "a failure says why",
      { kind: "failed", error: "rate limited\nretry" },
      "failed: rate limited",
    ],
    ["an answer says nothing", { kind: "answered" }, null],
    ["a run says nothing", { kind: "running" }, null],
  ])("%s", (_, outcome, words) => {
    expect(outcomeWords(outcome, nameOf)).toBe(words)
  })
})

describe("foldWords", () => {
  const ended = {
    running: false,
    headline: "Moved offers out of core",
    work: "30 steps · 12 files",
    outcome: "stopped by Bea",
    live: null,
  }
  const running = {
    ...ended,
    running: true,
    outcome: null,
    live: "$ pnpm test",
  }
  // Each part as it reads, a model's in brackets.
  const read = (...args: Parameters<typeof foldWords>) =>
    foldWords(...args)
      .map(p => (p.byModel ? `[${p.text}]` : p.text))
      .join(" · ")
  test.each<[string, Parameters<typeof foldWords>[0], "line" | "fold", string]>(
    [
      [
        "story: the headline leads, then the work and how it ended",
        ended,
        "fold",
        "[Moved offers out of core] · 30 steps · 12 files · stopped by Bea",
      ],
      [
        "outline: how it ended leads, then the headline and the work",
        ended,
        "line",
        "stopped by Bea · [Moved offers out of core] · 30 steps · 12 files",
      ],
      [
        "outline, running: what it does now, never a headline",
        running,
        "line",
        "$ pnpm test · 30 steps · 12 files",
      ],
      [
        "story, running: the live headline",
        running,
        "fold",
        "[Moved offers out of core] · 30 steps · 12 files",
      ],
      [
        "no headline: the words as before digests",
        { ...ended, headline: null },
        "fold",
        "30 steps · 12 files · stopped by Bea",
      ],
    ],
  )("%s", (_, view, where, words) => {
    expect(read(view, where)).toBe(words)
  })
})
