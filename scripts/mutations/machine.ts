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
  {
    name: "a skipped snapshot is not counted",
    file: "packages/machine/manager.ts",
    from: "      skipped++\n",
    to: "",
    command: unit,
    expect: "a skipped snapshot is counted in the next sample, and only in it",
  },
  {
    name: "skipped snapshots are counted again each sample",
    file: "packages/machine/manager.ts",
    from: "      skipped = 0\n",
    to: "",
    command: unit,
    expect: "a skipped snapshot is counted in the next sample, and only in it",
  },
  {
    name: "a skipped snapshot's cause leaves at the next sample",
    file: "packages/machine/health.ts",
    from: '  "host-stalls",\n  "snapshot-skipped",\n])',
    to: '  "host-stalls",\n])',
    command: unit,
    expect:
      "a skipped snapshot is a cause counting them, until LEAVE_AFTER samples without one",
  },
  {
    name: "planEntryRetention may choose a lane's newest row",
    file: "packages/machine/retention.ts",
    from: "  return row.branched || newest.get(row.lane) === row.snapshot\n",
    to: "  return row.branched\n",
    command: unit,
    expect:
      "a branched row and a lane's newest are never the least recently used to go",
  },
  {
    name: "the budget is met only below it",
    file: "packages/machine/retention.ts",
    from: "    if (!(cost > facts.budget || roomLow())) break\n",
    to: "    if (!(cost >= facts.budget || roomLow())) break\n",
    command: unit,
    expect: "kept rows within the budget stay, and one over it goes",
  },
  {
    name: "unindexed entries go before the index is complete",
    file: "packages/machine/retention.ts",
    from: "  if (facts.complete)\n",
    to: "  if (true)\n",
    command: unit,
    expect: "no unindexed name goes while the index is incomplete",
  },
  {
    name: "a reserved row is the least recently used to go",
    file: "packages/machine/retention.ts",
    from: '  const kept = facts.rows.filter(\n    r => r.state === "kept" && listed.has(r.snapshot),\n  )',
    to: '  const kept = facts.rows.filter(\n    r => r.state !== "deleted" && listed.has(r.snapshot),\n  )',
    command: unit,
    expect:
      "no plan deletes another owner's name, a protected row, an unindexed name before the index is complete, or more than its limit",
  },
  {
    name: "a dead host's reservations are never settled",
    file: "packages/machine/manager.ts",
    from: "    if (!settled) {\n",
    to: "    if (false) {\n",
    command: unit,
    expect: "a first upkeep settles a dead host's reservations",
  },
  {
    name: "the retention table gives folder states the entry rule",
    file: "packages/machine/retention.ts",
    from: '  "folder-state": keepAll,\n',
    to: '  "folder-state": planEntryRetention,\n',
    command: unit,
    expect: "only entries have a rule that deletes",
  },
  {
    name: "the store grows into the volume's leaveFree",
    file: "packages/machine/store-size.ts",
    from: "    settings.max ?? Number.POSITIVE_INFINITY,\n    volumeAllows,\n",
    to: "    settings.max ?? Number.POSITIVE_INFINITY,\n",
    command: unit,
    expect:
      "it grows to at most what the volume gives while keeping lanes.store.leaveFree",
  },
  {
    name: "a backend that cannot grow plans a growth",
    file: "packages/machine/store-size.ts",
    from: "  if (!capabilities.grow) return null\n",
    to: "",
    command: unit,
    expect: "a backend that cannot grow plans nothing",
  },
]
