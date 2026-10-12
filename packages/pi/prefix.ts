// pi/prefix — whether a request starts as the lane's last one did.
//
// Anthropic drops an earlier thinking block when anything before it changed
// since it was written, and pi asks it to (`drop_block`). Everything in a
// request but its messages comes before every message: the system prompt, the
// tools, the thinking and effort settings, the betas. So a change to any of
// them costs the lane its earlier reasoning, and the cache from the top.

import { createHash } from "node:crypto"

/** What a request's prefix hashes to: the payload without its `messages`. */
export function prefixOf(payload: unknown): string {
  const rest =
    typeof payload === "object" && payload !== null
      ? Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== "messages"),
        )
      : payload
  return createHash("sha256")
    .update(JSON.stringify(rest) ?? "")
    .digest("hex")
}

/** Whether `next` differs from the lane's previous request; a first request never does. */
export const prefixChange = (
  previous: string | undefined,
  next: string,
): boolean => previous !== undefined && previous !== next
