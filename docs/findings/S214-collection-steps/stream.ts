import { streamChanges } from "../../../packages/lanehost/send-stream.ts"
import { collectionSteps } from "./count.ts"
import { streamOf } from "./stream-of.ts"

const MKFILE = 3,
  MKDIR = 4,
  RENAME = 9
for (const dirs of [500, 1000]) {
  const commands: [number, string, string?][] = []
  for (let d = 0; d < dirs; d++) {
    const dir = `o${d + 1}-7-0`
    commands.push([MKDIR, dir])
    for (const f of ["a", "b"]) {
      const file = `o${d + 1}-7-${f === "a" ? 1 : 2}`
      commands.push([MKFILE, file], [RENAME, file, `${dir}/${f}`])
    }
    commands.push([RENAME, dir, `node_modules/p${d}`])
  }
  const bytes = streamOf(commands)
  const { result, steps } = collectionSteps(() => streamChanges(bytes))
  console.log("stream", dirs, "changes", result.length, "steps", steps)
}
