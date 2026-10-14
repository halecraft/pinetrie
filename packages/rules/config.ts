// config — a model as the config names it. The config's files are decoded
// by the host's table (`@pinetrie/config`); this is the one parser a model
// setting's kind wraps.

/** A model as pi names it: its provider and its id there. */
export interface ModelRef {
  readonly provider: string
  readonly model: string
}

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
