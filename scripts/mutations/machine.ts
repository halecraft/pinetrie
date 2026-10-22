// Mutations for @pinetrie/machine. Run: pnpm mutate scripts/mutations/machine.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/machine"]

export const mutations: readonly Mutation[] = [
  {
    name: "a service's kill heard is no cause",
    file: "packages/machine/health.ts",
    from: "    ...sample.serviceKills.map(\n",
    to: "    ...sample.serviceKills.slice(0, 0).map(\n",
    command: unit,
    expect:
      "a service's kill heard is a cause naming it, until LEAVE_AFTER samples without one",
  },
  {
    name: "every service's kill is one cause",
    file: "packages/machine/health.ts",
    from: "      return `${cause.kind}:${cause.service}`\n",
    to: "      return cause.kind\n",
    command: unit,
    expect: "two services killed are two causes",
  },
  {
    name: "a level enters on its first sample over its threshold",
    file: "packages/machine/health.ts",
    from: "    const count = (was?.count ?? 0) + 1\n",
    to: "    const count = (was?.count ?? 0) + ENTER_AFTER\n",
    command: unit,
    expect: "a level enters only after ENTER_AFTER samples over its threshold",
  },
  {
    name: "every plan is changed, so the record is written each sample",
    file: "packages/machine/health.ts",
    from: "  const changed = !isSameHealth(before.health, health)\n",
    to: "  const changed = true\n",
    command: unit,
    expect:
      "a plan is changed only when its state or causes differ, not their measures",
  },
  {
    name: "close leaves the last health value standing",
    file: "packages/machine/manager.ts",
    from: "      await writeHealth(STOPPED, { ...memory, health: STOPPED })\n",
    to: "",
    command: unit,
    expect: "unsampled is written at start and again at close",
  },
  {
    name: "the boundary lets a module read files",
    file: "packages/machine/store-settings.ts",
    from: "// machine/store-settings",
    to: 'import "node:fs"\n// machine/store-settings',
    command: unit,
    expect:
      "no module of @pinetrie/machine imports a lane package, pi, or Node's I/O",
  },
]
