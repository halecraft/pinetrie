// Mutations for the host's own unit tests. Run: pnpm mutate scripts/mutations/host.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "apps/pineta/host"]

export const mutations: readonly Mutation[] = [
  {
    name: "a store does not own its file",
    file: "apps/pineta/host/store.ts",
    from: '    db.exec("PRAGMA locking_mode = EXCLUSIVE")',
    to: '    db.exec("PRAGMA locking_mode = NORMAL")',
    command: unit,
    expect: "a store owns its file",
  },
  {
    name: "no seat ever departs",
    file: "apps/pineta/host/lines.ts",
    from: "): string[] => [...open].filter(seat => !peers.has(seat))",
    to: "): string[] => [...open].filter(seat => !peers.has(seat) && false)",
    command: unit,
    expect: "departedSeats",
  },
  {
    name: "a client may write another's command Line",
    file: "apps/pineta/host/policy.ts",
    from: "    routeLine(docId, peer) === false",
    to: "    routeLine(docId, peer) === undefined",
    command: unit,
    expect: "its two ends only",
  },
]
