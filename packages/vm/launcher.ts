// vm/launcher — the launcher's binary, built on demand (ADR-0103): compiled
// with `swiftc` and signed ad hoc with the virtualization entitlement, once
// per change of its source, into `<state dir>/bin/`.

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

const SOURCE = path.join(import.meta.dirname, "launcher", "launcher.swift")
const ENTITLEMENTS = path.join(
  import.meta.dirname,
  "launcher",
  "launcher.entitlements",
)

/** The binary's name: a hash of its source and entitlements. */
export const launcherName = (source: string, entitlements: string): string =>
  `launcher-${createHash("sha256").update(`${source}\0${entitlements}`).digest("hex").slice(0, 16)}`

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

/** Where the launcher for the current source is, and whether it is built or can be. */
export async function gatherLauncher(stateDir: string): Promise<{
  readonly binary: string
  readonly state: "built" | "buildable" | "no-swiftc"
}> {
  const [source, entitlements] = await Promise.all([
    readFile(SOURCE, "utf8"),
    readFile(ENTITLEMENTS, "utf8"),
  ])
  const binary = path.join(stateDir, "bin", launcherName(source, entitlements))
  if (await exists(binary)) return { binary, state: "built" }
  return {
    binary,
    state: (await exec("xcrun", ["--find", "swiftc"])).ok
      ? "buildable"
      : "no-swiftc",
  }
}

/** Build and sign the launcher at `binary`, through a temporary name. */
export async function buildLauncher(binary: string): Promise<void> {
  const scratch = `${binary}.tmp-${process.pid}`
  await mkdir(path.dirname(binary), { recursive: true })
  try {
    const compiled = await exec("xcrun", [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      SOURCE,
      "-o",
      scratch,
    ])
    if (!compiled.ok)
      throw new Error(`the lane VM's launcher did not compile: ${compiled.out}`)
    const signed = await exec("codesign", [
      "-s",
      "-",
      "-f",
      "--entitlements",
      ENTITLEMENTS,
      scratch,
    ])
    if (!signed.ok)
      throw new Error(`the lane VM's launcher was not signed: ${signed.out}`)
    await rename(scratch, binary)
  } finally {
    await rm(scratch, { force: true })
  }
}
