// config/settle — every setting's value from the decoded layers, by its rule:
// a pick takes the most specific layer in its order that sets it, a join
// adds every one that does, and then each limit narrows with the kind's
// `meet`. The values come back with every layer's refusals, in one report,
// so no caller can take one without the other.

import type { ConfigLayer, ConfigOrigin } from "@pinetrie/core"
import type {
  DecodedLayer,
  DecodedProject,
  LayerState,
  Refusal,
} from "./decode.ts"
import type { Kind } from "./kinds.ts"
import {
  type AnySetting,
  type LayerRef,
  ruleLayers,
  type SettingValue,
} from "./setting.ts"

export type Origin = ConfigOrigin

export interface SettledValue<T> {
  readonly value: T
  /** The value before its limits narrowed it. */
  readonly unlimited: T
  /** One for a pick; every contributor for a join; none for the fallback. */
  readonly origins: readonly Origin[]
  /** The layers whose value narrowed it. */
  readonly limits: readonly Origin[]
}

export type Settled<Table> = {
  readonly [K in keyof Table]: SettledValue<SettingValue<Table[K]>>
}

/** Every layer, decoded. The project's comes as the copies settings read. */
export interface Layers<Table> {
  readonly system: DecodedLayer<Table, "system"> | null
  readonly user: DecodedLayer<Table, "user"> | null
  readonly local: DecodedLayer<Table, "local"> | null
  readonly env: DecodedLayer<Table, "env"> | null
  readonly project: {
    readonly accepted?: DecodedProject<Table, "accepted">
    readonly working?: DecodedProject<Table, "working">
    readonly lane?: DecodedProject<Table, "lane">
  }
}

/** A file layer as read, for the startup lines and the setup page. */
export interface LayerFile {
  readonly layer: ConfigLayer
  readonly file: string
  readonly state: LayerState
}

export interface ConfigReport<Table> {
  readonly settled: Settled<Table>
  readonly files: readonly LayerFile[]
  /** Every layer's refusals, each once. */
  readonly refusals: readonly Refusal[]
}

type AnyLayer = {
  readonly layer: ConfigLayer
  readonly file: string
  readonly state: LayerState
  readonly values: Readonly<Record<string, unknown>>
  readonly refusals: readonly Refusal[]
}

const layerAt = <Table>(
  layers: Layers<Table>,
  ref: LayerRef,
): AnyLayer | null => {
  const found =
    typeof ref === "string" ? layers[ref] : layers.project[ref.project]
  return (found ?? null) as AnyLayer | null
}

/** One setting's value from the layers. */
function settleOne(
  key: string,
  setting: AnySetting & { readonly fallback?: unknown },
  layers: Layers<unknown>,
): SettledValue<unknown> {
  const kind = setting.kind as Kind<unknown>
  const valueAt = (ref: LayerRef) => {
    const layer = layerAt(layers, ref)
    if (layer === null || !(key in layer.values)) return null
    // Only a setting that names a variable has a value in the env layer.
    const origin: Origin =
      layer.layer === "env"
        ? { kind: "env", name: setting.env ?? layer.file }
        : { kind: "file", layer: layer.layer, file: layer.file }
    return { value: layer.values[key], origin }
  }
  const found = ruleLayers(setting.rule)
    .map(valueAt)
    .filter(x => x !== null)
  let value: unknown
  let origins: Origin[]
  if (setting.rule.kind === "pick") {
    const last = found.at(-1)
    value = last === undefined ? setting.fallback : last.value
    origins = last === undefined ? [] : [last.origin]
  } else {
    const join = kind.join
    if (join === undefined)
      throw new Error(`${key}: a join needs its kind's join`)
    value = found.reduce((acc, f) => join(acc, f.value), kind.empty)
    origins = found.map(f => f.origin)
  }
  const unlimited = value
  const limits: Origin[] = []
  for (const ref of setting.limits) {
    const limit = valueAt(ref)
    if (limit === null) continue
    const meet = kind.meet
    if (meet === undefined)
      throw new Error(`${key}: a limit needs its kind's meet`)
    value = meet(value, limit.value)
    limits.push(limit.origin)
  }
  return { value, unlimited, origins, limits }
}

const refusalKey = (r: Refusal) =>
  `${r.layer}\u0000${r.file}\u0000${r.key}\u0000${r.why}`

/** Every setting in `table`, settled from `layers`, with every refusal. */
export function settle<Table extends { readonly [key: string]: AnySetting }>(
  table: Table,
  layers: Layers<Table>,
): ConfigReport<Table> {
  const settled: Record<string, SettledValue<unknown>> = {}
  for (const [key, setting] of Object.entries(table))
    settled[key] = settleOne(key, setting, layers as Layers<unknown>)
  const all = [
    layers.system,
    layers.user,
    layers.local,
    layers.project.working,
    layers.project.accepted,
    layers.project.lane,
    layers.env,
  ].filter(l => l !== null && l !== undefined) as AnyLayer[]
  const seen = new Set<string>()
  const refusals: Refusal[] = []
  for (const r of all.flatMap(l => l.refusals)) {
    const k = refusalKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    refusals.push(r)
  }
  const files = all
    .filter(l => l.layer !== "env")
    .map(l => ({ layer: l.layer, file: l.file, state: l.state }))
  return { settled: settled as Settled<Table>, files, refusals }
}
