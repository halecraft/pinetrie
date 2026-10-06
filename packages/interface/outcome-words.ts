// interface/outcome-words — what the page says when the host answered a command
// it waited on with a refusal or a failure: the work strip's offer commands
// and the publish button's toast (ADR-0090) both say it this way.

import type { Unsuccessful } from "@pinetrie/session"

/**
 * A refusal says that nothing was done. A failure says the host may have done
 * part of it.
 */
export const outcomeWords = (said: Unsuccessful): string =>
  said.kind === "refused"
    ? `not done: ${said.message}`
    : `it failed, and may be part done: ${said.message}`
