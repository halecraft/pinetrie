// vm/apk — files out of an Alpine package, and the kernel out of its EFI
// zboot, in Node alone: the Mac's build and a Linux lane's observer suite
// both take the kernel this way. `image/build.sh` unpacks the same zboot
// in the guest, in shell, on purpose: the image's build stays
// self-contained, and `imageKey` covers it.

import { readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import {
  ensurePinned,
  type FetchBytes,
  fetchBytes,
  type Pin,
} from "./pinned.ts"

const BLOCK = 512

const text = (b: Uint8Array): string =>
  Buffer.from(b).toString("utf8").replace(/\0.*$/s, "")

const NO_PAX = { path: null, linkpath: null }

/** A pax header's record `key`, or null. */
const paxRecord = (body: Uint8Array, key: string): string | null =>
  new RegExp(`\\d+ ${key}=([^\\n]*)\\n`).exec(text(body))?.[1] ?? null

/** One entry of a tar a package's files are written from. */
export type TarEntry =
  | {
      readonly kind: "file"
      readonly name: string
      readonly mode: number
      readonly body: Uint8Array
    }
  | { readonly kind: "symlink"; readonly name: string; readonly target: string }

/**
 * Every regular file and symlink of a ustar archive, in its order. A pax
 * header's `path` names the entry after it, as apk-tools writes long
 * names; a pax `linkpath` its target.
 */
export function tarEntries(tar: Uint8Array): readonly TarEntry[] {
  const entries: TarEntry[] = []
  let pax: { path: string | null; linkpath: string | null } = NO_PAX
  for (let off = 0; off + BLOCK <= tar.length; ) {
    const h = tar.subarray(off, off + BLOCK)
    if (h.every(b => b === 0)) {
      off += BLOCK
      continue
    }
    const size = Number.parseInt(text(h.subarray(124, 136)).trim() || "0", 8)
    const type = String.fromCharCode(h[156] ?? 0)
    const body = tar.subarray(off + BLOCK, off + BLOCK + size)
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    if (type === "x") {
      pax = {
        path: paxRecord(body, "path"),
        linkpath: paxRecord(body, "linkpath"),
      }
      continue
    }
    const prefix = text(h.subarray(345, 500))
    const name =
      pax.path ??
      (prefix === ""
        ? text(h.subarray(0, 100))
        : `${prefix}/${text(h.subarray(0, 100))}`)
    const target = pax.linkpath ?? text(h.subarray(157, 257))
    pax = NO_PAX
    const mode = Number.parseInt(text(h.subarray(100, 108)).trim() || "0", 8)
    if (type === "0" || type === "\0")
      entries.push({ kind: "file", name, mode, body })
    else if (type === "2") entries.push({ kind: "symlink", name, target })
  }
  return entries
}

/**
 * The regular files named in `names`, out of a ustar archive, by name. A
 * name not in the archive is absent from the result.
 */
export function tarFiles(
  tar: Uint8Array,
  names: readonly string[],
): ReadonlyMap<string, Uint8Array> {
  const wanted = new Set(names)
  const found = new Map<string, Uint8Array>()
  for (const e of tarEntries(tar))
    if (e.kind === "file" && wanted.has(e.name)) found.set(e.name, e.body)
  return found
}

/**
 * Files out of an apk: its gzip streams (signature, control, data) read as
 * one tar, as `gunzipSync` reads concatenated members.
 */
export const apkFiles = (
  apk: Uint8Array,
  names: readonly string[],
): ReadonlyMap<string, Uint8Array> => tarFiles(gunzipSync(apk), names)

/**
 * An apk's package files and symlinks: apk-tools' own entries (its
 * signature, `.PKGINFO`, the install scripts) left out.
 */
export const apkEntries = (apk: Uint8Array): readonly TarEntry[] =>
  tarEntries(gunzipSync(apk)).filter(e => !e.name.startsWith("."))

/**
 * The arm64 `Image` Virtualization and QEMU boot, out of an EFI zboot
 * `vmlinuz`: its header names the gzip payload's offset (at 8) and size
 * (at 12).
 */
export function zbootImage(vmlinuz: Uint8Array): Uint8Array {
  const b = Buffer.from(vmlinuz)
  if (b.subarray(4, 8).toString() !== "zimg")
    throw new Error("the kernel is not an EFI zboot image")
  if (text(b.subarray(24, 32)) !== "gzip")
    throw new Error("the kernel's zboot payload is not gzip")
  const offset = b.readUInt32LE(8)
  const image = gunzipSync(b.subarray(offset, offset + b.readUInt32LE(12)))
  if (image.subarray(56, 60).toString() !== "ARMd")
    throw new Error("the unpacked kernel is not an arm64 Image")
  return image
}

export const KERNEL_ENTRY = "boot/vmlinuz-virt"

/** The unpacked kernel's name beside its apk, by the pin's hash. */
export const kernelImageName = (pin: Pin): string =>
  `Image-${pin.sha256.slice(0, 16)}`

/**
 * The kernel `pin` names, unpacked, in `dir`: the apk is fetched once and
 * checked, and the `Image` beside it, named by the pin's hash, written once.
 */
export async function pinnedKernel(
  dir: string,
  pin: Pin,
  fetch: FetchBytes = fetchBytes,
): Promise<string> {
  const image = path.join(dir, kernelImageName(pin))
  if (
    await stat(image).then(
      () => true,
      () => false,
    )
  )
    return image
  const apk = await readFile(
    await ensurePinned(path.join(dir, path.basename(pin.url)), pin, fetch),
  )
  const vmlinuz = apkFiles(apk, [KERNEL_ENTRY]).get(KERNEL_ENTRY)
  if (vmlinuz === undefined)
    throw new Error(`${path.basename(pin.url)} holds no ${KERNEL_ENTRY}`)
  const scratch = `${image}.tmp-${process.pid}`
  try {
    await writeFile(scratch, zbootImage(vmlinuz))
    await rename(scratch, image)
  } finally {
    await rm(scratch, { force: true })
  }
  return image
}
