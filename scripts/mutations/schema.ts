// Mutations for @pineta/schema's streams. Run: pnpm mutate scripts/mutations/schema.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/schema"]
const file = "packages/schema/index.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "a reply stream is not closed when its message ends",
    file: file,
    from: '      return reply === undefined ? [] : [{ kind: "close", id: reply.id }]',
    to: "      return reply === undefined ? [] : []",
    command: unit,
    expect: "closes when its message ends",
  },
  {
    name: "tool output is written whole, not as tail edits",
    file: file,
    from: "      const edits = tailEdit(tool.text, event.text)",
    to: "      const edits = [{ at: 0, remove: tool.text.length, insert: event.text }]",
    command: unit,
    expect: "a front cut and an append",
  },
  {
    name: "closing a stream leaves its record",
    file: file,
    from: "          d.streams.delete(op.id)",
    to: "          void op.id",
    command: unit,
    expect: "closes when its message ends",
  },
  {
    name: "noteAuthors hashes the principal, not the seat",
    file: "packages/schema/note.ts",
    from: "      return writer === undefined ? [] : [[yjsClientId(peerId), writer]]",
    to: "      return writer === undefined ? [] : [[yjsClientId(principal), writer]]",
    command: unit,
    expect: "each seat's person",
  },
  {
    name: "a presence key's writer runs to its last colon",
    file: "packages/schema/presence.ts",
    from: '  const at = key.indexOf(":")',
    to: '  const at = key.lastIndexOf(":")',
    command: [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "packages/schema",
      "packages/reads",
    ],
    expect: "before its first colon",
  },
]
