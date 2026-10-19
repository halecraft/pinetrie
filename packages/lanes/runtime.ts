// lanes/runtime — pine·trie's lane runtime: Node, and static programs for any
// image.
//
// The helper is pine·trie's, so it must run on any project's image, with or
// without Node, on musl as well as glibc. After building pine·trie's default
// image, the host copies out of it:
// - `node/`: the `node` binary, the shared libraries `ldd` lists for it
//   (`node/lib/`), and glibc's dynamic loader as `ld.so`, whatever the
//   machine's architecture names it. The helper is started through that
//   loader with those libraries, so the image's own libc and Node are never
//   used. Its `process.execPath` is then the loader.
// - `bin/`: each of core's `RUNTIME_PROGRAMS`, a static musl build that runs
//   on any Linux. Debian's own builds of rg and fd link glibc, so the default
//   image downloads release builds instead.
// Every lane mounts it read-only at `/pinetrie-runtime`. Only `bin/` goes on a
// lane's `PATH`: pinetrie's `node` cannot start without its loader.

import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { RUNTIME_PROGRAMS } from "@pinetrie/core"
import { describeFailure, run } from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"
import { RUNTIME_MOUNT } from "./spec.ts"

/** How the runtime's Node starts, in a lane: a script's path follows it (`scriptCommand`). */
export const RUNTIME_NODE: readonly string[] = [
  `${RUNTIME_MOUNT}/node/ld.so`,
  "--library-path",
  `${RUNTIME_MOUNT}/node/lib`,
  `${RUNTIME_MOUNT}/node/node`,
]

/**
 * The script that copies the runtime out of the default image, as a tar on
 * its stdout: a throwaway container's stdout is the one way out that every
 * runtime has. A program the image lacks fails it, naming the program, so
 * the host stops at startup rather than give lanes a runtime without it.
 */
export const EXTRACT = [
  "set -e",
  "mkdir -p /out/node/lib /out/bin",
  'cp "$(command -v node)" /out/node/node',
  "ldd /out/node/node | awk '/=> \\// {print $3}' | while read -r lib; do cp -L \"$lib\" /out/node/lib/; done",
  // The loader is the one line without `=>`: `ld-linux-aarch64.so.1` on
  // arm64, `ld-linux-x86-64.so.2` on x86_64.
  "cp -L \"$(ldd /out/node/node | awk '!/=>/ && $1 ~ /^\\// {print $1}')\" /out/node/ld.so",
  ...RUNTIME_PROGRAMS.map(
    p =>
      `p=$(command -v ${p}) || { echo "the lane image has no ${p}" >&2; exit 1; }; cp "$p" /out/bin/${p}`,
  ),
  "tar -C /out -cf - .",
].join("\n")

/** Whether a runtime holds its loader and every program, given the names in its `node/` and `bin/`. */
export const runtimeComplete = (
  nodeEntries: readonly string[],
  binEntries: readonly string[],
): boolean =>
  nodeEntries.includes("ld.so") &&
  RUNTIME_PROGRAMS.every(p => binEntries.includes(p))

/**
 * The runtime for `image` under `dir` (the session's `runtime/`), copied out of it
 * unless one with every program is there, `extracting` told first. Its
 * directory is named by the image's tag, so a rebuilt image gets a new
 * runtime, and those of earlier tags are removed. Returns the directory.
 */
export async function ensureRuntime(
  runtime: LaneRuntime,
  dir: string,
  image: string,
  extracting: () => void = () => {},
): Promise<string> {
  const name = image.replace(/[^A-Za-z0-9._-]/g, "-")
  const final = path.join(dir, name)
  const [node, bin] = await Promise.all(
    ["node", "bin"].map(d => readdir(path.join(final, d)).catch(() => [])),
  )
  if (!runtimeComplete(node ?? [], bin ?? [])) {
    extracting()
    await extract(runtime, final, image)
  }
  for (const old of await readdir(dir))
    if (old !== name)
      await rm(path.join(dir, old), { recursive: true, force: true })
  return final
}

/** Unpacked into a scratch directory, renamed into place, so a half-copied runtime is never used. */
async function extract(
  runtime: LaneRuntime,
  final: string,
  image: string,
): Promise<void> {
  const scratch = `${final}.tmp`
  const tar = `${final}.tar`
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  try {
    const ran = await runtime.runInImage(image, ["sh", "-c", EXTRACT])
    if (!ran.ok)
      throw new Error(describeFailure("copying the lane runtime", ran))
    await writeFile(tar, ran.stdout)
    const unpacked = await run("tar", ["-xf", tar, "-C", scratch])
    if (!unpacked.ok)
      throw new Error(describeFailure("unpacking the lane runtime", unpacked))
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    throw error
  } finally {
    await rm(tar, { force: true })
  }
  await rm(final, { recursive: true, force: true })
  await rename(scratch, final)
}
