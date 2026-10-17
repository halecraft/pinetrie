// config/setting — a setting is a value that carries its rule and the layers
// that may set it. The constructors are the only way to make one, and their
// types refuse what the rules forbid: a limit on a kind that cannot narrow,
// a join on one that cannot add, and a host-code kind on a project's or a
// local layer.

import type { ConfigLayer } from "@pinetrie/core"
import type { Decoded, Kind, KindValue, Reach } from "./kinds.ts"

/** Which copy of the project's `pinetrie.json` a setting reads. */
export type CopyName = "accepted" | "working" | "lane"

/** A layer as a setting names it: the project's always with its copy. */
export type LayerRef =
  | "system"
  | "user"
  | "local"
  | "env"
  | { readonly project: CopyName }

/** The layers a host-code kind may name. */
export type HostLayerRef = "system" | "user"

/** The layers a setting of kind `K` may name. */
export type AdmissibleLayers<K> = K extends { readonly reach: "host" }
  ? HostLayerRef
  : LayerRef

/** The layer a reference names. */
type LayerName<R> = R extends { readonly project: CopyName } ? "project" : R

export type Rule =
  /** The most specific layer in `order` that sets it decides. */
  | { readonly kind: "pick"; readonly order: readonly LayerRef[] }
  /** Every layer in `layers` that sets it adds to it, in that order. */
  | { readonly kind: "join"; readonly layers: readonly LayerRef[] }

/** Any kind, whatever its value: what a constraint names. */
export interface AnyKind {
  readonly reach: Reach
  readonly decode: (json: unknown) => Decoded<unknown>
}

/** `A` is the layers it admits, and `K` its kind, both for the types alone. */
export interface Setting<
  T,
  A extends ConfigLayer = ConfigLayer,
  K extends AnyKind = Kind<T, Reach>,
> {
  readonly kind: K
  /** A pick's value when no layer sets it; a join's is its kind's `empty`. */
  readonly fallback: T
  /** One line, for the setup page. */
  readonly describe: string
  readonly rule: Rule
  /** The layers whose value narrows the result, with the kind's `meet`. */
  readonly limits: readonly LayerRef[]
  /** The environment variable, when the rule names `env`. */
  readonly env: string | null
  readonly admitted?: A
}

/** What every setting has, whatever its value: what a table holds. */
export interface AnySetting {
  readonly kind: { readonly reach: Reach }
  readonly describe: string
  readonly rule: Rule
  readonly limits: readonly LayerRef[]
  readonly env: string | null
  readonly admitted?: ConfigLayer
}

/** The value a setting settles to. */
export type SettingValue<S> = S extends { readonly fallback: infer T }
  ? T
  : never

/** The layers a setting admits. */
export type AdmittedLayers<S> = Exclude<
  S extends { readonly admitted?: infer A } ? A : never,
  undefined
>

export const layerName = (ref: LayerRef): ConfigLayer =>
  typeof ref === "string" ? ref : "project"

/** The rule's layers, in its order. */
export const ruleLayers = (rule: Rule): readonly LayerRef[] =>
  rule.kind === "pick" ? rule.order : rule.layers

/** Whether `layer` may set the setting: its rule names it, or a limit does. */
export const admits = (setting: AnySetting, layer: ConfigLayer): boolean =>
  [...ruleLayers(setting.rule), ...setting.limits].some(
    r => layerName(r) === layer,
  )

function checkEnv(order: readonly LayerRef[], env: string | undefined) {
  const named = order.includes("env")
  if (named !== (env !== undefined))
    throw new Error(
      named
        ? "a setting whose rule names env needs its variable"
        : "a setting with a variable must name env in its rule",
    )
}

/** The most specific layer in `order` that sets it decides; else `fallback`. */
export function pick<K extends AnyKind, const O extends AdmissibleLayers<K>>(
  kind: K,
  options: {
    readonly fallback: KindValue<K>
    readonly describe: string
    readonly order: readonly O[]
    readonly env?: string
  },
): Setting<KindValue<K>, LayerName<O>, K> {
  checkEnv(options.order, options.env)
  return {
    kind,
    fallback: options.fallback,
    describe: options.describe,
    rule: { kind: "pick", order: options.order },
    limits: [],
    env: options.env ?? null,
  }
}

/** Every layer in `layers` that sets it adds to it, from the kind's `empty`. */
export function join<
  K extends AnyKind & { readonly join: unknown; readonly empty: unknown },
  const L extends Exclude<AdmissibleLayers<K>, "env">,
>(
  kind: K,
  options: { readonly describe: string; readonly layers: readonly L[] },
): Setting<KindValue<K>, LayerName<L>, K> {
  if (kind.join === undefined || kind.empty === undefined)
    throw new Error("a join needs a kind that adds up")
  return {
    kind,
    fallback: kind.empty as KindValue<K>,
    describe: options.describe,
    rule: { kind: "join", layers: options.layers },
    limits: [],
    env: null,
  }
}

/** `setting`, narrowed by each of `limits`' values with its kind's `meet`. */
export function limited<
  T,
  A extends ConfigLayer,
  K extends AnyKind & { readonly meet: unknown },
  const L extends Exclude<LayerRef, "env">,
>(
  setting: Setting<T, A, K>,
  limits: readonly L[],
): Setting<T, A | LayerName<L>, K> {
  if (setting.kind.meet === undefined)
    throw new Error("a limit needs a kind that narrows")
  return { ...setting, limits: [...setting.limits, ...limits] }
}

/** The keys of which one is a prefix of another, each pair once. */
export function prefixKeys(keys: readonly string[]): readonly string[] {
  return keys.flatMap(a =>
    keys.filter(b => b !== a && b.startsWith(`${a}.`)).map(b => `${a} ⊂ ${b}`),
  )
}

/**
 * A table, keyed by each setting's dotted path in `pinetrie.json`. A key
 * that is a prefix of another is refused here, at load: the walk could not
 * tell which setting owns the subtree.
 */
export function defineTable<
  const Table extends { readonly [key: string]: AnySetting },
>(table: Table): Table {
  const clash = prefixKeys(Object.keys(table))
  if (clash.length > 0)
    throw new Error(`a setting's key is a prefix of another's: ${clash[0]}`)
  return table
}
