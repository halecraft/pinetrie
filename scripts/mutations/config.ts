// Mutations for @pinetrie/config. Run: pnpm mutate scripts/mutations/config.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/config"]
const settle = "packages/config/settle.ts"
const decode = "packages/config/decode.ts"
const setting = "packages/config/setting.ts"
const kinds = "packages/config/kinds.ts"

export const mutations: readonly Mutation[] = [
  // ── settling ──
  {
    name: "a limit is applied with join",
    file: settle,
    from: "    const meet = kind.meet\n",
    to: "    const meet = kind.join\n",
    command: unit,
    expect: "a limit narrows, and says where it came from",
  },
  {
    name: "a pick takes the broadest layer, not the most specific",
    file: settle,
    from: "    const last = found.at(-1)\n",
    to: "    const last = found.at(0)\n",
    command: unit,
    expect: "a pick's value says which file it came from",
  },
  {
    name: "the project's refusals are left out of the report",
    file: settle,
    from: "  for (const r of all.flatMap(l => l.refusals)) {",
    to: '  for (const r of all.flatMap(l => (l.layer === "project" ? [] : l.refusals))) {',
    command: unit,
    expect: "the report carries every layer's refusals, each once",
  },
  // ── decoding ──
  {
    name: "decoding admits every layer",
    file: decode,
    from: '      if (!admits(setting, layer)) refuse(path, "not-here")\n      else if',
    to: "      if",
    command: unit,
    expect: "a key this layer may not set is refused, and not decoded",
  },
  {
    name: "an unknown key is dropped without a refusal",
    file: decode,
    from: '      refuse(path, "unknown")\n',
    to: "      undefined\n",
    command: unit,
    expect: "a key no setting has is refused as unknown",
  },
  {
    name: "a value below a setting's prefix is taken whatever it is",
    file: decode,
    from: '    else if (!isPlainObject(value))\n      refuse(path, "malformed", "is not an object")\n',
    to: "    else if (!isPlainObject(value)) undefined\n",
    command: unit,
    expect:
      "a value where settings live below is malformed unless it is an object",
  },
  // ── declaring ──
  {
    name: "a table whose keys overlap is accepted",
    file: setting,
    from: "  if (clash.length > 0)\n    throw",
    to: "  if (clash.length < 0)\n    throw",
    command: unit,
    expect:
      "a key that is a prefix of another is refused when the table is defined",
  },
  {
    name: "host code may name every layer",
    file: setting,
    from: 'export type AdmissibleLayers<K> = K extends { readonly reach: "host" }\n  ? HostLayerRef\n  : LayerRef',
    to: "export type AdmissibleLayers<K> = LayerRef",
    // tsc names no failing check (`failingChecks`): with typecheck clean,
    // any error is the mutant's (an unused `@ts-expect-error`).
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
  {
    name: "a choice can be limited",
    file: setting,
    from: "  K extends AnyKind & { readonly meet: unknown },",
    to: "  K extends AnyKind,",
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
  {
    name: "a decoded copy forgets which copy it is",
    file: decode,
    from: '  extends DecodedLayer<Table, "project"> {\n  readonly copy: C\n',
    to: '  extends DecodedLayer<Table, "project"> {\n  readonly copy: CopyName\n',
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
  {
    name: "host code is checked only by its type",
    file: "packages/config/testing.ts",
    from: '    if (kind.reach === "host")\n',
    to: "    if (kind.reach !== kind.reach)\n",
    command: unit,
    expect: "a host-code setting that admits the project is a problem",
  },
  {
    name: "a flag's limit is or",
    file: kinds,
    from: "  meet: (a, b) => a && b,\n",
    to: "  meet: (a, b) => a || b,\n",
    command: unit,
    expect: "a system file's false turns a flag off for everyone",
  },
  {
    name: "the same refusal is reported once per copy",
    file: settle,
    from: "    if (seen.has(k)) continue\n",
    to: "",
    command: unit,
    expect: "the report carries every layer's refusals, each once",
  },
  {
    name: "a file that cannot be read reads as missing",
    file: "packages/config/read.ts",
    from: "    return isMissing(error)\n",
    to: "    return true\n",
    command: unit,
    expect: "readConfigFile",
  },
]
