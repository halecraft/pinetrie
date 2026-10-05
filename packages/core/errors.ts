// core/errors — a thrown value as text, for logs, refusals and replies.

/** A thrown value as text: an Error's message, anything else as a string. */
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
