// Mutations for the column reducer. Run: pnpm mutate scripts/mutations/client.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/client"]
const file = "packages/client/columns.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "sync re-pins every column to the newest leaf",
    file: file,
    from: "  const tip = followTip(index, column.anchor)",
    to: "  const tip = followTip(index, null)",
    command: unit,
    expect: "never re-pins it",
  },
  {
    name: "a fresh column takes the newest child of its anchor",
    file: file,
    from: "      fresh.sendId === undefined ? undefined : index.bySend.get(fresh.sendId)",
    to: '      (index.childrenOf.get(column.anchor ?? "") ?? []).at(-1)',
    command: unit,
    expect: "whatever came first",
  },
  {
    name: "open appends at the far right",
    file: file,
    from: "        { after: action.after },",
    to: "        { end: true },",
    command: unit,
    expect: "open inserts next to",
  },
  {
    name: "sync does not advance a column to its tip",
    file: file,
    from: "  if (tip === column.anchor && bound === undefined) return column",
    to: "  if (true) return column",
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
  {
    name: "a renamed writer shows only the name they sent under",
    file: "packages/client/names.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  return now === undefined || now === asSent ? asSent : `${now} (${asSent})`",
    to: "  return asSent",
    command: unit,
    expect: "renamed since",
  },
  {
    name: "sync never binds a column to its lane",
    file: file,
    from: "  const bound = ending.length === 1 ? ending[0]?.name : undefined",
    to: "  const bound = ending.length < 0 ? ending[0]?.name : undefined",
    command: unit,
    expect: "binds to the one lane",
  },
  {
    name: "a column binds to the first of two lanes at its tip",
    file: file,
    from: "  const bound = ending.length === 1 ? ending[0]?.name : undefined",
    to: "  const bound = ending.length >= 1 ? ending[0]?.name : undefined",
    command: unit,
    expect: "no binding while two lanes",
  },
  {
    name: "a bound column follows the newest leaf",
    file: file,
    from: "  if (lane !== undefined) {",
    to: "  if (lane !== undefined && lane === null) {",
    command: unit,
    expect: "follows the lane past a newer fork",
  },
  {
    name: "a column opened to send drops its message",
    file: file,
    from: "        fresh: action.text === undefined ? {} : { pending: action.text },",
    to: "        fresh: {},",
    command: unit,
    expect: "holds it until its send",
  },
  {
    name: "a column keeps its pending message after sending it",
    file: file,
    from: "          ? { ...c, fresh: { sendId: action.sendId } }",
    to: "          ? { ...c, fresh: { ...c.fresh, sendId: action.sendId } }",
    command: unit,
    expect: "holds it until its send",
  },
  {
    name: "everyone present has the first colour",
    file: "packages/client/presence.tsx",
    from: "    return (i === undefined ? undefined : FIRST[i]) ?? hashed(writer)",
    to: "    return (i === undefined ? undefined : FIRST[0]) ?? hashed(writer)",
    command: unit,
    expect: "each have their own colour",
  },
]
