// host/migrations/0010-ssh-fact-words — an ssh fact tells a lane its owner
// `denied` its request or `taken-back` what they allowed, not `refused` or
// `revoked`. A fact stored in the old words does not decode, so the column
// would drop it: each is renamed in place, in every root, its `content`,
// what the agent read, untouched.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { SSH_FACT_TYPE } from "@pinetrie/rules"
import { rewriteHistory } from "./rewrite.ts"

const NEW_NEWS: Readonly<Record<string, string>> = {
  refused: "denied",
  revoked: "taken-back",
}

/** A stored ssh fact's details in the old words, renamed; null for any other. */
export function sshFactWords(details: unknown): object | null {
  if (details === null || typeof details !== "object") return null
  const { news } = details as { readonly news?: unknown }
  const renamed = typeof news === "string" ? NEW_NEWS[news] : undefined
  return renamed === undefined ? null : { ...details, news: renamed }
}

export const sshFactWordsMigration = rewriteHistory({
  name: "0010-ssh-fact-words",
  customType: SSH_FACT_TYPE,
  rewrite: sshFactWords,
})
