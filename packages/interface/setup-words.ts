// setup-words — the words for what the host read of its config: a layer's
// file and its state, a refusal, a setting's origin. The setup page and the
// host's startup lines both say them through these, so the terminal and the
// page never word one fact two ways.

import {
  type ConfigFileState,
  type ConfigLayer,
  type ConfigOrigin,
  type ConfigRefusal,
  PRODUCT_NAME,
} from "@pinetrie/core"
import {
  type NoModel,
  type SetupSession,
  type SetupSubscription,
  SUBSCRIPTION_SETTING,
} from "@pinetrie/rules"

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
      return `${named ?? "the model named"} has no credential: pinetrie sign-in ${provider}`
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

/** Who shapes the provider's subscription requests, and the warning when one is signed in and nothing does. */
export function subscriptionWords(s: SetupSubscription): {
  readonly line: string
  readonly warning: string | null
} {
  return {
    line: shapingLine(s),
    warning: s.unshaped
      ? `${s.provider} is signed in with a subscription, and nothing shapes its requests: every run on an ${s.provider} model fails. Set ${SUBSCRIPTION_SETTING} to true, or list ${s.package} in packages.`
      : null,
  }
}

function shapingLine(s: SetupSubscription): string {
  const versioned = (version: string | null) =>
    version === null ? s.package : `${s.package} ${version}`
  switch (s.shaping.kind) {
    case "shipped":
      return `${versioned(s.shaping.version)}, shipped with ${PRODUCT_NAME}`
    case "listed":
      return `${versioned(s.shaping.version)}, from ${s.shaping.path}`
    case "off":
      return `none: ${SUBSCRIPTION_SETTING} is false`
  }
}

/** The setup page's own words. */
export const setupPageWords = {
  model: "Model",
  signIn: "Sign in",
  signInHint:
    "pinetrie sign-in <provider> on this host's machine: a subscription in a browser, or an API key",
  noCredential: "No provider has a credential yet.",
  subscription: "Claude subscription",
  files: "Config files",
  refusals: "Not taken",
  settings: "Settings",
  packages: "Skills, prompts and packages",
  refusedPackage: "is not a folder, and is not loaded",
  contextFiles: "Context files",
  noContextFile: "None.",
  notYet: "The host has not said what it read yet.",
} as const
