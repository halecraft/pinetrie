// lanes/runtime — Pineta's lane runtime: Node and jj for any image (S44).
//
// The helper is Pineta's, so it must run on any project's image, with or
// without Node, on musl as well as glibc. After building Pineta's default
// image, the host copies out of it:
// - `node/`: the `node` binary, the shared libraries `ldd` lists for it
//   (`node/lib/`), and glibc's dynamic loader. The helper is started through
//   that loader with those libraries, so the image's own libc and Node are
//   never used. Its `process.execPath` is then the loader (S44 item 2).
// - `bin/jj`: a static musl build, which runs on any Linux.
// Every lane mounts it read-only at `/pineta-runtime`. Only `bin/` goes on a
// lane's `PATH`: Pineta's `node` cannot start without its loader.

import { mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
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

const EXTRACT = [
  "set -e",
  "mkdir -p /out/node/lib /out/bin",
  'cp "$(command -v node)" /out/node/node',
  "ldd /out/node/node | awk '/=> \\// {print $3}' | while read -r lib; do cp -L \"$lib\" /out/node/lib/; done",
  `cp -L /lib/${LOADER} /out/node/${LOADER}`,
  'cp "$(command -v jj)" /out/bin/jj',
].join("\n")

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * The runtime for `image` under `dir` (`.pineta/runtime/`), copied out of it
 * once. Its directory is named by the image's tag, so a rebuilt image gets a
 * new runtime. Returns the directory.
 */
export async function ensureRuntime(
  dir: string,
  image: string,
): Promise<string> {
  const name = image.replace(/[^A-Za-z0-9._-]/g, "-")
  const final = path.join(dir, name)
  if (await exists(path.join(final, "bin", "jj"))) return final
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
  return final
}
