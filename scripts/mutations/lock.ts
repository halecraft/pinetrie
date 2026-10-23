// Mutations for @pinetrie/lock. Run: pnpm mutate scripts/mutations/lock.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lock"]
const lock = "packages/lock/lock.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "heldWhile's end leaves the child holding the lock",
    file: lock,
    from: '    options.heldWhile.once("end", end)\n    options.heldWhile.once("close", end)\n',
    to: "",
    command: unit,
    expect: "a holder whose input ends exits, and frees the lock",
  },
  {
    name: "holdOutcome reads flock's exit 1 as held",
    file: lock,
    from: '  return heard.exit === 1 && heard.said === "" ? "held-by-another" : "failed"',
    to: '  return heard.exit === 1 && heard.said === "" ? "held" : "failed"',
    command: unit,
    expect: '"", exit 1, is held-by-another',
  },
  {
    name: "the lock's child runs in its holder's process group",
    file: lock,
    from: "    detached: true,\n",
    to: "    detached: false,\n",
    command: unit,
    expect: "a Ctrl-C to its holder's process group leaves the lock held",
  },
  {
    name: "a waiter never says whom it waits for",
    file: lock,
    from: "        if (!waited) onWaiting()\n",
    to: "",
    command: unit,
    expect: "a waiter hears once whom it waits for",
  },
  {
    name: "withLock keeps the lock when its work throws",
    file: lock,
    from: "  } finally {\n    await held.release()\n  }\n",
    to: "  } finally {\n  }\n",
    command: unit,
    expect: "withLock releases the lock when its work throws",
  },
  {
    name: "perl's waiting hold does not wait",
    file: lock,
    from: "  flock($h, LOCK_EX) or do",
    to: "  flock($h, LOCK_EX | LOCK_NB) or do",
    command: unit,
    expect: "a waiter hears once whom it waits for",
  },
  {
    name: "removeLockFile removes another file",
    file: lock,
    from: "  await rm(held.file, { force: true })\n",
    to: "  await rm(`${held.file}.other`, { force: true })\n",
    command: unit,
    expect: "removeLockFile removes its own file, and frees the lock",
  },
  {
    name: "the lock's child holds it past its holder",
    file: lock,
    from: "\nexec cat`",
    to: "\nexec sleep 999999`",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a disks server killed with SIGKILL frees its project's lock: its host's next call takes it back",
  },
]
