// web/stamp — what a build of the page read, by content: `dist/inputs.json`,
// written by the page's Vite config and read by a host that serves the
// build, which rebuilds when any input has changed. Node only.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

/** A build's inputs, each by its SHA-256, and the mode it was built in. */
export interface PageStamp {
  readonly mode: string
  readonly files: Readonly<Record<string, string>>
}

export const STAMP_FILE = "inputs.json"

const hashFile = (file: string): string | null => {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex")
  } catch {
    return null
  }
}

/** The stamp of a build that read `files` in `mode`. A file it cannot read is left out. */
export function stampInputs(files: readonly string[], mode: string): PageStamp {
  const hashed: Record<string, string> = {}
  for (const f of files) {
    const h = hashFile(f)
    if (h !== null) hashed[f] = h
  }
  return { mode, files: hashed }
}

/**
 * Whether a build stamped `stamp` is still the page for `mode`: every input
 * there, with the hash it had. A jj checkout rewrites mtimes, so only the
 * content says. A new file nothing imported yet cannot change the page
 * until an import of it changes a listed file.
 */
export function isStampFresh(stamp: PageStamp, mode: string): boolean {
  if (stamp.mode !== mode) return false
  for (const [file, hash] of Object.entries(stamp.files))
    if (hashFile(file) !== hash) return false
  return true
}
