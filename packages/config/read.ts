// config/read — the package's only I/O: reading a layer's file. The project's
// copies are read by lane work, which knows which copy is which; this reads
// the layers that do not change while the host runs.

import { readFile } from "node:fs/promises"
import {
  type DecodedLayer,
  decodeEnv,
  decodeLayer,
  type FileRead,
} from "./decode.ts"
import type { ConfigPlaces } from "./places.ts"
import type { AnySetting } from "./setting.ts"

const isMissing = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR")

/** A file's text. Only a file that does not exist is `missing`. */
export async function readConfigFile(file: string): Promise<FileRead> {
  try {
    return { kind: "text", text: await readFile(file, "utf8") }
  } catch (error) {
    return isMissing(error)
      ? { kind: "missing" }
      : {
          kind: "unreadable",
          reason: error instanceof Error ? error.message : String(error),
        }
  }
}

/** The layers read once, at the host's start. */
export interface StartLayers<Table> {
  readonly system: DecodedLayer<Table, "system"> | null
  readonly user: DecodedLayer<Table, "user">
  readonly local: DecodedLayer<Table, "local"> | null
  readonly env: DecodedLayer<Table, "env">
}

/**
 * The first system candidate that exists, the person's file, their file for
 * this project, and the variables `table` names.
 */
export async function readStartLayers<
  Table extends { readonly [key: string]: AnySetting },
>(
  table: Table,
  places: ConfigPlaces,
  env: Readonly<Record<string, string | undefined>>,
): Promise<StartLayers<Table>> {
  let system: DecodedLayer<Table, "system"> | null = null
  for (const file of places.systemCandidates) {
    const read = await readConfigFile(file)
    if (read.kind === "missing") continue
    system = decodeLayer(table, "system", file, read)
    break
  }
  return {
    system,
    user: decodeLayer(
      table,
      "user",
      places.user,
      await readConfigFile(places.user),
    ),
    local:
      places.local === null
        ? null
        : decodeLayer(
            table,
            "local",
            places.local,
            await readConfigFile(places.local),
          ),
    env: decodeEnv(table, env),
  }
}
