// config/testing — the checks every table must pass, whatever it declares. A
// test runs `tableProblems(table)` and expects none, so a setting added later
// is checked with no test of its own. Exported as `@pinetrie/config/testing`.

import { CONFIG_LAYERS, type ConfigLayer } from "@pinetrie/core"
import {
  type DecodedLayer,
  decodeEnv,
  decodeLayer,
  decodeProject,
  projectCopy,
  type Refusal,
} from "./decode.ts"
import { isPlainObject, type Kind } from "./kinds.ts"
import {
  type AnySetting,
  admits,
  type LayerRef,
  layerName,
  prefixKeys,
  ruleLayers,
} from "./setting.ts"
import { type Layers, settle } from "./settle.ts"

type Table = { readonly [key: string]: AnySetting }

/** JSON values to try as each setting's: whatever a kind decodes is a sample. */
const POOL: readonly unknown[] = [
  true,
  false,
  0,
  1,
  2,
  5,
  10,
  20,
  120,
  600,
  1000,
  -1,
  "a",
  "b",
  "main",
  "wip/",
  "built-in",
  "drawn",
  "none",
  "HOME",
  "a@example.com",
  "b@example.com",
  "anthropic/claude",
  "openrouter/x/y",
  "/abs/a",
  "/abs/b",
  "rel/a",
  [],
  ["a"],
  ["a", "b"],
  ["b"],
  ["/abs/a"],
  ["/abs/a", "/abs/b"],
  ["/abs/b"],
  ["rel/a"],
  ["rel/a", "rel/b"],
  ["pop"],
  ["pop", "*.lan"],
  ["HOME"],
  ["HOME", "PATH"],
  [8080],
  [8080, 9090],
  [{ source: "rel/a", target: "/mnt/a" }],
  {},
  { "/abs/a": "x" },
  { "/abs/b": "y" },
]

/** `value` at the dotted `key`, as a file's text. */
const fileText = (key: string, value: unknown): string => {
  const parts = key.split(".")
  let json: unknown = value
  for (const part of parts.reverse()) json = { [part]: json }
  return JSON.stringify(json)
}

/** One layer of `table` with `value` at `key`. */
function layerWith<T extends Table>(
  table: T,
  ref: LayerRef,
  key: string,
  value: unknown,
): Partial<Layers<T>> {
  const read = { kind: "text", text: fileText(key, value) } as const
  if (typeof ref !== "string")
    return {
      project: {
        [ref.project]: decodeProject(
          table,
          projectCopy(ref.project, `project.${ref.project}`, read),
        ),
      },
    }
  if (ref === "env") {
    const setting = table[key]
    const name = setting?.env ?? null
    return name === null || typeof value !== "string"
      ? {}
      : { env: decodeEnv(table, { [name]: value }) }
  }
  return { [ref]: decodeLayer(table, ref, `${ref}.json`, read) }
}

const NO_LAYERS = {
  system: null,
  user: null,
  local: null,
  env: null,
  project: {},
}

function layersWith<T extends Table>(
  table: T,
  entries: readonly (readonly [LayerRef, string, unknown])[],
): Layers<T> {
  let out: Layers<T> = NO_LAYERS
  for (const [ref, key, value] of entries) {
    const one = layerWith(table, ref, key, value)
    out = {
      ...out,
      ...one,
      project: { ...out.project, ...(one.project ?? {}) },
    }
  }
  return out
}

