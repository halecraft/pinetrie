// host/migrations/0011-carry-on-ssh-allowed — the carry-on an owner's answer
// wakes a lane with names its reason `ssh-allowed`, not `ssh-approved`. One
// stored in the old word does not decode, so the column would drop it, and
// with it the "↻ resumed by" line: each is renamed in place, in every root.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { CARRY_ON_TYPE } from "@pinetrie/rules"
import { rewriteHistory } from "./rewrite.ts"

/** A stored carry-on's details whose reason is the old word, renamed; null for any other. */
export function carryOnSshAllowed(details: unknown): object | null {
  if (details === null || typeof details !== "object") return null
  const { reason } = details as { readonly reason?: unknown }
  if (reason === null || typeof reason !== "object") return null
  const r = reason as Readonly<Record<string, unknown>>
  return r.kind === "ssh-approved"
    ? { ...details, reason: { ...r, kind: "ssh-allowed" } }
    : null
}

export const carryOnSshAllowedMigration = rewriteHistory({
  name: "0011-carry-on-ssh-allowed",
  customType: CARRY_ON_TYPE,
  rewrite: carryOnSshAllowed,
})
