// Mutations for @pineta/schema's streams. Run: pnpm mutate scripts/mutations/schema.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/schema"]
const file = "packages/schema/index.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "every reply is current: a second message appends to the first",
    file: file,
    from: '  s.kind === "reply" && s.under === tip',
    to: '  s.kind === "reply"',
    command: unit,
    expect: "the next text opens a new one",
  },
  {
    name: "a tool opening closes nothing",
    file: file,
    from: '          mine.filter(s => s.kind === "reply" && !isCurrentReply(s, tip)),',
    to: "          [],",
    command: unit,
    expect: "closes the reply its entry replaced",
  },
  {
    name: "a reply opening keeps its lane's tools",
    file: file,
    from: "        ...closeStreams(mine),",
    to: '        ...closeStreams(mine.filter(s => s.kind === "reply")),',
    command: unit,
    expect: "a reply opening closes its lane's tools",
  },
  {
    name: "endRun keeps the lane's streams",
    file: file,
    from: "    applyOps(d, closing)\n  })\n}\n\n/** A stream as stored",
    to: "    void closing\n  })\n}\n\n/** A stream as stored",
    command: unit,
    expect: "endRun deletes the lane's streams",
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
    from: "        d.streams.delete(op.id)",
    to: "        void op.id",
    command: unit,
    expect: "a tool opening closes the reply its entry replaced",
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
