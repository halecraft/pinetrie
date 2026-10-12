// pi/checkpoint — pi's tool-output checkpoints, stored as text edits.
//
// While a tool runs, pi writes its whole output view to a
// `pi.pending.tool_output` value every 2 s, for recovery after a crash. Stored
// as a value, each write is a new copy: 231–235 KB for one 51 KB result.
// `KynetaStorage` stores the text part in `checkpointText` instead, written as
// edits, and keeps the rest of the value as a small shell.

/** pi's namespace for tool-output checkpoints (`pendingToolOutput`). */
export const CHECKPOINT_NAMESPACE = "pi.pending.tool_output"

type Part = { readonly type?: unknown; readonly text?: unknown }

const textParts = (value: unknown): readonly Part[] | undefined => {
  const content = (value as { content?: unknown } | null)?.content
  return Array.isArray(content) ? content : undefined
}

/**
 * A checkpoint with exactly one text part -> the value with that text emptied,
 * and the text. Any other shape is undefined: stored whole.
 */
export function sealCheckpoint(
  value: unknown,
): { readonly shell: unknown; readonly text: string } | undefined {
  const parts = textParts(value)
  if (parts === undefined) return undefined
  const texts = parts.filter(
    p => p?.type === "text" && typeof p.text === "string",
  )
  const [only] = texts
  if (texts.length !== 1 || only === undefined) return undefined
  return {
    shell: {
      ...(value as object),
      content: parts.map(p => (p === only ? { ...p, text: "" } : p)),
    },
    text: only.text as string,
  }
}

/** A shell and its text -> the value pi wrote. */
export function unsealCheckpoint(shell: unknown, text: string): unknown {
  const parts = textParts(shell)
  if (parts === undefined) return shell
  return {
    ...(shell as object),
    content: parts.map(p => (p?.type === "text" ? { ...p, text } : p)),
  }
}
