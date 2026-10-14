// vm/gvproxy — the lane VM's network stack: gvisor-tap-vsock's
// gvproxy, at the release `launcher/gvproxy.json` pins, fetched once into
// `<state dir>/bin/` and checked against its SHA-256 before it is used.

import { chmod, readFile } from "node:fs/promises"
import path from "node:path"
import {
  ensurePinned,
  type FetchBytes,
  fetchBytes,
  type Pin,
} from "./pinned.ts"

export type GvproxyPin = Pin

const PIN_FILE = path.join(import.meta.dirname, "launcher", "gvproxy.json")

export const readGvproxyPin = async (): Promise<GvproxyPin> =>
  JSON.parse(await readFile(PIN_FILE, "utf8")) as GvproxyPin

/** Where the pinned gvproxy is kept: named by its version and hash. */
export const gvproxyPath = (stateDir: string, pin: GvproxyPin): string =>
  path.join(
    stateDir,
    "bin",
    `gvproxy-${pin.version}-${pin.sha256.slice(0, 12)}`,
  )

/** `pin`'s gvproxy under `stateDir`, executable. */
export async function ensureGvproxy(
  stateDir: string,
  pin: GvproxyPin,
  fetch: FetchBytes = fetchBytes,
): Promise<string> {
  const binary = await ensurePinned(gvproxyPath(stateDir, pin), pin, fetch)
  await chmod(binary, 0o755)
  return binary
}
