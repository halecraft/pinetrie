// Mutations for the column reducer. Run: pnpm mutate scripts/mutations/client.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/client"]
const file = "packages/client/columns.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "sync re-pins a column that is already pinned",
    file,
    from: "    if (column.anchor === null) {\n      const pinned = followTip(index, null)",
    to: "    if (true) {\n      const pinned = followTip(index, null)",
    command: unit,
    expect: "pins a new session's first column once",
  },
  {
    name: "a fresh branch resolves to an excluded child",
    file,
    from: "        child => !excluded.has(child),",
    to: "        child => child !== undefined,",
    command: unit,
    expect: "resolves a fresh branch",
  },
  {
    name: "open appends at the far right",
    file,
    from: "      return insertAfter(state, action.after, {\n        key: action.key,\n        anchor: action.anchor,",
    to: "      return insertAfter(state, state.length, {\n        key: action.key,\n        anchor: action.anchor,",
    command: unit,
    expect: "open inserts next to",
  },
  {
    name: "sync does not advance a column to its tip",
    file,
    from: "    if (tip === null || tip === column.anchor) return column",
    to: "    if (true) return column",
    command: unit,
    expect: "follows a column's own tip",
  },
  {
    name: "closing the last column leaves none",
    file,
    from: "      return rest.length > 0 ? rest : initialColumns()",
    to: "      return rest",
    command: unit,
    expect: "close of the last column",
  },
]