/** Everything wrong with `table`, as sentences; none when it holds every rule. */
export function tableProblems<T extends Table>(table: T): readonly string[] {
  const problems: string[] = []
  for (const clash of prefixKeys(Object.keys(table)))
    problems.push(`a key is a prefix of another: ${clash}`)

  for (const [key, setting] of Object.entries(table)) {
    const kind = setting.kind as Kind<unknown>
    const say = (s: string) => problems.push(`${key}: ${s}`)
    const value = (layers: Layers<T>) => settle(table, layers).settled[key]
    const refs = ruleLayers(setting.rule)

    if (kind.reach === "host")
      for (const layer of CONFIG_LAYERS)
        if (admits(setting, layer) && layer !== "system" && layer !== "user")
          say(`runs code on the host or sends a key, yet admits ${layer}`)

    const samples = POOL.flatMap(json => {
      const one = kind.decode(json)
      return one.ok ? [{ json, value: one.value }] : []
    })
    if (samples.length < 2) {
      say("fewer than two sample values decode: add one to the pool")
      continue
    }
    const [a, b] = samples.filter(
      (s, i) => samples.findIndex(t => kind.same(t.value, s.value)) === i,
    )
    if (a === undefined || b === undefined) {
      say("no two different sample values decode")
      continue
    }

    // A layer the setting does not admit is refused, and changes nothing.
    const none = value(NO_LAYERS)
    for (const layer of CONFIG_LAYERS) {
      if (admits(setting, layer) || layer === "env") continue
      const ref: LayerRef =
        layer === "project" ? { project: "accepted" } : layer
      const layers = layersWith(table, [[ref, key, a.json]])
      const refusals = settle(table, layers).refusals
      if (!refusals.some(r => r.key === key && r.why === "not-here"))
        say(`a value in the ${layer} layer is not refused`)
      if (!kind.same(value(layers)?.value, none?.value))
        say(`a value in the ${layer} layer changes it`)
    }

    // A pick takes the most specific layer in its order.
    if (setting.rule.kind === "pick")
      for (let i = 0; i < refs.length; i++)
        for (let j = i + 1; j < refs.length; j++) {
          const [lo, hi] = [refs[i], refs[j]]
          if (lo === undefined || hi === undefined) continue
          if (lo === "env" || hi === "env")
            if (typeof a.json !== "string" || typeof b.json !== "string")
              continue
          const got = value(
            layersWith(table, [
              [lo, key, a.json],
              [hi, key, b.json],
            ]),
          )
          if (!kind.same(got?.value, b.value))
            say(
              `a pick takes ${layerName(lo)} over the more specific ${layerName(hi)}`,
            )
        }

    // A limit only narrows: the result is below both the unlimited value and
    // the limit's.
    const first = refs[0]
    if (first !== undefined && first !== "env")
      for (const limit of setting.limits) {
        const meet = kind.meet
        if (meet === undefined) {
          say("is limited, but its kind has no meet")
          break
        }
        for (const v of samples)
          for (const l of samples) {
            const free = value(layersWith(table, [[first, key, v.json]]))
            const got = value(
              layersWith(table, [
                [first, key, v.json],
                [limit, key, l.json],
              ]),
            )
            if (free === undefined || got === undefined) continue
            const below = (x: unknown, y: unknown) => kind.same(meet(x, y), x)
            if (!below(got.value, free.value) || !below(got.value, l.value)) {
              say(`a limit in ${layerName(limit)} widens it`)
              break
            }
          }
      }
  }

  // Every refusal names its file and key.
  const unknownKey = "zz-no-such-setting"
  const refusals: readonly Refusal[] = (
    ["system", "user", "local"] as const satisfies readonly ConfigLayer[]
  ).flatMap(
    layer =>
      (
        decodeLayer(table, layer, `${layer}.json`, {
          kind: "text",
          text: fileText(unknownKey, 1),
        }) as DecodedLayer<T, typeof layer>
      ).refusals,
  )
  if (
    refusals.length !== 3 ||
    refusals.some(r => r.file === "" || r.key !== unknownKey)
  )
    problems.push("an unknown key's refusal does not name its file and key")
  return problems
}

/** The JSON a test writes for `values` at their dotted keys. */
export function configText(values: Readonly<Record<string, unknown>>): string {
  const root: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split(".")
    let at = root
    for (const part of parts.slice(0, -1)) {
      const next = at[part]
      at[part] = isPlainObject(next) ? { ...next } : {}
      at = at[part] as Record<string, unknown>
    }
    const last = parts.at(-1)
    if (last !== undefined) at[last] = value
  }
  return JSON.stringify(root)
}
