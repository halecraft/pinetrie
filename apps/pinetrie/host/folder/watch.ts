// host/folder/watch — the project's folder watched: once nothing has changed for a
// quiet window, a change to a source path reads the project's folder (`line.ts`); a
// change only ignored paths saw (a build, an install) reads nothing. A
// dropped-events error reads at once: what changed is found by the read's
// own scan.

import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  type IgnoreFile,
  ignoreDirs,
  ignoredPaths,
} from "@pinetrie/rules/ignores"
import { watchDir } from "../watch-dir.ts"

/** How long the project's folder stays quiet before a change to it is read: a burst of saves is one read. */
export const FOLDER_QUIET_MS = 10_000

/**
 * Whether any of `paths` (from the folder's root) is a source path: one
 * neither `own` nor the `.gitignore` files on its way ignore. A path's
 * own kind is not known once it is gone, so each is read as a file; its
 * directories are read as directories.
 */
export const isSourceChange = (input: {
  readonly paths: readonly string[]
  readonly files: readonly IgnoreFile[]
  readonly own: string
}): boolean =>
  ignoredPaths({ ...input, dirs: new Set() }).size < input.paths.length

/** The project's folder watched until closed: `read` after each quiet window that saw a source path change. */
export async function watchFolder(deps: {
  readonly root: string
  readonly own: () => string
  readonly read: () => void
  readonly failed: (error: unknown) => void
  readonly quietMs?: number
}): Promise<{ close(): Promise<void> }> {
  const sub = await watchDir({
    dir: deps.root,
    quietMs: deps.quietMs ?? FOLDER_QUIET_MS,
    onChange: change => {
      if (change.kind === "dropped") return deps.read()
      void (async () => {
        // gather
        const paths = change.events
          .map(e => path.relative(deps.root, e.path).split(path.sep).join("/"))
          .filter(p => p !== "" && !p.startsWith(".."))
        const files = (
          await Promise.all(
            ignoreDirs(paths).map(async dir => {
              const text = await readFile(
                path.join(deps.root, dir, ".gitignore"),
                "utf8",
              ).catch(() => null)
              return text === null ? [] : [{ dir, text }]
            }),
          )
        ).flat()
        // plan, then execute
        if (isSourceChange({ paths, files, own: deps.own() })) deps.read()
      })().catch(deps.failed)
    },
  })
  return { close: () => sub.unsubscribe() }
}
