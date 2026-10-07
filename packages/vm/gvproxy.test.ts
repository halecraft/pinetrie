import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { ensureGvproxy, gvproxyPath, readGvproxyPin } from "./gvproxy.ts"

const bytes = new TextEncoder().encode("gvproxy")
/** A pin whose hash is that of `bytes`. */
const pinOf = async () => ({
  ...(await readGvproxyPin()),
  sha256: createHash("sha256").update(bytes).digest("hex"),
})

test("the pin names a release and a SHA-256", async () => {
  const pin = await readGvproxyPin()
  expect(pin.url).toContain(`/releases/download/${pin.version}/gvproxy-darwin`)
  expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
})

test("a fetch whose hash is not the pin's is refused, and nothing is kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-gv-"))
  try {
    const pin = await readGvproxyPin()
    await expect(ensureGvproxy(dir, pin, async () => bytes)).rejects.toThrow(
      `not the pinned ${pin.sha256}`,
    )
    await expect(readFile(gvproxyPath(dir, pin))).rejects.toThrow()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a fetch with the pin's hash is kept, and used again without a fetch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-gv-"))
  try {
    const pin = await pinOf()
    const fetched = vi.fn(async () => bytes)
    const first = await ensureGvproxy(dir, pin, fetched)
    expect(await readFile(first)).toEqual(Buffer.from(bytes))
    expect(await ensureGvproxy(dir, pin, fetched)).toBe(first)
    expect(fetched).toHaveBeenCalledTimes(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
