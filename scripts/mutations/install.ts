// Mutations for @pinetrie/install. Run: pnpm mutate scripts/mutations/install.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/install"]
const file = "packages/install/index.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "a built install names its scripts .ts",
    file,
    from: '  form === "source" ? ".ts" : ".js"',
    to: '  form === "source" ? ".ts" : ".ts"',
    command: unit,
    expect:
      "a script's command is the node it is given, then its path in the install's form",
  },
  {
    name: "a registered script names a file that is not there",
    file,
    from: '  hop: "packages/ssh/hop",',
    to: '  hop: "packages/ssh/hops",',
    command: unit,
    expect: "every registered script is a file of the repo",
  },
  {
    name: "the mount keeps the host's root",
    file,
    from: "  root: PINETRIE_MOUNT,\n  form: install.form,",
    to: '  root: "/",\n  form: install.form,',
    command: unit,
    expect: "inMount keeps the form and puts the root at the mount",
  },
]
