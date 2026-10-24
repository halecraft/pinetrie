// Mutations for @pinetrie/machine. Run: pnpm mutate scripts/mutations/machine.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/machine"]

export const mutations: readonly Mutation[] = [
  // ── what the measurements keep ──
  {
    name: "a cgroup at its limit keeps no high",
    file: "packages/machine/measurements.ts",
    from: "    const highHits = hits.high - then.high\n",
    to: "    const highHits = 0\n",
    command: unit,
    expect: "each cgroup whose max or high rose is one event, with each rise",
  },
  {
    name: "the cgroups at their limits are not recorded",
    file: "packages/machine/manager.ts",
    from: "        ? limitEvents(limitsBefore, result.sample)\n",
    to: "        ? []\n",
    command: unit,
    expect:
      "a sample after one whose observer's max was lower records it at its limit",
  },
  {
    name: "the numbers in force leave out the overdue bound's constant",
    file: "packages/machine/measurements.ts",
    from: "    READING_OVERDUE_AFTER_TICKS,\n    readingOverdueAfterTicks:",
    to: "    readingOverdueAfterTicks:",
    command: unit,
    expect:
      "the numbers in force name the overdue bound's constant and the bound a host set",
  },
  // ── what the Machine page reads ──
  {
    name: "a lane's snapshots count every row, not only those kept",
    file: "packages/machine/snapshot-index.ts",
    from: '    if (r.state !== "kept") continue\n',
    to: "",
    command: unit,
    expect: "a lane's snapshots are its kept rows alone",
  },
  {
    name: "the events a sample saw are not recorded",
    file: "packages/machine/manager.ts",
    from: "    if (events.length > 0) record(() => deps.measurements.recordEvents(events))\n",
    to: "",
    command: unit,
    expect:
      "a lane's OOM kill, a service's and the host's stall are each recorded once",
  },
  {
    name: "the latest reading keeps the first sample, not the last",
    file: "packages/machine/manager.ts",
    from: 'const sampled = result.kind === "sampled" ? result.sample : lastRead?.sample',
    to: 'const sampled = lastRead?.sample ?? (result.kind === "sampled" ? result.sample : undefined)',
    command: unit,
    expect:
      "the latest reading is none before a sample, then the last sample with what was planned from it",
  },
  {
    name: "a retry is taken from any state",
    file: "packages/machine/repair.ts",
    from: 'return state.kind === "failed"\n        ? { kind: "detected", trigger: "asked-again" }',
    to: 'return state.kind !== "booting-repair"\n        ? { kind: "detected", trigger: "asked-again" }',
    command: unit,
    expect: "a retry asked moves only a failure",
  },
  {
    name: "any trigger leaves a failure",
    file: "packages/machine/repair.ts",
    from: "event.plannedSize <= state.sizeAtFailure",
    to: "event.plannedSize < 0",
    command: unit,
    expect:
      "a trigger leaves a failure only when the disk could grow past its size then",
  },
  {
    name: "a repair that gained a byte is done",
    file: "packages/machine/repair.ts",
    from: "  outcome.leftUnallocated >= ROOM_SPENT_CLEAR\n",
    to: "  outcome.leftUnallocated > 0\n",
    command: unit,
    expect: "a repair is done only if what it left is no longer spent",
  },
  {
    name: "a repair is called for with nothing to delete alone",
    file: "packages/machine/repair.ts",
    from: "store !== null && sample.upkeep.exhausted && store.unallocated < ROOM_SPENT",
    to: "store !== null && sample.upkeep.exhausted",
    command: unit,
    expect: "only with nothing left to delete and the room spent",
  },
  {
    name: "any held repair lock is a repair",
    file: "packages/machine/repair.ts",
    from: `  facts.lockHeld &&
  facts.state !== "interrupted" &&
  RUNNING.has(facts.state.kind)`,
    to: "  facts.lockHeld",
    command: unit,
    expect:
      "a held lock is a repair only with a running state: else a VM's start",
  },
  {
    name: "a repair is asked from this host's memory, not the shared state",
    file: "packages/machine/manager.ts",
    from: "nextRepairState(repairStateNow(facts), asked)",
    to: 'nextRepairState({ kind: "idle" }, asked)',
    command: unit,
    expect:
      "another host's recorded failure stops this host's repair, until the disk could grow",
  },
  {
    name: "a repair is awaited inside a sample",
    file: "packages/machine/manager.ts",
    from: "    void askRepair(\n",
    to: "    await askRepair(\n",
    command: unit,
    expect:
      "a sample with the room spent and nothing to delete repairs, beside the loop, once",
  },
  {
    name: "a repair in flight is asked again",
    file: "packages/machine/manager.ts",
    from: "    if (repairInFlight !== null || isRepairRunning(facts)) return\n",
    to: "    if (isRepairRunning(facts)) return\n",
    command: unit,
    expect:
      "a sample taken before the repair has written its state asks for no second",
  },
  {
    name: "a repair runs the lanes as they were",
    file: "packages/machine/manager.ts",
    from: '    const repairing = deps.mode === "manage" && isRepairRunning(facts)\n',
    to: "    const repairing = false\n",
    command: unit,
    expect:
      "another host's repair holds this host's lanes, and its VM start does not",
  },
  {
    name: "a repair boot not ready still stops the VM",
    file: "packages/machine/repair-steps.ts",
    from: `      if (missing !== null)
        throw new Error(\`the repair boot could not be made ready: \${missing}\`)
`,
    to: "",
    command: unit,
    expect: "a repair boot not ready fails it without stopping the VM",
  },
  {
    name: "a measurement not written is not told",
    file: "packages/machine/manager.ts",
    from: '      tell({ kind: "unmeasured", error: errorText(error) })\n',
    to: "",
    command: unit,
    expect:
      "a measurement that cannot be written is told, and the sample goes on",
  },
  {
    name: "the lanes are ranked at every sample",
    file: "packages/machine/treatments.ts",
    from: "  rung >= 2 || state.startsHeld.length > 0 ||",
    to: "  rung >= 0 || state.startsHeld.length > 0 ||",
    command: unit,
    expect:
      "the lanes are ranked only once memory is short enough for their order to decide",
  },
  {
    name: "a prefix's option value is taken for the program",
    file: "packages/machine/measurements.ts",
    from: "      else if (afterPrefix && OPTIONS_WITH_VALUES.has(word)) at++\n",
    to: "",
    command: unit,
    expect:
      "commandProgram skips cd, export, assignments, env and time to the program",
  },
  {
    name: "the measurements are never trimmed in observe mode",
    file: "packages/machine/manager.ts",
    from: "      if (measured.trim) deps.measurements.trim()\n",
    to: '      if (measured.trim && deps.mode === "manage")\n        deps.measurements.trim()\n',
    command: unit,
    expect:
      "every sample is measured, and they are trimmed every TRIM_MEASUREMENTS_EVERY_SAMPLES samples",
  },
  {
    name: "an unseen lane at rung 2 may start",
    file: "packages/machine/treatments.ts",
    from: "        : rung >= 2 || startsHeld.length > 0\n",
    to: "        : startsHeld.length > 0\n",
    command: unit,
    expect:
      "every lane has a treatment, and one not running is waiting-to-start from rung 2",
  },
  {
    name: "every held start is let go at once",
    file: "packages/machine/treatments.ts",
    from: "  const release = rung < 2 ? held.slice(0, 1) : []\n",
    to: "  const release = rung < 2 ? held : []\n",
    command: unit,
    expect:
      "as the rung falls, held starts are let go one a sample, most important first",
  },
  {
    name: "the lanes allowed to call do not fall while rung 3 holds",
    file: "packages/machine/treatments.ts",
    from: "        : Math.max(1, state.lanesAllowedToCall - 1)\n",
    to: "        : state.lanesAllowedToCall\n",
    command: unit,
    expect:
      "at rung 3 the most important lanes are never paused, their count falling while it holds, never below 1, and rising below it",
  },
  {
    name: "a shadow squeeze is planned at rung 0",
    file: "packages/machine/treatments.ts",
    from: "    if (rung >= 1 && programInFlight === null)\n",
    to: "    if (rung >= 0 && programInFlight === null)\n",
    command: unit,
    expect:
      "shadow decisions: a squeeze from rung 1, a freeze from rung 4, a kill at rung 5, none at rung 0",
  },
  {
    name: "a wait for the machine ignores its signal",
    file: "packages/machine/manager.ts",
    from: '        signal?.addEventListener("abort", onAbort, { once: true })\n',
    to: "",
    command: unit,
    expect:
      "a start waiting is among the lanes waiting to start, and leaves them on its abort",
  },
  {
    name: "treatments are planned over the lanes whose cgroups were read",
    file: "packages/machine/manager.ts",
    from: "      lanesRunning: sample.lanesRunning.map(lane => ({\n",
    to: "      lanesRunning: sample.lanes.map(({ lane }) => ({\n",
    command: unit,
    expect:
      "a running lane whose cgroup was not read may still call from rung 2",
  },
  {
    name: "close leaves a waiter waiting",
    file: "packages/machine/manager.ts",
    from: "      for (const w of waiters) w.refuse(new KeeperClosed())\n",
    to: "",
    command: unit,
    expect: "close refuses every waiter",
  },
  {
    name: "a rung is cleared while one of its bounds is still entered",
    file: "packages/machine/rung.ts",
    from: '  if (readings.every(r => r === "clear")) return { kind: "clear" }\n',
    to: '  if (readings.includes("clear")) return { kind: "clear" }\n',
    command: unit,
    expect:
      "a rung with both kinds of bound is cleared only when both are clear",
  },
  {
    name: "the rung jumps to its target",
    file: "packages/machine/rung.ts",
    from: "  const rung = RUNGS[state.rung + step] ?? state.rung\n",
    to: "  const rung = RUNGS[highest ?? 0] ?? state.rung\n",
    command: unit,
    expect: "the rung moves one step a sample",
  },
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
    file: "packages/machine/hysteresis.ts",
    from: "    const count = (was?.count ?? 0) + 1\n",
    to: "    const count = (was?.count ?? 0) + ENTER_AFTER\n",
    command: unit,
    expect: "is active only after ENTER_AFTER readings over in a row",
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
    from: "      writeHealth(STOPPED, { ...memory, health: STOPPED })\n",
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
    from: "      skipped -= result.sample.snapshotsSkipped\n",
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
  // ── the gate never deadlocks the host ──
  {
    name: "a sample waits for its health's write",
    file: "packages/machine/manager.ts",
    from: "    writeHealth(planned.health, planned.state)\n    if (!planned.changed) return\n",
    to: "    writeHealth(planned.health, planned.state)\n    await sink.writesFlushed()\n    if (!planned.changed) return\n",
    command: unit,
    expect: "a sample never waits on a documents step that waits at the gate",
  },
  {
    name: "a stale sample's end plans as a fresh one's",
    file: "packages/machine/manager.ts",
    from: "    if (!judged.isFresh) {\n",
    to: "    if (judged.isFresh && !judged.isFresh) {\n",
    command: unit,
    expect:
      "a sample that hung holds nothing when it ends, and the next plans as usual",
  },
  {
    name: "a sample started before the overdue tick is judged fresh",
    file: "packages/machine/freshness.ts",
    from: "startedAt < state.overdueAt)",
    to: "startedAt < 0)",
    command: unit,
    expect:
      "a sample started before the overdue tick is stale, and one started at it or after is fresh",
  },
  {
    name: "the tick count never reaches its bound",
    file: "packages/machine/freshness.ts",
    from: "overdueAt: since >= bound ? ticks : null",
    to: "overdueAt: null",
    command: unit,
    expect: "a reading no sample replaces lets every hold go, and says so",
  },
  {
    name: "an overdue reading keeps its waiters waiting",
    file: "packages/machine/manager.ts",
    from: "    for (const w of waiters) w.allow()\n",
    to: "",
    command: unit,
    expect: "a reading no sample replaces lets every hold go, and says so",
  },
  {
    name: "the overdue write bypasses the health's memory",
    file: "packages/machine/manager.ts",
    from: "    writeHealth(planned.health, planned.state)\n    if (planned.changed) tell",
    to: "    sink.write(planned.health)\n    if (planned.changed) tell",
    command: unit,
    expect:
      "after an overdue health, a fresh sample writes its health though it is the one from before",
  },
  {
    name: "close waits for a running sample",
    file: "packages/machine/manager.ts",
    from: "      await upkeepRunning\n",
    to: "      await keeper.idle()\n",
    command: unit,
    expect:
      "close returns with a sample that never ends, whose end then changes nothing",
  },
  {
    name: "close does not wait for its last write",
    file: "packages/machine/manager.ts",
    from: "      await sink.writesFlushed()\n    },\n",
    to: "    },\n",
    command: unit,
    expect: "close waits for its last write to land",
  },
  {
    name: "the check of a lane's activity ignores its treatment",
    file: "packages/machine/manager.ts",
    from: "    isOverdue(freshness) ||\n    isActivityAllowed(treatments.laneTreatment(lane), activity)\n",
    to: "    isOverdue(freshness)\n",
    command: unit,
    expect: "isLaneActivityAllowed answers as waitUntilAllowed settles",
  },
]
