// client/identity — who this browser says it is (ADR-0037).
//
// A person is their email: the principal every Exchange of theirs names, and
// so their writer. It is kept per device, shared by its tabs, so a reload, a
// second tab and a second device with the same email are one person. Asked
// for once, with a display name (`identity-form.tsx`). Unverified: anyone
// can type anyone's email.
//
// The stored name is a seed for a session that does not know you yet, and it
// follows the session's name for you: `reconcileName` decides which way a
// difference goes.

import { handleOf, normalizeEmail, normalizeName } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { failedWords } from "./send.ts"
import type { Codec } from "./tab-state.ts"

export interface Identity {
  readonly email: string
  readonly name: string
}

/** Where the identity is kept, in the device's `localStorage`. */
export const IDENTITY_KEY = "pinetrie-identity"

/** The form's input -> an identity, or which field is not usable. */
export function parseIdentity(
  email: string,
  name: string,
):
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly problem: "email" | "name" } {
  const e = normalizeEmail(email)
  if (e === undefined) return { ok: false, problem: "email" }
  const n = normalizeName(name)
  if (n === undefined) return { ok: false, problem: "name" }
  return { ok: true, identity: { email: e, name: n } }
}

export type NameStep =
  /** Storage to session: the session has no name for you. */
  | { readonly kind: "send"; readonly name: string }
  /** Session to storage: the session's name is not the stored one. */
  | { readonly kind: "store"; readonly identity: Identity }

/**
 * What to do when this device's stored name and the session's name for you
 * differ. The session's wins, whichever device set it. Null when they agree,
 * and when nothing is stored for `email`: another tab cleared it or signed in
 * as someone else, and this one is reloading.
 */
export function reconcileName(
  stored: Identity | undefined,
  email: string,
  inSession: string | undefined,
): NameStep | null {
  if (stored === undefined || stored.email !== email) return null
  if (inSession === undefined) return { kind: "send", name: stored.name }
  return inSession === stored.name
    ? null
    : { kind: "store", identity: { email, name: inSession } }
}

export type RenamePlan =
  | { readonly kind: "refuse" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "send"; readonly name: string }

/**
 * The profile's submit. `current` is the session's name for you, undefined
 * when you set none: you are then shown by your email's part before the `@`,
 * and typing that text still sets it.
 */
export function planRename(
  draft: string,
  current: string | undefined,
): RenamePlan {
  const name = normalizeName(draft)
  if (name === undefined) return { kind: "refuse" }
  return name === current ? { kind: "unchanged" } : { kind: "send", name }
}

/**
 * What the profile form shows for the host's answer to a rename: a refusal's
 * code and reason, a failure in `failedWords`, or null when the rename took.
 */
export function renameProblem(
  outcome: Outcome,
): { readonly code: string; readonly message: string } | null {
  switch (outcome.kind) {
    case "refused":
      return { code: outcome.code, message: outcome.message }
    case "failed":
      return { code: "failed", message: failedWords(outcome.message) }
    default:
      return null
  }
}

/** The handle a typed name gives you, or null when the name is refused. */
export function nameHint(draft: string): string | null {
  const name = normalizeName(draft)
  return name === undefined ? null : handleOf(name)
}

const StoredIdentity = Type.Object({
  v: Type.Literal(1),
  email: Type.String(),
  name: Type.String(),
})

/**
 * The stored form, decoded whole or not at all, and only if it would still
 * pass the form: a value from an older rule is asked for again. Total.
 */
export const identityCodec: Codec<Identity> = {
  encode: ({ email, name }) => ({ v: 1, email, name }),
  decode: raw => {
    if (!Value.Check(StoredIdentity, raw)) return undefined
    const parsed = parseIdentity(raw.email, raw.name)
    return parsed.ok ? parsed.identity : undefined
  },
}
