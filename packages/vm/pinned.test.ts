import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { ensureGvproxy, gvproxyPath, readGvproxyPin } from "./gvproxy.ts"
import { ensurePinned, sha256Hex } from "./pinned.ts"

const bytes = new TextEncoder().encode("pinned")
const pin = { version: "1", url: "https://x/f", sha256: sha256Hex(bytes) }

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
const tempDir = async () => {
  const d = await mkdtemp(path.join(tmpdir(), "pinetrie-pin-"))
  dirs.push(d)
  return d
}

test("a fetch whose hash is not the pin's is refused, and nothing is kept", async () => {
  const file = path.join(await tempDir(), "f")
  const other = { ...pin, sha256: sha256Hex("other") }
  await expect(ensurePinned(file, other, async () => bytes)).rejects.toThrow(
    `not the pinned ${other.sha256}`,
  )
  await expect(readFile(file)).rejects.toThrow()
})

test("a fetch with the pin's hash is kept, and used again without a fetch", async () => {
  const file = path.join(await tempDir(), "f")
  const fetched = vi.fn(async () => bytes)
  expect(await ensurePinned(file, pin, fetched)).toBe(file)
  expect(await readFile(file)).toEqual(Buffer.from(bytes))
  await ensurePinned(file, pin, fetched)
  expect(fetched).toHaveBeenCalledTimes(1)
})

test("a kept copy whose hash differs is fetched again", async () => {
  const file = path.join(await tempDir(), "f")
  await writeFile(file, "damaged")
  const fetched = vi.fn(async () => bytes)
  await ensurePinned(file, pin, fetched)
  expect(fetched).toHaveBeenCalledTimes(1)
  expect(await readFile(file)).toEqual(Buffer.from(bytes))
})

test("gvproxy's pin names a release and a SHA-256", async () => {
  const gv = await readGvproxyPin()
  expect(gv.url).toContain(`/releases/download/${gv.version}/gvproxy-darwin`)
  expect(gv.sha256).toMatch(/^[0-9a-f]{64}$/)
})

test("gvproxy is kept under bin/, named by its version, and executable", async () => {
  const dir = await tempDir()
  const gv = { ...(await readGvproxyPin()), sha256: sha256Hex(bytes) }
  const binary = await ensureGvproxy(dir, gv, async () => bytes)
  expect(binary).toBe(gvproxyPath(dir, gv))
  expect(path.basename(binary)).toContain(gv.version)
  expect((await stat(binary)).mode & 0o111).toBe(0o111)
})
