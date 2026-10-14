// core/errors — a thrown value as text, for logs, refusals and replies.

/** A thrown value as text: an Error's message, anything else as a string. */
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The default of a switch that names every member of a union: a member
 * added later fails the type check there, and one that reaches it anyway
 * (a value from outside the types) throws.
 */
export function assertNever(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`)
}
