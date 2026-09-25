// Mutations for @pineta/core. Run: pnpm mutate scripts/mutations/core.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/core"]
const tree = "packages/core/tree.ts"
const core = "packages/core/index.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "the youngest child continues the parent's track",
    file: tree,
    from: "    const tracks = children.map((_, i) => (i === 0 ? track : claim()))",
    to: "    const tracks = children.map((_, i) => (i === children.length - 1 ? track : claim()))",
    command: unit,
    expect: "the oldest child continues",
  },
  {
    name: "children keep insertion order instead of id order",
    file: tree,
    from: "  for (const siblings of childrenOf.values()) siblings.sort(ascending)\n",
    to: "",
    command: unit,
    expect: "insertion order",
  },
  {
    name: "the rail draws only the first root",
    file: tree,
    from: "    [...index.roots, ...index.orphans].sort(ascending),",
    to: "    [...index.roots, ...index.orphans].sort(ascending).slice(0, 1),",
    command: unit,
    expect: "each root starts a track",
  },
  {
    name: "a fresh branch ignores exclude",
    file: tree,
    from: "  const stack = (index.childrenOf.get(at) ?? []).filter(c => !skip.has(c))",
    to: "  const stack = [...(index.childrenOf.get(at) ?? [])]",
    command: unit,
    expect: "a fresh branch stays at its anchor",
  },
  {
    name: "followTip has no cycle guard going down",
    file: tree,
    from: "    if (seen.has(id)) continue\n    seen.add(id)\n    const children = index.childrenOf.get(id) ?? []",
    to: "    seen.add(id)\n    const children = index.childrenOf.get(id) ?? []",
    command: unit,
    timeoutMs: 30_000,
  },
  {
    name: "forkFrom takes the shallowest shared message",
    file: tree,
    from: "    for (const [i, node] of spine.entries()) if (shown.has(node.id)) cut = i",
    to: "    for (const [i, node] of spine.entries()) if (shown.has(node.id) && cut < 0) cut = i",
    command: unit,
    expect: "deepest message it shares with ANY column",
  },
  {
    name: "forkFrom is computed against the adjacent column only",
    file: tree,
    from: "    for (const node of spine) shown.add(node.id)",
    to: "    shown.clear()\n    for (const node of spine) shown.add(node.id)",
    command: unit,
    expect: "deepest message it shares with ANY column",
  },
  {
    name: "a fork dot takes a different track from its column",
    file: tree,
    from: "    const t = track[i] ?? PENDING_TRACK",
    to: "    const t = (track[i] ?? PENDING_TRACK) + 1",
    command: unit,
    expect: "its fork dot matches",
  },
  {
    name: "compel the agent on any mention",
    file: core,
    from: 'const agent = input.mentions.find(m => m.kind === "agent")',
    to: 'const agent = input.mentions.map(() => ({ kind: "agent" as const, agent: THE_AGENT }))[0]',
    command: ["pnpm", "exec", "vitest", "run", "packages/marginalia"],
    expect: "only notifies",
  },
  {
    name: "ignore the thread default",
    file: core,
    from: "? input.threadDefault\n",
    to: "? NOBODY\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/marginalia"],
    expect: "working session",
  },
]
