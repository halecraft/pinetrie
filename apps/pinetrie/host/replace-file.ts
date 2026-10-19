// host/replace-file — a file of the host's own written whole.

import { renameSync, writeFileSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"

/**
 * Write `text` to `file` through `<file>.tmp`, renamed over it: a reader
 * finds the old file or the new one, never half of either. Two writers of
 * one file at once share the temporary file, so a caller writes one at a
 * time.
 */
export async function replaceFile(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}

/** `replaceFile`, done before it returns: for a write the process may exit straight after. */
export function replaceFileSync(file: string, text: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}
