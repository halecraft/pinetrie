// S179: `unattributed` over a turn whose run wrote every path its diff names,
// as a `pnpm install` does. Run with `node unattributed.ts <changes.json>`,
// the fold's changes as JSON (42,631 of them in the measurement).
import { readFileSync } from "node:fs"
import type { DiskChange } from "../../../packages/core/index.ts"
import {
  type ClassedWrites,
  unattributed,
} from "../../../packages/rules/disk.ts"

const file = process.argv[2]
if (file === undefined)
  throw new Error("usage: node unattributed.ts <changes.json>")
const changes = JSON.parse(readFileSync(file, "utf8")) as DiskChange[]
const written = changes.map(c => c.path).reverse()
const writes = {
  classes: new Map(written.map(p => [p, "local"] as const)),
} as unknown as ClassedWrites
const t = performance.now()
const rest = unattributed(writes, { changes }, [])
console.log({ ms: Math.round(performance.now() - t), rest: rest.length })
