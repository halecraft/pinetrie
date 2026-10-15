// Mutations for @pinetrie/folder. Run: pnpm mutate scripts/mutations/folder.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/folder"]
const graph = "packages/folder/graph.ts"
const merge = "packages/folder/merge.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "mergeBases keeps a base below another",
    file: graph,
    from: "  return common.filter(s => !below.has(s)).sort(byId)\n",
    to: '  return common.filter(s => !below.has(s) || s.startsWith("line-")).sort(byId)\n',
    command: unit,
    expect: "Merge bases are lowest common ancestors, none below another.",
  },
  {
    name: "planBase chooses the first of several bases",
    file: graph,
    from: '  if (next === undefined) return { kind: "state", state: first }\n',
    to: '  if (next === undefined || true) return { kind: "state", state: first }\n',
    command: unit,
    expect:
      "Bases merged first give the right file or a conflict, never a wrong one.",
  },
  {
    name: "planState accepts an unknown parent",
    file: graph,
    from: "  const parent = proposed.parents.find(p => !g.states.has(p))\n",
    to: "  const parent = proposed.parents.find(p => !g.states.has(p) && false)\n",
    command: unit,
    expect: "a parent not in the graph is refused",
  },
  {
    name: "planPathMerge takes theirs where both changed",
    file: merge,
    from: '    return { kind: "steps", steps: [{ kind: "text", path: p }, ...mode] }\n',
    to: '    return { kind: "steps", steps: [{ kind: "take", path: p }, ...mode] }\n',
    command: unit,
    expect: "text changed on both sides is merged by text",
  },
  {
    name: "the tree check is skipped",
    file: merge,
    from: '      a => oursChanged.has(a) && factsAt(a).ours.kind !== "dir",\n',
    to: "      a => oursChanged.has(a) && false,\n",
    command: unit,
    expect:
      "a file theirs adds in a directory ours replaced by a file conflicts there",
  },
  {
    name: "a take of what the disk holds is kept",
    file: merge,
    from: '        ? { kind: "steps", steps: modeStep(p, f) }\n',
    to: '        ? { kind: "steps", steps: [{ kind: "take", path: p }] }\n',
    command: unit,
    expect: "a take of content the disk holds is dropped, its mode still taken",
  },
  {
    name: "liveStates drops a foreign lane's base",
    file: "packages/folder/live.ts",
    from: "    for (const b of mergeBases(input.graph, lane.tip, input.folderNewest))\n",
    to: "    for (const b of [])\n",
    command: unit,
    expect:
      "a foreign folder lane's tip, start and base with your folder are kept",
  },
]
