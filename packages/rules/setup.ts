// setup — what the host read of its config, published for the setup page as
// the one `pinetrie.setup` value.

import {
  CONFIG_FILE_STATES,
  CONFIG_LAYERS,
  type ConfigFileState,
  type ConfigLayer,
  type ConfigOrigin,
  type ConfigRefusal,
  REFUSAL_REASONS,
} from "@pinetrie/core"
import { Type } from "typebox"
import { choiceSchema, decodeRecord, fixedKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.setup` value's key. */
export const SETUP_KEY = "setup"

/** One of `values`, as a schema: the type and its schema share one list. */
const Layer = choiceSchema(CONFIG_LAYERS)

const Origin = Type.Union([
  Type.Object({ kind: Type.Literal("fallback") }),
  Type.Object({
    kind: Type.Literal("file"),
    layer: Layer,
    file: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("env"), name: Type.String() }),
])

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
const NO_MODEL_REASONS = ["unset", "not-found", "no-credential"] as const

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
interface SetupCredential {
  readonly provider: string
  /** pi's word for the source: `stored` (auth.json), `environment`, `models_json_key`, … */
  readonly source: string
}

/** One setting as settled, for the setup page: nothing in config is secret. */
interface SetupSetting {
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

const SetupRecordSchema = Type.Object({
  files: Type.Array(
    Type.Object({
      layer: Layer,
      file: Type.String(),
      state: choiceSchema(CONFIG_FILE_STATES),
    }),
  ),
  refusals: Type.Array(
    Type.Object({
      layer: Layer,
      file: Type.String(),
      key: Type.String(),
      why: choiceSchema(REFUSAL_REASONS),
      detail: Type.String(),
    }),
  ),
  model: Type.Union([
    Type.Object({
      kind: Type.Literal("model"),
      label: Type.String(),
      origins: Type.Array(Origin),
    }),
    Type.Object({
      kind: Type.Literal("none"),
      why: choiceSchema(NO_MODEL_REASONS),
      named: Type.Union([Type.String(), Type.Null()]),
    }),
  ]),
  credentials: Type.Array(
    Type.Object({ provider: Type.String(), source: Type.String() }),
  ),
  settings: Type.Array(
    Type.Object({
      key: Type.String(),
      describe: Type.String(),
      value: Type.String(),
      origins: Type.Array(Origin),
    }),
  ),
  refusedPackages: Type.Array(Type.String()),
  contextFiles: Type.Array(Type.String()),
  session: Type.Union([
    Type.Object({ name: Type.String(), path: Type.String() }),
    Type.Null(),
  ]),
})

/** What the host read of its config, at its one key, for the setup page. */
export const SETUP: RecordSpec<SetupRecord, typeof SETUP_KEY, "session"> = {
  namespace: "pinetrie.setup",
  home: "session",
  keyOf: () => SETUP_KEY,
  encode: r => ({ ...r }),
  decode: (contents, key) =>
    decodeRecord(SetupRecordSchema, contents, fixedKey(SETUP_KEY, key), r => r),
}
