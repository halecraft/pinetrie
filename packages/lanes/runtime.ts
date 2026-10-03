// lanes/runtime — Pineta's lane runtime: Node, and static programs for any
// image (S44, ADR-0064).
//
// The helper is Pineta's, so it must run on any project's image, with or
// without Node, on musl as well as glibc. After building Pineta's default
// image, the host copies out of it:
// - `node/`: the `node` binary, the shared libraries `ldd` lists for it
//   (`node/lib/`), and glibc's dynamic loader. The helper is started through
//   that loader with those libraries, so the image's own libc and Node are
//   never used. Its `process.execPath` is then the loader (S44 item 2).
// - `bin/`: each of core's `RUNTIME_PROGRAMS`, a static musl build that runs
//   on any Linux. Debian's own builds of rg and fd link glibc, so the default
//   image downloads release builds instead.
// Every lane mounts it read-only at `/pineta-runtime`. Only `bin/` goes on a
// lane's `PATH`: Pineta's `node` cannot start without its loader.

import { mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { RUNTIME_PROGRAMS } from "@pineta/core"
import { RUNTIME_MOUNT } from "./plan.ts"
import { describeFailure, run } from "./run.ts"

export const LOADER = "ld-linux-aarch64.so.1"

/** The command that starts `script` with the runtime's Node, in a lane. */
export const runtimeNode = (script: string): readonly string[] => [
  `${RUNTIME_MOUNT}/node/${LOADER}`,
  "--library-path",
  `${RUNTIME_MOUNT}/node/lib`,
  `${RUNTIME_MOUNT}/node/node`,
  script,
]

/**
 * The script that copies the runtime out of the default image into `/out`.
 * A program the image lacks fails it, naming the program, so the host stops
 * at startup rather than give lanes a runtime without it.
 */
export const EXTRACT = [
  "set -e",
  "mkdir -p /out/node/lib /out/bin",
  'cp "$(command -v node)" /out/node/node',
  "ldd /out/node/node | awk '/=> \\// {print $3}' | while read -r lib; do cp -L \"$lib\" /out/node/lib/; done",
  `cp -L /lib/${LOADER} /out/node/${LOADER}`,
  ...RUNTIME_PROGRAMS.map(
    p =>
      `p=$(command -v ${p}) || { echo "the lane image has no ${p}" >&2; exit 1; }; cp "$p" /out/bin/${p}`,
  ),
].join("\n")

/** Whether a runtime's `bin/` holds every program, given its entries' names. */
export const runtimeComplete = (binEntries: readonly string[]): boolean =>
  RUNTIME_PROGRAMS.every(p => binEntries.includes(p))

/**
 * The runtime for `image` under `dir` (`.pineta/runtime/`), copied out of it
 * unless one with every program is there. Its directory is named by the
 * image's tag, so a rebuilt image gets a new runtime, and those of earlier
 * tags are removed. Returns the directory.
 */
export async function ensureRuntime(
  dir: string,
  image: string,
): Promise<string> {
  const name = image.replace(/[^A-Za-z0-9._-]/g, "-")
  const final = path.join(dir, name)
  const bin = await readdir(path.join(final, "bin")).catch(() => [])
  if (!runtimeComplete(bin)) await extract(final, image)
  for (const old of await readdir(dir))
    if (old !== name)
      await rm(path.join(dir, old), { recursive: true, force: true })
  return final
}

async function extract(final: string, image: string): Promise<void> {
  const scratch = `${final}.tmp`
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  const ran = await run("container", [
    "run",
    "--rm",
    "-v",
    `${scratch}:/out`,
    image,
    "sh",
    "-c",
    EXTRACT,
  ])
  if (!ran.ok) {
    await rm(scratch, { recursive: true, force: true })
    throw new Error(describeFailure("copying the lane runtime", ran))
  }
  await rm(final, { recursive: true, force: true })
  await rename(scratch, final)
}
