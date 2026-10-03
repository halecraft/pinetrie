// client/outcome-words — what the page says when the host answered a command
// it waited on with a refusal or a failure: the work strip's offer commands
// and the project menu's line commands both say it this way.

/** A command's answer the page says: refused, or failed. */
export interface Unsuccessful {
  readonly kind: "refused" | "failed"
  readonly message: string
}

/**
 * A refusal says that nothing was done. A failure says the host may have done
 * part of it.
 */
export const outcomeWords = (said: Unsuccessful): string =>
  said.kind === "refused"
    ? `not done: ${said.message}`
    : `it failed, and may be part done: ${said.message}`
