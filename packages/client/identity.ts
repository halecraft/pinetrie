// client/identity — who this browser says it is (ADR-0037).
//
// A person is their email: the principal every Exchange of theirs names, and
// so their writer. It is kept per device, shared by its tabs, so a reload, a
// second tab and a second device with the same email are one person. Asked
// for once, with a display name (`identity-form.tsx`). Unverified: anyone
// can type anyone's email.
//
// The stored name is a seed: only `nameOnJoin` reads it, to name a person the
// session does not know yet. A rename is the session's (`setName`), and is not
// written back here.

import { normalizeEmail, normalizeName } from "@pineta/core"
import { Type } from "typebox"
import { Value } from "typebox/value"
import type { Codec } from "./tab-state.ts"

export interface Identity {
  readonly email: string
  readonly name: string
}

/** Where the identity is kept, in the device's `localStorage`. */
export const IDENTITY_KEY = "pineta-identity"

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

/**
 * The name to send on joining: the stored one when the session has none for
 * this writer, else null. A name the session has, set here or on another
 * device, wins.
 */
export const nameOnJoin = (
  stored: Identity,
  inSession: string | undefined,
): string | null => (inSession === undefined ? stored.name : null)

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
