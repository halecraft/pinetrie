// config — reading the user config (`~/.config/pinetrie/config.json`). Each
// decoder is total: a missing or malformed setting takes its default.

import { type WriterId, writerOfPrincipal } from "@pinetrie/core"

/** A model as pi names it: its provider and its id there. */
export interface ModelRef {
  readonly provider: string
  readonly model: string
}

/** `v` as an object's fields, or undefined for anything that is not a plain object. */
export const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

/**
 * A `provider/id` setting, split at its first `/`, since an OpenRouter id
 * holds one. Undefined for anything else, or an empty provider or id.
 */
export function modelRef(value: unknown): ModelRef | undefined {
  if (typeof value !== "string") return undefined
  const at = value.indexOf("/")
  return at > 0 && at < value.length - 1
    ? { provider: value.slice(0, at), model: value.slice(at + 1) }
    : undefined
}

/**
 * The user config's `owner`, an email: whose ssh identity lanes may ask for,
 * and who answers them. Null when absent or not an email.
 */
export const decodeOwner = (json: unknown): WriterId | null => {
  const owner = recordOf(json)?.owner
  return typeof owner === "string" ? (writerOfPrincipal(owner) ?? null) : null
}
