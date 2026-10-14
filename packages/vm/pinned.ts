// vm/pinned — a file fetched once from a URL and checked against the
// SHA-256 its pin names: gvproxy's release, and the kernel and root the
// image's build boots.

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** A file to fetch: what it is, where it is, and its hash. */
export interface Pin {
  readonly version: string
  readonly url: string
  readonly sha256: string
}

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex")

/** A fetch that answered with a status other than 200. */
export class FetchRefused extends Error {
  readonly url: string
  readonly status: number
  constructor(url: string, status: number) {
    super(`fetching ${url}: HTTP ${status}`)
    this.url = url
    this.status = status
  }
}

export type FetchBytes = (url: string) => Promise<Uint8Array>

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new FetchRefused(url, res.status)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * `pin`'s file at `file`, fetched unless a copy whose hash is the pin's is
 * there. A fetch whose hash differs is refused, naming both, and nothing is
 * kept. Written through a temporary name, so a reader never sees half.
 */
export async function ensurePinned(
  file: string,
  pin: Pin,
  fetch: FetchBytes = fetchBytes,
): Promise<string> {
  const have = await readFile(file).catch(() => null)
  if (have !== null && sha256Hex(have) === pin.sha256) return file
  const bytes = await fetch(pin.url)
  const got = sha256Hex(bytes)
  if (got !== pin.sha256)
    throw new Error(
      `${pin.url} has SHA-256 ${got}, not the pinned ${pin.sha256}`,
    )
  await mkdir(path.dirname(file), { recursive: true })
  const scratch = `${file}.tmp-${process.pid}`
  try {
    await writeFile(scratch, bytes)
    await rename(scratch, file)
  } finally {
    await rm(scratch, { force: true })
  }
  return file
}
