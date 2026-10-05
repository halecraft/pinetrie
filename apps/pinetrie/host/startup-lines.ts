// host/startup-lines — the words of the lines a starting host logs about what
// it serves and what it read: the project, the store, the user config (and a
// project's broken `pinetrie.json`), the model, and where to open the host.
// A line about the session's state stays beside what computes it, such as
// `rootsOpenedWords` in `docs.ts`.

import type { ConfigRead } from "@pinetrie/lanes"
import type { FieldSource, ModelOrigin } from "@pinetrie/pi"
import type { StoreChoice } from "./invocation.ts"

/** `[host] label` padded so the values line up. */
const line = (label: string, value: string): string =>
  `[host] ${label.padEnd(11)} ${value}`

export const projectLine = (root: string): string => line("project", root)

export const storeLine = (store: StoreChoice): string =>
  line(
    "store",
    store.from === "PINETRIE_STORE"
      ? `${store.file} (PINETRIE_STORE)`
      : store.file,
  )

const brokenWords = (file: string, reason: string): string =>
  `${file} is broken, so none of it applies: ${reason}`

/** The user config: read, missing or broken. */
export function configLine(file: string, read: ConfigRead): string {
  switch (read.kind) {
    case "read":
      return line("config", file)
    case "missing":
      return line("config", `${file} (none)`)
    case "broken":
      return line("config", brokenWords(file, read.reason))
  }
}

/** A project's config file that exists but could not be read or parsed. */
export const brokenConfigLine = (file: string, reason: string): string =>
  `[host] ${brokenWords(file, reason)}`

// `server.ts` is the only caller that overrides a configured model, from
// these variables.
const OVERRIDES = {
  provider: "PINETRIE_PROVIDER",
  model: "PINETRIE_MODEL",
} as const

/**
 * Where a configured model's provider and model came from; null for a named
 * or scripted model, which only the suites run.
 */
export function originWords(origin: ModelOrigin): string | null {
  if (origin.kind !== "configured") return null
  const { provider, model } = origin
  if (provider.kind === "override" && model.kind === "override")
    return `${OVERRIDES.provider}, ${OVERRIDES.model}`
  if (
    provider.kind === "settings" &&
    model.kind === "settings" &&
    provider.file === model.file
  )
    return `from ${provider.file}`
  const say = (field: "provider" | "model", from: FieldSource) =>
    from.kind === "override" ? OVERRIDES[field] : `${field} from ${from.file}`
  return `${say("provider", provider)}; ${say("model", model)}`
}

export function agentReadyLine(agent: {
  readonly label: string
  readonly origin: ModelOrigin
  /** The directory tools work in; null with tools off. */
  readonly tools: string | null
}): string {
  const origin = originWords(agent.origin)
  const model = origin === null ? agent.label : `${agent.label} (${origin})`
  const tools = agent.tools === null ? "off" : `on, in ${agent.tools}`
  return `[host] agent ready — model ${model}; tools ${tools}`
}

export const listeningLine = (url: string): string => line("listening", url)

export const openLine = (invite: string): string => line("open", invite)
