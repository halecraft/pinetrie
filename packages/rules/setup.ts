// setup — what the host read of its config, published for the setup page as
// the one `pinetrie.setup` value.

import {
  CONFIG_FILE_STATES,
  CONFIG_LAYERS,
  NO_MODEL_REASONS,
  REFUSAL_REASONS,
  type SetupRecord,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, fixedKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.setup` value's key. */
export const SETUP_KEY = "setup"

/** One of `values`, as a schema: the type and its schema share one list. */
const oneOf = <V extends string>(values: readonly V[]) =>
  Type.Union(values.map(v => Type.Literal(v)))

const Layer = oneOf(CONFIG_LAYERS)

const Origin = Type.Union([
  Type.Object({ kind: Type.Literal("fallback") }),
  Type.Object({
    kind: Type.Literal("file"),
    layer: Layer,
    file: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("env"), name: Type.String() }),
])

const SetupRecordSchema = Type.Object({
  files: Type.Array(
    Type.Object({
      layer: Layer,
      file: Type.String(),
      state: oneOf(CONFIG_FILE_STATES),
    }),
  ),
  refusals: Type.Array(
    Type.Object({
      layer: Layer,
      file: Type.String(),
      key: Type.String(),
      why: oneOf(REFUSAL_REASONS),
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
      why: oneOf(NO_MODEL_REASONS),
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
})

/** What the host read of its config, at its one key, for the setup page. */
export const SETUP: RecordSpec<SetupRecord, typeof SETUP_KEY, "session"> = {
  namespace: "pinetrie.setup",
  home: "session",
  keyOf: () => SETUP_KEY,
  encode: r => ({ ...r }),
  decode: (contents, key) =>
    decodeAt(SetupRecordSchema, contents, fixedKey(SETUP_KEY, key), r => r),
}
