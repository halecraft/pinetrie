// setup-words — the words for what the host read of its config: a layer's
// file and its state, a refusal, a setting's origin. The setup page and the
// host's startup lines both say them through these, so the terminal and the
// page never word one fact two ways.

import type {
  ConfigFileState,
  ConfigLayer,
  ConfigOrigin,
  ConfigRefusal,
  NoModel,
  SetupSession,
} from "@pinetrie/core"

const LAYER_NAMES: Readonly<Record<ConfigLayer, string>> = {
  system: "the machine's file",
  user: "your file",
  project: "the project's pinetrie.json",
  local: "your file for this project",
  env: "the environment",
}

/** What a layer is, for a person: "your file", "the machine's file". */
export const layerWords = (layer: ConfigLayer): string => LAYER_NAMES[layer]

/** The local layer, named with the session it belongs to. */
export const localLayerWords = (session: SetupSession): string =>
  `your file for session ${session.name} (${session.path})`

/** A layer's file and whether it was read. */
export function fileStateWords(file: string, state: ConfigFileState): string {
  switch (state) {
    case "read":
      return file
    case "missing":
      return `${file} (none)`
    case "broken":
      return `${file} (not read)`
  }
}

/** Why a key a file wrote was not taken. */
export function refusalWords(r: ConfigRefusal): string {
  switch (r.why) {
    case "broken":
      return `${r.file} is not read: ${r.detail}`
    case "unknown":
      return `${r.file}: ${r.key} is not a setting, and is not read`
    case "not-here":
      return `${r.file}: ${r.key} cannot be set in ${layerWords(r.layer)}, and is not read`
    case "malformed":
      return `${r.file}: ${r.key} ${r.detail}, and is not taken`
  }
}

/** Where a setting's value came from. */
export function originWords(origins: readonly ConfigOrigin[]): string {
  if (origins.length === 0) return "by default"
  const one = (o: ConfigOrigin) =>
    o.kind === "fallback"
      ? "by default"
      : o.kind === "env"
        ? `$${o.name}`
        : o.file
  return `from ${origins.map(one).join(", ")}`
}

/** Why a host has no model, as the setup page and the startup line say it. */
export function noModelWords(why: NoModel, named: string | null): string {
  switch (why) {
    case "unset":
      return "no config names one: set model, as provider/id"
    case "not-found":
      return `${named ?? "the model named"} is not a model pi knows, nor one in models.json`
    case "no-credential": {
      const provider = named?.split("/")[0] ?? "its provider"
      return `${named ?? "the model named"} has no credential: pnpm sign-in ${provider}`
    }
  }
}

/** Where pi found a provider's credential, by its word for it. */
export function credentialWords(source: string): string {
  switch (source) {
    case "stored":
      return "signed in (auth.json)"
    case "environment":
      return "from an environment variable"
    case "models_json_key":
    case "models_json_command":
      return "from models.json"
    default:
      return source
  }
}

/** The setup page's own words. */
export const setupPageWords = {
  model: "Model",
  signIn: "Sign in",
  signInHint:
    "pnpm sign-in <provider> on this host's machine: a subscription in a browser, or an API key",
  noCredential: "No provider has a credential yet.",
  files: "Config files",
  refusals: "Not taken",
  settings: "Settings",
  packages: "Skills, prompts and packages",
  refusedPackage: "is not a folder, and is not loaded",
  contextFiles: "Context files",
  noContextFile: "None.",
  notYet: "The host has not said what it read yet.",
} as const
