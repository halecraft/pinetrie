// vm/build — building the lane VM's image (`image/build.sh`) in a Linux
// container the caller runs (ADR-0103). The build needs no mount: its sources
// go in as arguments, and the three files come out as a tar on stdout, so it
// runs the same under Apple's `container`, the host's Docker and the VM's.

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  IMAGE_FILES,
  IMAGE_OUTPUTS,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  parseSums,
} from "./plan.ts"

const SOURCE_DIR = path.join(import.meta.dirname, "image")

/** How a command in a throwaway container ended, its stdout as bytes. */
export interface Ran {
  readonly ok: boolean
  readonly code: number
  readonly stdout: Uint8Array
  readonly stderr: string
}

/** Runs `argv` in a throwaway container of `image`, as root, with the network. */
export type RunInImage = (
  image: string,
  argv: readonly string[],
) => Promise<Ran>

/**
 * The container the build runs in: Alpine's, at the manifest's branch, with a
 * script that writes each source from its argument, runs `build.sh` with its
 * log on stderr, and writes the outputs to stdout as a tar.
 */
export function planBuild(sources: ImageSources): {
  readonly image: string
  readonly argv: readonly string[]
} {
  const manifest = JSON.parse(sources["manifest.json"]) as { alpine?: unknown }
  if (typeof manifest.alpine !== "string")
    throw new Error("the image's manifest names no Alpine branch")
  const script = [
    "set -e",
    "mkdir -p /src /out",
    'while [ "$#" -gt 0 ]; do printf %s "$2" | base64 -d > "/src/$1"; shift 2; done',
    "sh /src/build.sh /src /out >&2",
    `tar -C /out -cf - SHA256SUMS ${IMAGE_OUTPUTS.join(" ")}`,
  ].join("\n")
  return {
    image: `docker.io/library/alpine:${manifest.alpine}`,
    argv: [
      "sh",
      "-c",
      script,
      "build",
      ...IMAGE_FILES.flatMap(name => [
        name,
        Buffer.from(sources[name]).toString("base64"),
      ]),
    ],
  }
}

/** The image's sources, read from `image/`. */
export async function readImageSources(): Promise<ImageSources> {
  const read = async (name: string) =>
    [name, await readFile(path.join(SOURCE_DIR, name), "utf8")] as const
  return Object.fromEntries(
    await Promise.all(IMAGE_FILES.map(read)),
  ) as ImageSources
}

const sha256Of = (file: string): Promise<string | null> =>
  readFile(file).then(
    data => createHash("sha256").update(data).digest("hex"),
    () => null,
  )

/** Why the image in `dir` cannot be used, or null. */
export async function checkImageDir(dir: string): Promise<string | null> {
  const sums = await readFile(path.join(dir, "SHA256SUMS"), "utf8").catch(
    () => null,
  )
  if (sums === null) return "there is no SHA256SUMS"
  const actual: Record<string, string | null> = {}
  for (const name of IMAGE_OUTPUTS)
    actual[name] = await sha256Of(path.join(dir, name))
  return imageRefusal(parseSums(sums), actual)
}

const untar = (file: string, dir: string) =>
  new Promise<void>((resolve, reject) =>
    execFile("tar", ["-xf", file, "-C", dir], error =>
      error === null ? resolve() : reject(error),
    ),
  )

/**
 * The image for the current sources under `stateDir`, built unless a whole
 * one is there. A build is unpacked into a temporary directory, checked
 * against its `SHA256SUMS`, then renamed into place, so a half-written image
 * is never used. Returns its directory.
 */
export async function buildVmImage(input: {
  readonly stateDir: string
  readonly run: RunInImage
  readonly log: (line: string) => void
}): Promise<{ readonly dir: string; readonly built: boolean }> {
  const sources = await readImageSources()
  const dir = imageDir(input.stateDir, imageKey(sources))
  if ((await checkImageDir(dir)) === null) return { dir, built: false }
  const plan = planBuild(sources)
  input.log(`building the VM image in ${plan.image}`)
  const ran = await input.run(plan.image, plan.argv)
  for (const line of ran.stderr.split("\n"))
    if (line.trim() !== "") input.log(line)
  if (!ran.ok) throw new Error(`the VM image's build failed (exit ${ran.code})`)
  const scratch = `${dir}.tmp-${process.pid}`
  const tar = `${scratch}.tar`
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  try {
    await writeFile(tar, ran.stdout)
    await untar(tar, scratch)
    const refused = await checkImageDir(scratch)
    if (refused !== null) throw new Error(`the built VM image: ${refused}`)
    await rm(dir, { recursive: true, force: true })
    await rename(scratch, dir)
  } finally {
    await rm(tar, { force: true })
    await rm(scratch, { recursive: true, force: true })
  }
  return { dir, built: true }
}
