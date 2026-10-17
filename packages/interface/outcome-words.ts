// interface/outcome-words — what the page says when the host answered a command
// it waited on with a refusal or a failure: the work strip's commands on
// proposed changes and the publish button's toast both say it this way.

import type { Unsuccessful } from "@pinetrie/session"

/**
 * A refusal says that nothing was done. A failure says the host may have done
 * part of it.
 */
export const outcomeWords = (said: Unsuccessful): string =>
  said.kind === "refused"
    ? `not done: ${said.message}`
    : `it failed, and may be part done: ${said.message}`

/** Your last command here, worded when it was refused or failed; null while it is out, or with none. */
export const actingSaid = (
  acting: Unsuccessful | { readonly kind: "sent" } | null | undefined,
): string | null =>
  acting === null || acting === undefined || acting.kind === "sent"
    ? null
    : outcomeWords(acting)
