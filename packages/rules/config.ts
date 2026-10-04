// config — reading the user config (`~/.config/pineta/config.json`): the
// helpers its settings' decoders share (`decodeBannerConfig`,
// `decodeDigestConfig`, `decodeTitleConfig`). Each decoder is total: a
// missing or malformed setting takes its default.

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
