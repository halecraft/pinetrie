// Mutations for @pineta/keeper. Run: pnpm mutate scripts/mutations/keeper.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/keeper"]
const file = "packages/keeper/index.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "a closed keeper still runs new steps",
    file,
    from: "    if (closed) return refused()",
    to: "    if (false) return refused()",
    command: unit,
    expect: "a closed keeper refuses a new step",
  },
  {
    name: "a failed step stops the keeper",
    file,
    from: "          next.done.reject(error)\n          finish()\n",
    to: "          next.done.reject(error)\n",
    command: unit,
    expect: "a step runs after a failed one",
  },
  {
    name: "idle does not wait for tracked work",
    file,
    from: "        upkeep.length > 0 ||\n        tracked.size > 0\n",
    to: "        upkeep.length > 0\n",
    command: unit,
    expect: "idle waits for a step queued while it waits, and for tracked work",
  },
  {
    name: "upkeep goes before the commands waiting",
    file,
    from: "      const next = waiting.shift() ?? upkeep.shift()",
    to: "      const next = upkeep.shift() ?? waiting.shift()",
    command: unit,
    expect:
      "a run queued after three later steps runs before the two not yet started",
  },
  {
    name: "a keyed step merges nothing",
    file,
    from: "    if (covering !== undefined) return covering.done.promise\n",
    to: "",
    command: unit,
    expect: "later with one key, called five times while queued, runs once",
  },
  {
    name: "a started later step still covers its key",
    file,
    from: "        if (laterQueued.get(next.key) === next) laterQueued.delete(next.key)\n",
    to: "",
    command: unit,
    expect: "called while running, runs once more",
  },
  {
    name: "a step is chosen as it is queued, not after the turn",
    file,
    from: "    queueMicrotask(() => {",
    to: "    ;(go => go())(() => {",
    command: unit,
    expect: "a later step queued before a once step still runs after it",
  },
  {
    name: "a voided failed step is unhandled",
    file,
    from: "    done.promise.catch(error => options.onError?.(error))\n",
    to: "",
    command: unit,
    expect: "raises no unhandled rejection",
  },
  {
    name: "a step that ran long is not reported",
    file,
    from: "        if (ran > slowMs || (!isUpkeep && waited > slowMs))",
    to: "        if (!isUpkeep && waited > slowMs)",
    command: unit,
    expect: "a step that waited or ran past slowMs is reported",
  },
  {
    name: "upkeep that waited is reported as slow",
    file,
    from: "        if (ran > slowMs || (!isUpkeep && waited > slowMs))",
    to: "        if (ran > slowMs || waited > slowMs)",
    command: unit,
    expect:
      "an upkeep step that only waited is not reported; one that ran long is",
  },
  {
    name: "a command that waited is not reported",
    file,
    from: "        if (ran > slowMs || (!isUpkeep && waited > slowMs))",
    to: "        if (ran > slowMs)",
    command: unit,
    expect: "a step that waited or ran past slowMs is reported",
  },
]
