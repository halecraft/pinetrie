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
    name: "referencedBlobs skips held messages",
    file: "packages/reads/index.ts",
    from: '    if (held.kind === "chat")',
    to: '    if (held.kind === "update")',
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
    expect: "readPresence leaves out an entry once it decays",
  },
  {
    name: "the queue names the first one waiting",
    file: "packages/reads/index.ts",
    from: "    const last = waiting.at(-1)",
    to: "    const last = waiting[0]",
    command: unit,
    expect: "lastWaiting is the writer of the newest item waiting",
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
]
