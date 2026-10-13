// S179: the fold of a recorded `btrfs send --no-data -p` stream, timed, with
// its peak memory. Run with `node fold.ts <stream>`; the stream came from
// `btrfs send -q --no-data -p <before> <after>` on the lane VM, for a turn
// that ran `pnpm install` (42,631 changes). The stream itself is not kept: it
// is 43 MB.
import { readFileSync } from "node:fs"
import {
  foldSendStream,
  readSendStream,
} from "../../../packages/lanehost/send-stream.ts"

const stream = process.argv[2]
if (stream === undefined) throw new Error("usage: node fold.ts <stream>")
const t0 = performance.now()
const commands = readSendStream(readFileSync(stream))
const t1 = performance.now()
const changes = foldSendStream(commands)
const t2 = performance.now()
const line = JSON.stringify({ id: 1, result: { changes } })
console.log({
  commands: commands.length,
  changes: changes.length,
  lineMB: (line.length / 1e6).toFixed(1),
  readMs: Math.round(t1 - t0),
  foldMs: Math.round(t2 - t1),
  rssMB: Math.round(process.memoryUsage().rss / 1e6),
})
