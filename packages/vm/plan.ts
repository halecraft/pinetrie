// vm/plan — the lane VM's decisions, pure (ADR-0103).

import { createHash } from "node:crypto"
import path from "node:path"

/** The files in `image/` the build reads. Each is part of the image's identity. */
export const IMAGE_FILES = [
  "manifest.json",
  "build.sh",
  "init",
  "stage1-init",
] as const
export type ImageFile = (typeof IMAGE_FILES)[number]

/** The image's sources, by file name. */
export type ImageSources = Readonly<Record<ImageFile, string>>

/** The three files the launcher boots, as the build writes them. */
export const IMAGE_OUTPUTS = ["Image", "stage1.cpio", "system.erofs"] as const

/**
 * The image's identity: a hash of its sources. The manifest pins every
 * package; the scripts decide what is done with them, so a change to either
 * makes another image.
 */
export function imageKey(sources: ImageSources): string {
  const hash = createHash("sha256")
  for (const name of IMAGE_FILES) hash.update(`${name}\0${sources[name]}\0`)
  return hash.digest("hex").slice(0, 16)
}

/** The VM's state, one per user: `$XDG_STATE_HOME/pinetrie/vm`. */
export const vmStateDir = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string =>
  path.join(
    env.XDG_STATE_HOME ?? path.join(home, ".local", "state"),
    "pinetrie",
    "vm",
  )

/** Where the image for `key` is kept. */
export const imageDir = (stateDir: string, key: string): string =>
  path.join(stateDir, "images", key)

/** `sha256sum`'s output as file name → hash; a line that is not one is skipped. */
export function parseSums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim())
    if (m?.[1] !== undefined && m[2] !== undefined) sums.set(m[2], m[1])
  }
  return sums
}

/**
 * Why a built image cannot be used, or null: `SHA256SUMS` must name each
 * output with the hash `actual` gives it (null for a file that is missing).
 */
export function imageRefusal(
  sums: ReadonlyMap<string, string>,
  actual: Readonly<Record<string, string | null>>,
): string | null {
  for (const name of IMAGE_OUTPUTS) {
    const want = sums.get(name)
    const have = actual[name] ?? null
    if (want === undefined) return `SHA256SUMS does not name ${name}`
    if (have === null) return `${name} is missing`
    if (have !== want) return `${name} does not match SHA256SUMS`
  }
  return null
}

const GiB = 1024 ** 3

/** The VM's memory: a quarter of the Mac's, between 4 and 16 GiB. */
export const vmMemory = (macMemory: number): number =>
  Math.min(16 * GiB, Math.max(4 * GiB, Math.floor(macMemory / 4)))

/** gvproxy's address for the Mac's loopback, in the VM's network (S136). */
export const GVPROXY_HOST_ADDRESS = "192.168.127.254"

/** Where a slot's directories are in the VM. */
export const SHARES_ROOT = "/mnt/host-shares"

/**
 * A slot's share entries, and where each host path is in the VM. Each entry
 * is named by a hash of its source, so a directory has one name whatever else
 * is shared; one source given twice is one entry, read-write if either is.
 * `pathOf` throws for a path that is not a source: a lane binding outside its
 * host's slot would see nothing the host gave it.
 */
export function planShares(
  slot: number,
  dirs: readonly { readonly source: string; readonly readOnly: boolean }[],
): {
  readonly entries: readonly {
    readonly name: string
    readonly source: string
    readonly readOnly: boolean
  }[]
  readonly pathOf: (source: string) => string
} {
  const readOnly = new Map<string, boolean>()
  for (const d of dirs)
    readOnly.set(d.source, (readOnly.get(d.source) ?? true) && d.readOnly)
  const nameOf = (source: string) =>
    createHash("sha256").update(source).digest("hex").slice(0, 16)
  const entries = [...readOnly]
    .map(([source, ro]) => ({ name: nameOf(source), source, readOnly: ro }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return {
    entries,
    pathOf: source => {
      if (!readOnly.has(source))
        throw new Error(`${source} is not shared into slot ${slot}`)
      return `${SHARES_ROOT}/${slot}/${nameOf(source)}`
    },
  }
}

/** What decides whether a host starts the VM, joins it, or cannot. */
export interface VmFacts {
  readonly platform: NodeJS.Platform
  readonly arch: string
  /** Darwin's major version (`os.release()`): 22 is macOS 13. */
  readonly darwin: number
  /** The launcher's control.sock answers: the VM runs. */
  readonly answering: boolean
  /** The image for the current sources is built and whole. */
  readonly image: boolean
  /** The launcher for the current source is built, or `swiftc` can build it. */
  readonly launcher: "built" | "buildable" | "no-swiftc"
}

export type VmRefusal =
  | "not-mac"
  | "not-apple-silicon"
  | "old-macos"
  | "no-image"
  | "no-swiftc"

export type VmPlan =
  | { readonly kind: "join" }
  | { readonly kind: "start" }
  | { readonly kind: "refused"; readonly refusal: VmRefusal }

/** Join a running VM; else start one, when everything it takes is here. */
export function planVm(f: VmFacts): VmPlan {
  const refused = (refusal: VmRefusal): VmPlan => ({ kind: "refused", refusal })
  if (f.platform !== "darwin") return refused("not-mac")
  if (f.arch !== "arm64") return refused("not-apple-silicon")
  if (f.darwin < 22) return refused("old-macos")
  if (f.answering) return { kind: "join" }
  if (!f.image) return refused("no-image")
  if (f.launcher === "no-swiftc") return refused("no-swiftc")
  return { kind: "start" }
}

/** Why the lane VM cannot start, with what would let it. */
export function vmWords(r: VmRefusal): string {
  switch (r) {
    case "not-mac":
      return "the lane VM runs only on the Mac; on Linux, lanes use the host's Docker"
    case "not-apple-silicon":
      return "the lane VM needs a Mac with Apple silicon"
    case "old-macos":
      return "the lane VM needs macOS 13 or later"
    case "no-image":
      return "the lane VM's image is not built for this version: run `pnpm vm:build`"
    case "no-swiftc":
      return "the lane VM's launcher is built with Xcode's command line tools, which are not installed: `xcode-select --install`"
  }
}
