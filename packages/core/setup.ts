// core/setup — what the setup page reads: the run's model or why there is
// none, the credentials' sources, the settings as settled, and the session.

import type {
  ConfigFileState,
  ConfigLayer,
  ConfigOrigin,
  ConfigRefusal,
} from "./config.ts"

/** The run's model, as the setup page says it: its `provider/id` and where it came from, or why there is none. */
export type SetupModel =
  | (Extract<ModelLine, { readonly kind: "model" }> & {
      /** Where the config named it; empty for a suite's named or scripted model. */
      readonly origins: readonly ConfigOrigin[]
    })
  | Extract<ModelLine, { readonly kind: "none" }>

/**
 * Why a host has no model: no config names one, the one named is not among
 * pi's models nor `models.json`'s, or its provider has no credential.
 */
export const NO_MODEL_REASONS = ["unset", "not-found", "no-credential"] as const
export type NoModel = (typeof NO_MODEL_REASONS)[number]

/** The run's model as the host says it: its `provider/id`, or why there is none. */
export type ModelLine =
  | { readonly kind: "model"; readonly label: string }
  | {
      readonly kind: "none"
      readonly why: NoModel
      /** The `provider/id` the config named; null when it named none. */
      readonly named: string | null
    }

/** A provider with a credential, and where pi found it; never the credential. */
export interface SetupCredential {
  readonly provider: string
  /** pi's word for the source: `stored` (auth.json), `environment`, `models_json_key`, … */
  readonly source: string
}

/** One setting as settled, for the setup page: nothing in config is secret. */
export interface SetupSetting {
  readonly key: string
  readonly describe: string
  /** The value, as JSON text. */
  readonly value: string
  readonly origins: readonly ConfigOrigin[]
}

/**
 * What the host read of its config and what its model setup loaded,
 * published for the setup page as the one `pinetrie.setup` value. Only what
 * no other record holds: the commands are `pinetrie.commands`'.
 */
export interface SetupRecord {
  readonly files: readonly {
    readonly layer: ConfigLayer
    readonly file: string
    readonly state: ConfigFileState
  }[]
  readonly refusals: readonly ConfigRefusal[]
  readonly model: SetupModel
  readonly credentials: readonly SetupCredential[]
  readonly settings: readonly SetupSetting[]
  /** Listed packages that are not folders, never loaded. */
  readonly refusedPackages: readonly string[]
  readonly contextFiles: readonly string[]
  /** The session served, found by its folder's real path; null with no project. */
  readonly session: SetupSession | null
}

/** A session as the setup page names it: its name, and its folder's real path. */
export interface SetupSession {
  readonly name: string
  readonly path: string
}
