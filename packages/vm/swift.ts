// vm/swift — the Mac's two binaries, the launcher and the image's builder:
// compiled with `swiftc` and signed ad hoc with the virtualization
// entitlement, once per change of their source, into `<state dir>/bin/`.

import { execFile } from "node:child_process"
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { sha256Hex } from "./pinned.ts"
import type { BinaryState } from "./plan.ts"

/** A binary built from one Swift file. */
export interface SwiftBinary {
  /** Its name's prefix: `<prefix>-<hash>`. */
  readonly prefix: string
  readonly source: string
  readonly entitlements: string
}

const ENTITLEMENTS = path.join(
  import.meta.dirname,
  "launcher",
  "launcher.entitlements",
)

export const LAUNCHER: SwiftBinary = {
  prefix: "launcher",
  source: path.join(import.meta.dirname, "launcher", "launcher.swift"),
  entitlements: ENTITLEMENTS,
}

export const BUILDER: SwiftBinary = {
  prefix: "builder",
  source: path.join(import.meta.dirname, "builder", "builder.swift"),
  entitlements: ENTITLEMENTS,
}

/**
 * The binary's file name: its prefix and a hash of its source and
 * entitlements. A launcher's name is the VM's identity: a host retires a
 * VM whose launcher's name differs from the one it would start.
 */
export const binaryName = (
  b: SwiftBinary,
  source: string,
  entitlements: string,
): string =>
  `${b.prefix}-${sha256Hex(`${source}\0${entitlements}`).slice(0, 16)}`

const exec = (program: string, args: readonly string[]) =>
  new Promise<{ ok: boolean; out: string }>(resolve =>
    execFile(program, args, (error, stdout, stderr) =>
      resolve({ ok: error === null, out: `${stdout}${stderr}`.trim() }),
    ),
  )

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/** Where `b` for its current source is, and whether it is built or can be. */
export async function gatherBinary(
  stateDir: string,
  b: SwiftBinary,
): Promise<{ readonly binary: string; readonly state: BinaryState }> {
  const [source, entitlements] = await Promise.all([
    readFile(b.source, "utf8"),
    readFile(b.entitlements, "utf8"),
  ])
  const binary = path.join(stateDir, "bin", binaryName(b, source, entitlements))
  if (await exists(binary)) return { binary, state: "built" }
  return {
    binary,
    state: (await exec("xcrun", ["--find", "swiftc"])).ok
      ? "buildable"
      : "no-swiftc",
  }
}

/** Build and sign `b` at `binary`, through a temporary name. */
export async function buildBinary(
  binary: string,
  b: SwiftBinary,
): Promise<void> {
  const scratch = `${binary}.tmp-${process.pid}`
  await mkdir(path.dirname(binary), { recursive: true })
  try {
    const compiled = await exec("xcrun", [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      b.source,
      "-o",
      scratch,
    ])
    if (!compiled.ok)
      throw new Error(
        `the lane VM's ${b.prefix} did not compile: ${compiled.out}`,
      )
    const signed = await exec("codesign", [
      "-s",
      "-",
      "-f",
      "--entitlements",
      b.entitlements,
      scratch,
    ])
    if (!signed.ok)
      throw new Error(`the lane VM's ${b.prefix} was not signed: ${signed.out}`)
    await rename(scratch, binary)
  } finally {
    await rm(scratch, { force: true })
  }
}
