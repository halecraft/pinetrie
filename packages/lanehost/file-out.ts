// lanehost/file-out — one regular file of a snapshot, its bytes as they come,
// for a review to show or offer: run in the disks role as a command of its
// own (`docker exec`), never as a call, since its answer is a stream. Its
// path is checked inside the snapshot first, as `tar-out.ts` checks its
// own (`checkOutPaths`): a lane controls the names in its state.
//
// Run as `file-out.ts <snapshot dir>`, the path on stdin; a refused path
// exits 1 before a byte is written.

import { createReadStream } from "node:fs"
import path from "node:path"
import { checkOutPaths } from "./tar-out.ts"

/** The command that writes one file of a snapshot, its path on stdin. */
export const FILE_OUT = "packages/lanehost/file-out.ts"

/** The bytes of `p` under `root`, as they come; throws, before any, when `p` is no regular file of the snapshot. */
export async function* fileStream(
  root: string,
  p: string,
): AsyncIterable<Uint8Array> {
  await checkOutPaths(root, [p])
  for await (const chunk of createReadStream(path.join(root, p)))
    yield chunk as Uint8Array
}

if (import.meta.main) {
  const [root] = process.argv.slice(2)
  if (root === undefined) {
    process.stderr.write(
      "usage: file-out.ts <snapshot dir>, its path on stdin\n",
    )
    process.exit(2)
  }
  try {
    let p = ""
    process.stdin.setEncoding("utf8")
    for await (const chunk of process.stdin) p += chunk
    for await (const chunk of fileStream(root, p))
      if (!process.stdout.write(chunk))
        await new Promise(r => process.stdout.once("drain", r))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}
