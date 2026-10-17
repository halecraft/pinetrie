// Mutations for @pinetrie/folder. Run: pnpm mutate scripts/mutations/folder.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/folder"]
const graph = "packages/folder/graph.ts"
const merge = "packages/folder/merge.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "planRead misses a deletion",
    file: "packages/folder/read.ts",
    from: "  const deleted = [...last.keys()].filter(p => !scan.has(p)).sort()",
    to: "  const deleted: string[] = []",
    command: unit,
    expect:
      "planRead: a new path, and one whose stamp moved, are changed; one gone is deleted",
  },
  {
    name: "planRead ignores a mode's change",
    file: "packages/folder/read.ts",
    from: "  a.exec === b.exec &&\n",
    to: "",
    command: unit,
    expect: "planRead: a mode or a link's target moving is a change",
  },
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
      "a foreign folder lane's tip, start and base with accepted work are kept",
  },
  {
    name: "liveStates drops a branch's base with its parent",
    file: "packages/folder/live.ts",
    from: "    if (lane.parent !== null)\n",
    to: "    if (lane.parent !== null && false)\n",
    command: unit,
    expect:
      "a branch's base with its parent is kept once the parent moved past it",
  },
  {
    name: "parentLane answers the grandparent",
    file: graph,
    from: "  return parent === undefined ? null : laneOf(parent)\n",
    to: "  const p = parent === undefined ? null : laneOf(parent)\n  return p === null ? null : (parentLane(g, p) ?? p)\n",
    command: unit,
    expect: "a branch of a branch has its own parent, not the grandparent",
  },
  {
    name: "planAccept accepts what was not shown",
    file: "packages/folder/accept.ts",
    from: "    tip !== seen.tip ||\n",
    to: "",
    command: unit,
    expect: "a turn since the review is not as shown",
  },
  {
    name: "planNames lets a case collision through",
    file: "packages/folder/accept.ts",
    from: "    return foldsCase ? nfc.toLowerCase() : nfc\n",
    to: "    return nfc\n",
    command: unit,
    expect:
      "a name another holds by case collides on a disk that folds case, and not on another",
  },
  {
    name: "checkStage lets a file under a symlink through",
    file: "packages/folder/accept.ts",
    from: '    } else if (!(dirs.has(e.path) && e.kind === "dir"))\n',
    to: "    } else if (!dirs.has(e.path))\n",
    command: unit,
    expect: "a file under a symlink is refused",
  },
  {
    name: "planRecovery removes a link that is not the staged one",
    file: "packages/folder/accept.ts",
    from: '    ? t.kind === "file" && isSameInode(t, own.stat)\n',
    to: '    ? t.kind === "file"\n',
    command: unit,
    expect: "a link whose stat is not the staged one is not unlinked",
  },
  {
    name: "a put back deletes a changed aside",
    file: "packages/folder/accept.ts",
    from: "    return { ...p, keptOn: newest }\n",
    to: '    steps.push({ kind: "drop-aside", aside: p.aside })\n    return p\n',
    command: unit,
    expect:
      "a save by name since, beside an aside written through, keeps both, the aside on accepted work's newest",
  },
  {
    name: "planAsides drops an aside written through",
    file: "packages/folder/accept.ts",
    from: "    if (k.moved !== null && isSameInode(stat, k.moved)) drop.push(k.aside)\n",
    to: "    if (k.moved !== null) drop.push(k.aside)\n",
    command: unit,
    expect:
      "an aside as moved is dropped; one written through is a concurrent save; one gone is nothing",
  },
  {
    name: "isLineState takes a concurrent save",
    file: graph,
    from: '  r.made.kind === "read" ||\n',
    to: '  r.made.kind === "read" ||\n  r.made.kind === "concurrent" ||\n',
    command: unit,
    expect: "is never accepted work's newest",
  },
  {
    name: "the live set drops a pinned accept state",
    file: "packages/folder/live.ts",
    from: "  for (const p of input.pinned) live.add(p)\n",
    to: "",
    command: unit,
    expect:
      "a pinned accept state is kept past keep, and a concurrent save with it",
  },
  {
    name: "the live set drops a shown merge",
    file: "packages/folder/live.ts",
    from: "    if (o.files.length > 0) live.add(shownMergeId(o.start, o.tip))\n",
    to: "",
    command: unit,
    expect: "a proposed changes' shown merge is kept with its two",
  },
]
