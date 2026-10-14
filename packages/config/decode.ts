// config/decode — one layer's file, decoded against the settings that admit
// that layer, and only those. Nothing is dropped without a word: a key no
// setting has, a key this layer may not set, a value its kind refuses, and a
// file that is not JSON are each a refusal that names its file and key.

import type {
  ConfigFileState,
  ConfigLayer,
  ConfigRefusal,
} from "@pinetrie/core"
import { isPlainObject, type Kind } from "./kinds.ts"
import {
  type AdmittedLayers,
  type AnySetting,
  admits,
  type CopyName,
  type SettingValue,
} from "./setting.ts"

/** A file as read: its text, none, or why it could not be read. */
export type FileRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string }

/** A layer's file: read, absent, or refused whole. */
export type LayerState = ConfigFileState

export type Refusal = ConfigRefusal

/** The values a layer may set: only the keys of settings that admit it. */
export type LayerValues<Table, L extends ConfigLayer> = {
  readonly [K in keyof Table as L extends AdmittedLayers<Table[K]>
    ? K
    : never]?: SettingValue<Table[K]>
}

export interface DecodedLayer<Table, L extends ConfigLayer> {
  readonly layer: L
  readonly file: string
  readonly state: LayerState
  readonly values: LayerValues<Table, L>
  readonly refusals: readonly Refusal[]
}

/** One copy of the project's `pinetrie.json`, named for the copy it is. */
export interface ProjectCopy<C extends CopyName> {
  readonly copy: C
  /** How the copy is named in a refusal: `pinetrie.json at accepted work`. */
  readonly file: string
  readonly read: FileRead
}

export const projectCopy = <C extends CopyName>(
  copy: C,
  file: string,
  read: FileRead,
): ProjectCopy<C> => ({ copy, file, read })

export interface DecodedProject<Table, C extends CopyName>
  extends DecodedLayer<Table, "project"> {
  readonly copy: C
}

type Table = { readonly [key: string]: AnySetting }

const kindOf = (setting: AnySetting) => setting.kind as Kind<unknown>

/** `layer`'s file, decoded against `table`. */
export function decodeLayer<T extends Table, L extends ConfigLayer>(
  table: T,
  layer: L,
  file: string,
  read: FileRead,
): DecodedLayer<T, L> {
  const empty = (state: LayerState, refusals: readonly Refusal[]) => ({
    layer,
    file,
    state,
    values: {} as LayerValues<T, L>,
    refusals,
  })
  if (read.kind === "missing") return empty("missing", [])
  const broken = (detail: string) =>
    empty("broken", [{ layer, file, key: "", why: "broken", detail }])
  if (read.kind === "unreadable") return broken(read.reason)
  let json: unknown
  try {
    json = JSON.parse(read.text)
  } catch (error) {
    return broken(error instanceof Error ? error.message : String(error))
  }
  if (!isPlainObject(json)) return broken("is not a JSON object")

  const keys = Object.keys(table)
  const values: Record<string, unknown> = {}
  const refusals: Refusal[] = []
  const refuse = (key: string, why: Refusal["why"], detail = ""): void => {
    refusals.push({ layer, file, key, why, detail })
  }
  const walk = (value: unknown, path: string): void => {
    const setting = table[path]
    if (setting !== undefined) {
      const one = kindOf(setting).decode(value)
      if (!admits(setting, layer)) refuse(path, "not-here")
      else if (one.ok) values[path] = one.value
      else refuse(path, "malformed", one.why)
    } else if (!keys.some(k => k.startsWith(`${path}.`)))
      refuse(path, "unknown")
    else if (!isPlainObject(value))
      refuse(path, "malformed", "is not an object")
    else for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
  }
  for (const [k, v] of Object.entries(json)) walk(v, k)
  return {
    layer,
    file,
    state: "read",
    values: values as LayerValues<T, L>,
    refusals,
  }
}

/** A copy of the project's file, decoded as the project layer. */
export function decodeProject<T extends Table, C extends CopyName>(
  table: T,
  copy: ProjectCopy<C>,
): DecodedProject<T, C> {
  return {
    ...decodeLayer(table, "project", copy.file, copy.read),
    copy: copy.copy,
  }
}

/** The environment's values, for the settings that name a variable. */
export function decodeEnv<T extends Table>(
  table: T,
  env: Readonly<Record<string, string | undefined>>,
): DecodedLayer<T, "env"> {
  const values: Record<string, unknown> = {}
  const refusals: Refusal[] = []
  for (const [key, setting] of Object.entries(table)) {
    if (setting.env === null) continue
    const given = env[setting.env]
    if (given === undefined || given === "") continue
    const one = kindOf(setting).decode(given)
    if (one.ok) values[key] = one.value
    else
      refusals.push({
        layer: "env",
        file: setting.env,
        key,
        why: "malformed",
        detail: one.why,
      })
  }
  return {
    layer: "env",
    file: "the environment",
    state: "read",
    values: values as LayerValues<T, "env">,
    refusals,
  }
}
