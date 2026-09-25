// Mutations for @pineta/marginalia. Run: pnpm mutate scripts/mutations/marginalia.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/marginalia"]

export const mutations: readonly Mutation[] = [
  {
    name: "decoding skips the schema check",
    file: "packages/marginalia/decode.ts",
    from: "  return Value.Check(schema, value) ? build(value as Static<S>) : undefined",
    to: "  return build(value as Static<S>)",
    command: unit,
  },
  {
    name: "the nearest rule loses to the furthest",
    file: "packages/marginalia/thread.ts",
    // Valid code: the mutant must fail on behaviour, not on an undeclared name.
    from: "  for (const id of path) {\n    const set = defaults.get(entryId(id))\n    if (set !== undefined) return set\n  }\n  return ROOT_DEFAULT",
    to: "  let found: Responder | undefined\n  for (const id of path) {\n    const set = defaults.get(entryId(id))\n    if (set !== undefined) found = set\n  }\n  return found ?? ROOT_DEFAULT",
    command: unit,
    expect: "nearest ancestor",
  },
  {
    name: "the root is a conversation",
    file: "packages/marginalia/thread.ts",
    from: "  return ROOT_DEFAULT\n}",
    to: '  return { kind: "none" }\n}',
    command: unit,
    expect: "root's working session",
  },
  {
    name: "entryText ignores chat",
    file: "packages/marginalia/chat.ts",
    from: "  const chat = decodeChat(message)\n  return chat === undefined\n    ? messageText(message as AgentMessageLike)\n    : chat.text",
    to: "  return messageText(message as AgentMessageLike)",
    command: unit,
    expect: "entryText",
  },
  {
    name: "a busy agent is not refused",
    file: "packages/marginalia/chat.ts",
    from: '  if (input.agentTurn.busy) return { kind: "refused", code: ERR.BUSY }\n',
    to: "",
    command: unit,
    expect: "busy agent is refused",
  },
  {
    name: "the model reads no speaker",
    file: "packages/marginalia/chat.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  `${d.authorName}: ${d.text}`",
    to: "  d.text",
    command: unit,
    expect: "the model reads the speaker",
  },
]
