// pi/manifest — a package's `package.json`, or a Claude plugin's
// `plugin.json`, read for its name and version.

import { readFile } from "node:fs/promises"

export interface Manifest {
  readonly name: string | null
  readonly version: string | null
}

/** `file`'s name and version, each null when absent; both null when the file cannot be read or parsed. */
export async function readManifest(file: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      readonly name?: unknown
      readonly version?: unknown
    }
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      version: typeof parsed.version === "string" ? parsed.version : null,
    }
  } catch {
    return { name: null, version: null }
  }
}
