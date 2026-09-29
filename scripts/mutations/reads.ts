// Mutations for @pineta/reads' own unit tests. Run: pnpm mutate scripts/mutations/reads.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/reads"]

export const mutations: readonly Mutation[] = [
  {
    name: "referencedBlobs skips note texts",
    file: "packages/reads/index.ts",
    from: "    for (const sha of pastedImages(text)) shas.add(sha)",
    to: '    for (const sha of pastedImages("")) shas.add(sha)',
    command: unit,
    expect: "referencedBlobs: chats, held messages",
  },
  {
    name: "referencedBlobs skips held messages",
    file: "packages/reads/index.ts",
    from: '    if (held.kind === "chat")',
    to: '    if (held.kind === "update")',
    command: unit,
    expect: "referencedBlobs: chats, held messages",
  },
]
