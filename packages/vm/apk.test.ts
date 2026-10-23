import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { describe, expect, test, vi } from "vitest"
import {
  apkEntries,
  apkFiles,
  KERNEL_ENTRY,
  pinnedKernel,
  tarEntries,
  tarFiles,
  zbootImage,
} from "./apk.ts"
import { sha256Hex } from "./pinned.ts"

/** One ustar entry: a 512-byte header, then the body padded to 512. */
function entry(
  name: string,
  body: string | Uint8Array,
  type = "0",
  extra: { readonly mode?: number; readonly target?: string } = {},
): Buffer {
  const data = Buffer.from(body)
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write(`${(extra.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100)
  if (extra.target !== undefined) h.write(extra.target, 157, 100)
  h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124)
  h.write(type, 156)
  h.write("ustar\0", 257)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([h, data, pad])
}

const paxRecord = (p: string) => {
  const rest = ` path=${p}\n`
  let n = rest.length + 2
  if (`${n}${rest}`.length !== n) n += 1
  return `${n}${rest}`
}

/** An arm64 `Image` stand-in: `ARMd` at 56. */
const fakeImage = () => {
  const b = Buffer.alloc(128)
  b.write("ARMd", 56)
  return b
}

/** An EFI zboot around `image`: `zimg`, the payload's offset and size, `gzip`. */
function zboot(image: Uint8Array, magic = "zimg"): Buffer {
  const payload = gzipSync(image)
  const h = Buffer.alloc(64)
  h.write(magic, 4)
  h.writeUInt32LE(64, 8)
  h.writeUInt32LE(payload.length, 12)
  h.write("gzip", 24)
  return Buffer.concat([h, payload])
}

describe("tarFiles", () => {
  test("a regular file by its name, and none for a name not there", () => {
    const tar = Buffer.concat([
      entry("boot/", "", "5"),
      entry("boot/a", "aa"),
      Buffer.alloc(1024),
    ])
    const got = tarFiles(tar, ["boot/a", "boot/b"])
    expect(got.get("boot/a")?.toString()).toBe("aa")
    expect(got.has("boot/b")).toBe(false)
  })
  test("a pax header's path names the entry after it", () => {
    const long = `lib/modules/${"x".repeat(120)}/m.ko.gz`
    const tar = Buffer.concat([
      entry("PaxHeaders/1", paxRecord(long), "x"),
      entry("truncated-name", "module"),
      entry("next", "n"),
    ])
    const got = tarFiles(tar, [long, "next"])
    expect(got.get(long)?.toString()).toBe("module")
    expect(got.get("next")?.toString()).toBe("n")
  })
})

describe("tarEntries", () => {
  test("files with their modes and symlinks with their targets, in order; a directory is none", () => {
    const tar = Buffer.concat([
      entry("usr/lib/", "", "5"),
      entry("usr/lib/libudev.so.1", "", "2", { target: "libudev.so.1.6.3" }),
      entry("usr/lib/libudev.so.1.6.3", "lib", "0", { mode: 0o755 }),
      Buffer.alloc(1024),
    ])
    expect(tarEntries(tar)).toEqual([
      {
        kind: "symlink",
        name: "usr/lib/libudev.so.1",
        target: "libudev.so.1.6.3",
      },
      {
        kind: "file",
        name: "usr/lib/libudev.so.1.6.3",
        mode: 0o755,
        body: Buffer.from("lib"),
      },
    ])
  })
})

test("an apk's entries leave out apk-tools' own", () => {
  const apk = Buffer.concat([
    gzipSync(entry(".SIGN.RSA.key", "sig")),
    gzipSync(entry(".PKGINFO", "info")),
    gzipSync(Buffer.concat([entry("sbin/btrfs", "b"), Buffer.alloc(1024)])),
  ])
  expect(apkEntries(apk).map(e => e.name)).toEqual(["sbin/btrfs"])
})

test("an apk's gzip streams are read as one tar", () => {
  const apk = Buffer.concat([
    gzipSync(entry(".SIGN.RSA.key", "sig")),
    gzipSync(entry(".PKGINFO", "info")),
    gzipSync(
      Buffer.concat([entry(KERNEL_ENTRY, "kernel"), Buffer.alloc(1024)]),
    ),
  ])
  expect(apkFiles(apk, [KERNEL_ENTRY]).get(KERNEL_ENTRY)?.toString()).toBe(
    "kernel",
  )
})

describe("zbootImage", () => {
  test("unpacks the payload its header names", () => {
    expect(zbootImage(zboot(fakeImage()))).toEqual(fakeImage())
  })
  test("refuses a kernel that is not zboot", () => {
    expect(() => zbootImage(zboot(fakeImage(), "MZ\0\0"))).toThrow(
      "not an EFI zboot",
    )
  })
  test("refuses a payload that is not an arm64 Image", () => {
    expect(() => zbootImage(zboot(Buffer.alloc(128)))).toThrow(
      "not an arm64 Image",
    )
  })
})

test("pinnedKernel: the Image from the pinned apk, unpacked once", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-kernel-"))
  try {
    const apk = gzipSync(
      Buffer.concat([
        entry(KERNEL_ENTRY, zboot(fakeImage())),
        Buffer.alloc(1024),
      ]),
    )
    const pin = {
      version: "1",
      url: "https://x/linux-virt-1.apk",
      sha256: sha256Hex(apk),
    }
    const fetched = vi.fn(async () => apk)
    const image = await pinnedKernel(dir, pin, fetched)
    expect(await readFile(image)).toEqual(fakeImage())
    expect(await pinnedKernel(dir, pin, fetched)).toBe(image)
    expect(fetched).toHaveBeenCalledTimes(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
