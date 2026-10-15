// host/project — the project's adapter, chosen once, by its kind: the one
// place that chooses it, and the one that refuses a project lanes cannot
// serve. Lane work takes the adapter as a value (`work/adapter.ts`), which
// carries its kind: what each new lane's history is, and what a lane must
// keep to run.

import { assertNever } from "@pinetrie/core"
import { type ProjectDir, projectDirWords } from "@pinetrie/lanes"
import { startFolderProject } from "./folder/index.ts"
import { startJjProject } from "./jj/index.ts"
import type { ProjectAdapter } from "./work/adapter.ts"

/** The adapter of the project `dir` names, or why it has none. */
export function projectAdapter(
  dir: ProjectDir,
):
  | { readonly adapter: ProjectAdapter; readonly root: string }
  | { readonly refused: string } {
  switch (dir.kind) {
    case "jj":
      return { adapter: startJjProject(dir), root: dir.root }
    case "folder":
      return { adapter: startFolderProject(dir), root: dir.root }
    case "refused":
      return { refused: projectDirWords(dir.refusal) }
    default:
      return assertNever(dir)
  }
}
