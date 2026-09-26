// Mutations for the host and the interface, checked by the e2e, live and
// browser suites. Slow: each runs a whole suite. The browser suite needs the
// Playwright server (see apps/pineta/e2e/browser.ts).
// Run: pnpm mutate scripts/mutations/app.ts [name-substring]
import type { Mutation } from "../mutate.ts"

const e2e = ["pnpm", "run", "e2e"]
const live = ["pnpm", "run", "e2e:live"]
const browser = ["pnpm", "run", "e2e:browser"]

export const mutations: readonly Mutation[] = [
  {
    name: "every message compels the agent",
    file: "packages/core/index.ts",
    from: '        ? NOBODY\n        : { kind: "agent", agent: THE_AGENT }',
    to: '        ? { kind: "agent", agent: THE_AGENT }\n        : { kind: "agent", agent: THE_AGENT }',
    command: e2e,
    expect: "a plain branch is appended",
  },
  {
    name: "the stored content drops the speaker",
    file: "packages/marginalia/chat.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  `${d.authorName}: ${d.text}`",
    to: "  d.text",
    command: e2e,
    expect: "the stored content carries the speaker",
  },
  {
    name: "the live prompt asks for another token",
    file: "apps/pineta/e2e/e2e.ts",
    from: 'const PROMPT = "Say exactly: PINETA-OK"',
    to: 'const PROMPT = "Say exactly: SOMETHING-ELSE"',
    command: live,
    expect: "the model's reply contains the requested token",
  },
  {
    name: "→ opens its column at the far right",
    file: "packages/client/app.tsx",
    from: "                    asksAgent: false,\n                    place: { after: i },\n                  })\n                }\n                onBranchInstead",
    to: "                    asksAgent: false,\n                    place: { end: true },\n                  })\n                }\n                onBranchInstead",
    command: browser,
    expect: "opens an empty column next to the column it forks from",
  },
  {
    name: "a new column is not aligned with its fork point",
    file: "packages/client/app.tsx",
    from: "      if (i > 0) alignOnOpen(el, column.key, views[i]?.forkFrom ?? null)",
    to: "      void i",
    command: browser,
    expect: "level with the fork point",
  },
  {
    name: "a fork dot takes another track's colour",
    file: "packages/client/message.tsx",
    from: "            style={{ background: trackColor(t) }}",
    to: "            style={{ background: trackColor(t + 1) }}",
    command: browser,
    expect: "share a colour",
  },
  {
    name: "every message is lit while the agent replies",
    file: "packages/client/column.tsx",
    from: '              light={running ? (lit(node.id) ? "lit" : "dim") : undefined}',
    to: '              light={running ? "lit" : undefined}',
    command: browser,
    expect: "its path is lit and the rest dims",
  },
  {
    name: "a first column keeps its alignment spacer",
    file: "packages/client/column.tsx",
    from: '      spacer.current.style.height = "0px"',
    to: "      void 0",
    command: browser,
    expect: "keeps no alignment spacer",
  },
  {
    name: "a lane-less reply is parented where the sender looked, not at the end",
    file: "packages/marginalia/chat.ts",
    from: '    if (!compelled) return { kind: "appendToTree", parent: end, details }',
    to: '    if (!compelled) return { kind: "appendToTree", parent: input.at, details }',
    command: e2e,
    expect: "form a chain, never siblings",
  },
  {
    name: "threadOf ignores the lane a send names",
    file: "packages/core/tree.ts",
    from: "  if (send.lane !== null) {",
    to: "  if (send.lane !== null && send.lane === undefined) {",
    command: e2e,
    expect: "a send naming the lane runs on it",
  },
  {
    name: "the host writes a plain message to a running lane",
    file: "packages/marginalia/chat.ts",
    from: '    return busy\n      ? { kind: "hold", lane: name, details, position: lane.waiting }\n      : { kind: "appendToLane", lane: name, details }',
    to: '    return { kind: "appendToLane", lane: name, details }',
    command: e2e,
    expect: "in send order",
  },
  {
    name: "the drain appends a compelled message instead of running it",
    file: "apps/pineta/host/index.ts",
    from: '      if (step.kind === "append") {',
    to: '      if (step.kind !== "idle") {',
    command: e2e,
    expect: "in send order",
  },
  {
    name: "the host ignores a Start Agent column",
    file: "apps/pineta/host/index.ts",
    from: "      asksAgent: chat.asksAgent,",
    to: "      asksAgent: false,",
    command: e2e,
    expect: "a Start Agent message starts a run",
  },
]
