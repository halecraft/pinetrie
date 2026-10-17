// lanehost/tar-out — a snapshot's files as one tar stream, for an accept to
// extract into the project's folder: run in the disks role as a command of
// its own (`docker exec`), never as a call, since its answer is a stream.
// Every path is checked inside the snapshot first: a lane controls the
// names in its state, and a symlink on a path's way would have tar read
// outside it. The stream holds regular files only; an accept writes a
// symlink from its target.
//
// Run as `tar-out.ts <snapshot dir>`, the paths NUL-separated on stdin;
// a refused path exits 1 before tar writes anything.

import { lstat } from "node:fs/promises"
import path from "node:path"
import { commandStream } from "@pinetrie/channel"
import { isPathInside } from "@pinetrie/core"

/**
 * Each of `paths` checked to be a regular file inside `root`, no symlink on
 * its way; throws naming the first that is not. Every stream out of a
 * snapshot checks its paths here: `tarStream`'s and `file-out.ts`'s.
 */
export async function checkOutPaths(
  root: string,
  paths: readonly string[],
): Promise<void> {
  for (const p of paths) {
    if (!isPathInside(p))
      throw new Error(`not a path inside a snapshot: ${JSON.stringify(p)}`)
    const parts = p.split("/")
    for (const [i] of parts.entries()) {
      const at = path.join(root, ...parts.slice(0, i + 1))
      const s = await lstat(at).catch(() => null)
      const last = i === parts.length - 1
      if (s === null || (last ? !s.isFile() : !s.isDirectory()))
        throw new Error(
          `${p} is no regular file of its snapshot: ${parts.slice(0, i + 1).join("/")} is ${s === null ? "missing" : "not one"}`,
        )
    }
  }
}

/** The command that writes the tar of a snapshot's paths, given on its stdin NUL-separated. */
export const TAR_OUT = "packages/lanehost/tar-out.ts"

/**
 * The tar of `paths` under `root`, as it comes: pax, so long and UTF-8
 * names survive, each path alone (no recursion). Throws when a path is
 * not a regular file of the snapshot, and at its end when tar failed.
 */
export async function* tarStream(
  root: string,
  paths: readonly string[],
): AsyncIterable<Uint8Array> {
  await checkOutPaths(root, paths)
  yield* commandStream(
    [
      "tar",
      "-cf",
      "-",
      "--format=pax",
      "--no-recursion",
      "-C",
      root,
      "--null",
      "-T",
      "-",
    ],
    { stdin: paths.map(p => `${p}\0`).join("") },
  )
}

/** The paths on stdin, NUL-separated. */
async function stdinPaths(): Promise<readonly string[]> {
  let text = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) text += chunk
  return text.split("\0").filter(p => p !== "")
}

if (import.meta.main) {
  const [root] = process.argv.slice(2)
  if (root === undefined) {
    process.stderr.write(
      "usage: tar-out.ts <snapshot dir>, its paths on stdin\n",
    )
    process.exit(2)
  }
  try {
    for await (const chunk of tarStream(root, await stdinPaths()))
      if (!process.stdout.write(chunk))
        await new Promise(r => process.stdout.once("drain", r))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}
