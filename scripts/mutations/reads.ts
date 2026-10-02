// Mutations for @pineta/reads' own unit tests. Run: pnpm mutate scripts/mutations/reads.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/reads"]

export const mutations: readonly Mutation[] = [
  {
    name: "referencedBlobs skips the texts people type",
    file: "packages/reads/index.ts",
    from: "    for (const sha of pastedImages(text)) shas.add(sha)",
    to: '    for (const sha of pastedImages("")) shas.add(sha)',
    command: unit,
    expect: "referencedBlobs: chats, tool results",
  },
  {
    name: "readTreeIndex indexes again on every call",
    file: "packages/reads/index.ts",
    from: "  const known = indexOfEntries.get(rows)",
    to: "  const known = undefined",
    command: unit,
    expect: "readTreeIndex keeps the index",
  },
  {
    name: "readRenderableEntries decodes every row again",
    file: "packages/reads/index.ts",
    from: "  const known = entryOfRow.get(row)",
    to: "  const known = undefined",
    command: unit,
    expect: "readTreeIndex keeps the index",
  },
  {
    name: "decayed presence is still shown",
    file: "packages/reads/index.ts",
    from: "      return value === null || writer === undefined",
    to: "      return writer === undefined",
    command: unit,
    expect: "a presence read leaves out an entry once it decays",
  },
  {
    name: "a presence read gives a new array for the same entries",
    file: "packages/reads/index.ts",
    from: "    if (before !== undefined && samePairs(before, now)) return before",
    to: "    if (before !== undefined && false) return before",
    command: unit,
    expect: "keeps its array while its entries are the same",
  },
  {
    name: "the queue names the first one waiting",
    file: "packages/reads/index.ts",
    from: "      lastWaiting: queue.at(-1)?.place.by ?? null,",
    to: "      lastWaiting: queue[0]?.place.by ?? null,",
    command: unit,
    expect: "readLanes: a lane's queued cards are what waits",
  },
  {
    name: "a lane's drafting cards count as waiting",
    file: "packages/reads/index.ts",
    from: "    const queue = queuedOn(cards, name)",
    to: '    const queue = cards.filter(c => c.place.kind !== "fresh") as ReturnType<typeof queuedOn>',
    command: unit,
    expect: "readLanes: a lane's queued cards are what waits",
  },
  {
    name: "an idle lane is held by who queued last",
    file: "packages/reads/index.ts",
    from: "    const asking = running ? askerOf(index, tip) : queue[0]?.place.by",
    to: "    const asking = running ? askerOf(index, tip) : queue.at(-1)?.place.by",
    command: unit,
    expect: "readLanes: a lane's queued cards are what waits",
  },
  {
    name: "referencedBlobs skips banners",
    file: "packages/reads/index.ts",
    from: "  for (const banner of facts.banners) shas.add(banner.sha)",
    to: "  for (const banner of [] as BannerRecord[]) shas.add(banner.sha)",
    command: unit,
    expect: "typed texts and banners each keep theirs",
  },
  {
    name: "referencedBlobs skips tool results",
    file: "packages/reads/index.ts",
    from: "    for (const image of messageImages(message as AgentMessageLike))",
    to: "    for (const image of messageImages(null))",
    command: unit,
    expect: "referencedBlobs: chats, tool results",
  },
  {
    name: "readCards gives an unchanged card a new object",
    file: "packages/reads/index.ts",
    from: "      was !== undefined && was.stored === stored",
    to: '      was !== undefined && was.stored === "never"',
    command: unit,
    expect: "an unchanged card the same object",
  },
  {
    name: "the tree is read unbranded",
    file: "packages/reads/index.ts",
    from: "    id: entryId(row.id),",
    to: "    id: row.id,",
    // tsc names no failing check (`failingChecks`): with typecheck clean,
    // any error is the mutant's.
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
]
