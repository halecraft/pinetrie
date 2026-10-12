// vm/gvproxy — the lane VM's network stack: gvisor-tap-vsock's
// gvproxy, at the release `launcher/gvproxy.json` pins, fetched once into
// `<state dir>/bin/` and checked against its SHA-256 before it is used.

import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface GvproxyPin {
  readonly version: string
  readonly url: string
  readonly sha256: string
}

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

const sha256Of = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

/**
 * `pin`'s gvproxy under `stateDir`, fetched unless a copy whose hash is the
 * pin's is there. A fetch whose hash differs is refused, naming both.
 */
export async function ensureGvproxy(
  stateDir: string,
  pin: GvproxyPin,
  fetchBytes: (url: string) => Promise<Uint8Array> = defaultFetch,
): Promise<string> {
  const binary = gvproxyPath(stateDir, pin)
  const have = await readFile(binary).catch(() => null)
  if (have !== null && sha256Of(have) === pin.sha256) return binary
  const bytes = await fetchBytes(pin.url)
  const got = sha256Of(bytes)
  if (got !== pin.sha256)
    throw new Error(
      `gvproxy from ${pin.url} has SHA-256 ${got}, not the pinned ${pin.sha256}`,
    )
  await mkdir(path.dirname(binary), { recursive: true })
  const scratch = `${binary}.tmp-${process.pid}`
  try {
    await writeFile(scratch, bytes)
    await chmod(scratch, 0o755)
    await rename(scratch, binary)
  } finally {
    await rm(scratch, { force: true })
  }
  return binary
}

async function defaultFetch(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetching ${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
