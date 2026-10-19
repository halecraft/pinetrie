// host/migrations/0015-card-command-get-latest — a text card that gets the
// latest before it is sent stores its command as `get-latest` or
// `get-latest-from-parent`, not `bring-up-to-date` or `catch-up-with-parent`.
// A row in the old words does not decode, so the card would vanish: each is
// renamed in place, live or trashed.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { rewritePlacesRows } from "./rewrite.ts"

const NEW_COMMAND: Readonly<Record<string, string>> = {
  "bring-up-to-date": "get-latest",
  "catch-up-with-parent": "get-latest-from-parent",
}

/** A places row whose command is in the old words, renamed; null for any other. */
export function cardCommandGetLatest(row: unknown): object | null {
  if (row === null || typeof row !== "object") return null
  const { command } = row as { readonly command?: unknown }
  const now = typeof command === "string" ? NEW_COMMAND[command] : undefined
  return now === undefined ? null : { ...row, command: now }
}

export const cardCommandGetLatestMigration = rewritePlacesRows({
  name: "0015-card-command-get-latest",
  rewrite: cardCommandGetLatest,
})
