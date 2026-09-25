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
    from: "  return agent === undefined\n    ? input.threadDefault\n",
    to: '  return agent === undefined\n    ? { kind: "agent", agent: THE_AGENT }\n',
    command: e2e,
    expect: "run nothing",
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
    name: "an existing author lane never moves to where they read",
    file: "packages/marginalia/chat.ts",
    from: "      attach: planAttach(input.authorLane, input.at),",
    to: '      attach: planAttach({ kind: "none" }, input.at),',
    command: e2e,
    expect: "an existing lane moves to where its author views",
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
    name: "a branch opens at the far right",
    file: "packages/client/app.tsx",
    from: "                    after: i,\n",
    to: "                    after: columns.length - 1,\n",
    command: browser,
    expect: "not at the far right",
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
    from: '                  : replying.path.has(node.id)\n                    ? "lit"\n                    : "dim"',
    to: '                  : "lit"',
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
]
