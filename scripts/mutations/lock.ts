// Mutations for @pinetrie/lock. Run: pnpm mutate scripts/mutations/lock.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lock"]

export const mutations: readonly Mutation[] = [
  {
    name: "until's end leaves the child holding the lock",
    file: "packages/lock/lock.ts",
    from: '  options.until.once("end", end)\n  options.until.once("close", end)\n',
    to: "",
    command: unit,
    expect: "a holder whose input ends exits, and frees the lock",
  },
  {
    name: "holdOutcome reads flock's exit 1 as held",
    file: "packages/lock/lock.ts",
    from: '  return heard.exit === 1 && heard.said === "" ? "held-by-another" : "failed"',
    to: '  return heard.exit === 1 && heard.said === "" ? "held" : "failed"',
    command: unit,
    expect: '"", exit 1, is held-by-another',
  },
  {
    name: "the lock's child holds it past its holder",
    file: "packages/lock/lock.ts",
    from: '"echo held; exec cat"',
    to: '"echo held; exec sleep 999999"',
    suite: "lanes",
    scenario: "contract",
    expect:
      "a disks server killed with SIGKILL frees its project's lock: its host's next call takes it back",
  },
]
