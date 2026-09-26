// Mutations for the root's own tools. Run: pnpm mutate scripts/mutations/scripts.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "scripts/mutate.test.ts"]

export const mutations: readonly Mutation[] = [
  {
    name: "a timeout kills only the direct child",
    file: "scripts/mutate.ts",
    from: '        process.kill(-child.pid, "SIGKILL")',
    to: '        process.kill(child.pid, "SIGKILL")',
    command: unit,
    expect: "grandchildren too",
  },
]
