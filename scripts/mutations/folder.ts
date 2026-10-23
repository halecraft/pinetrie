// Mutations for @pinetrie/folder. Run: pnpm mutate scripts/mutations/folder.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/folder"]
const graph = "packages/folder/graph.ts"
const merge = "packages/folder/merge.ts"

export const mutations: readonly Mutation[] = [
  // ── a folder operation planned whole ──
  {
    name: "no state is recorded",
    file: "packages/folder/graph.ts",
    from: "): boolean => states.some(r => r.id === id)\n",
    to: "): boolean => false\n",
    command: unit,
    expect:
      "isRecorded and planMergeBase: a state the records hold, and the base of two states over the graph the records make",
  },
  {
    name: "a tip accepted work holds is shown as a merge",
    file: "packages/folder/proposed.ts",
    from: "  const holds = isAncestor(graph, tip, newest)\n",
    to: "  const holds = false\n",
    command: unit,
    expect:
      "planShownMerge: a lane not begun has none to show; one accepted work holds already shows accepted work's newest",
  },
  {
    name: "an accepted shown merge is dropped",
    file: "packages/folder/proposed.ts",
    from: "was !== null && was !== shownPoint(proposed) && !graph.states.has(was)",
    to: "was !== null && was !== shownPoint(proposed)",
    command: unit,
    expect:
      "planFolderRecords: the shown merge a new record replaces is dropped, unless an accept made it a state",
  },
  {
    name: "a lane holding theirs merges it again",
    file: "packages/folder/graph.ts",
    from: '  if (isAncestor(graph, theirs, ours)) return { kind: "nothing", ours }\n',
    to: "",
    command: unit,
    expect:
      "planLaneMerge: nothing when the lane's newest holds theirs already; else a merge over the base they share",
  },
  {
    name: "the sweep deletes a lane's tip",
    file: "packages/folder/live.ts",
    from: "    live.add(lane.tip).add(lane.start)\n",
    to: "    live.add(lane.start)\n",
    command: unit,
    expect:
      "planKeep: a lane's tip and start, and accepted work's newest states kept; older ones and a lane's past turns swept",
  },
  {
    name: "planKeep sweeps what the live set keeps not, whether or not it exists",
    file: "packages/folder/keep.ts",
    from: "      input.exists.has(id) &&\n      !live.has(id) &&\n",
    to: "      !live.has(id) &&\n",
    command: unit,
    expect:
      "planKeep: a state whose snapshot is gone already is not swept again",
  },
  {
    name: "planKeep offers a name no folder state holds",
    file: "packages/folder/keep.ts",
    from: '      !live.has(id) &&\n      snapshotOwner(id) === "folder-state"\n',
    to: "      !live.has(id)\n",
    command: unit,
    expect: "planKeep: a state named as no folder state is left",
  },
  {
    name: "planKeep keeps a live state whose snapshot is gone",
    file: "packages/folder/keep.ts",
    from: "  const has = (id: PointId) => live.has(id) && input.exists.has(id)\n",
    to: "  const has = (id: PointId) => live.has(id)\n",
    command: unit,
    expect:
      "planKeep: kept names no state whose snapshot is gone, nor one swept",
  },
  {
    name: "planKeep's kept drops a concurrent save",
    file: "packages/folder/keep.ts",
    from: '    r => r.made.kind === "concurrent" && has(r.id),\n',
    to: "    () => false,\n",
    command: unit,
    expect:
      "planKeep: kept is accepted work's line kept, newest first, a concurrent save before the accept it was made on",
  },
  {
    name: "a read with its stamps lost keeps what was deleted since",
    file: "packages/folder/line.ts",
    from: "      from: last === null ? null : newest,",
    to: "      from: newest,",
    command: unit,
    expect:
      "with the last read's stamps lost, a read copies everything into an empty disk, on accepted work's line",
  },
  {
    name: "a resolution records no state",
    file: "packages/folder/resolve.ts",
    from: "    records: { ...recorded, closed: [{ lane, path }] },\n",
    to: "    records: { ...recorded, states: [], closed: [{ lane, path }] },\n",
    command: unit,
    expect:
      "planResolve: ours takes no step, and records a resolve on the lane's newest",
  },
  {
    name: "a resolution closes no conflict",
    file: "packages/folder/resolve.ts",
    from: "    records: { ...recorded, closed: [{ lane, path }] },\n",
    to: "    records: { ...recorded, closed: [] },\n",
    command: unit,
    expect:
      "planResolve: ours takes no step, and records a resolve on the lane's newest, the conflict closed",
  },
  {
    name: "a virtual base no conflict names is recorded",
    file: "packages/folder/records.ts",
    from: '    input.plan.kind === "virtual" && input.paths.length > 0\n',
    to: '    input.plan.kind === "virtual"\n',
    command: unit,
    expect:
      "planGetLatestRecords: the merge's state on both sides, a conflict per path, and a virtual base's state only when a conflict names it",
  },
  {
    name: "a state recorded already is recorded again",
    file: "packages/folder/records.ts",
    from: '    case "recorded":\n      return NO_RECORDS\n',
    to: '    case "recorded":\n      return { ...NO_RECORDS, states: [record] }\n',
    command: unit,
    expect:
      "planStateRecords: a new state is recorded, one recorded with the same parents is not, and a refused one throws",
  },
  {
    name: "a lane's start is read as its tip",
    file: "packages/folder/graph.ts",
    from: "    start: tip === null ? null : folderStateHeld(graph, tip),\n",
    to: "    start: tip,\n",
    command: unit,
    expect:
      "laneStates: accepted work's newest, the lane's tip and the state its tip holds, read together",
  },
  {
    name: "pairRenames pairs a candidate with two equal partners",
    file: "packages/folder/review.ts",
    from: '  return found.filter(p => count("a", p.a) === 1 && count("b", p.b) === 1)\n',
    to: "  return found\n",
    command: unit,
    expect: "pairRenames: two copies of one file pair with nothing",
  },
  {
    name: "planFolderReview calls an image text",
    file: "packages/folder/review.ts",
    from: '  (f.kind === "file" && f.content === "text")\n',
    to: '  (f.kind === "file" && f.content !== "binary")\n',
    command: unit,
    expect:
      "an image on each side is media with both sides' sizes; an image added has no before",
  },
  {
    name: "resolve_conflict closes a path with no open conflict",
    file: "packages/folder/resolve.ts",
    from: '  if (open === undefined) return { kind: "no-conflict" }\n',
    to: "",
    command: unit,
    expect: "planResolve: a path with no open conflict closes nothing",
  },
  {
    name: "planRestore ignores what was shown",
    file: "packages/folder/accept.ts",
    from: "  if (newest === null || newest !== input.seen) return refused(ERR.NOT_AS_SHOWN)\n",
    to: "  if (newest === null) return refused(ERR.NOT_AS_SHOWN)\n",
    command: unit,
    expect: "refused not as shown once accepted work moved past what was shown",
  },
  {
    name: "planRestore takes a state not kept",
    file: "packages/folder/accept.ts",
    from: "  if (!input.kept.includes(input.of) || !input.ofMade)\n",
    to: "  if (!input.ofMade)\n",
    command: unit,
    expect: "refused for a state not kept, or whose snapshot is gone",
  },
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
    from: "  return parent === undefined ? null : stateLane(parent)\n",
    to: "  const p = parent === undefined ? null : stateLane(parent)\n  return p === null ? null : (parentLane(g, p) ?? p)\n",
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
    file: "packages/core/folder.ts",
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
