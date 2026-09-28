// Mutations for @pineta/workspaces. Run: pnpm mutate scripts/mutations/workspaces.ts
// Its tests run jj itself, in throwaway repos, in seconds.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/workspaces"]

export const mutations: readonly Mutation[] = [
  {
    name: "a home directory is initialized",
    file: "packages/workspaces/project.ts",
    from: "  if (unsafe(target, f.home))",
    to: "  if (false)",
    command: unit,
    expect: "a home directory that is a dotfiles repo is never initialized",
  },
  {
    name: "the immutable heads replace yours",
    file: "packages/workspaces/project.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  return now === "" ? PINETA_HEADS : `(${now}) | ${PINETA_HEADS}`',
    to: "  return PINETA_HEADS",
    command: unit,
    expect: "planImmutable: keeps your value",
  },
  {
    name: "a missing workspace is never added again",
    file: "packages/workspaces/workspace.ts",
    from: "  if (f.bookmark === null) return []",
    to: "  return []",
    command: unit,
    expect: "planEnsure: healthy gets the guard",
  },
  {
    name: "a turn that changed nothing is committed",
    file: "packages/workspaces/revisions.ts",
    from: '  if (empty.stdout.trim() === "true") return null',
    to: '  if (empty.stdout.trim() === "never") return null',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a landing's merge is left uncommitted",
    file: "packages/workspaces/merge.ts",
    from: '  const commit = await jj(workspace, ["commit", "-m", "land: your work"])',
    to: '  const commit = await jj(workspace, ["log", "-r", "@"])',
    command: unit,
    expect: "the whole life of a lane",
  },
]
