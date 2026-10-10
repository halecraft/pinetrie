// lanehost/once — one call answered and printed as JSON, then exit: how the
// suites reach the disks the way the host does, from a synchronous check.
//   <runtime loader> … node /pinetrie/packages/lanehost/once.ts <role> <lanesDir> <facts> <call>

import { answer } from "./answer.ts"
import type { LanehostCall } from "./protocol.ts"
import { servingFrom } from "./serving.ts"

const [role, lanesDir, facts, call = ""] = process.argv.slice(2)
const result = await answer(
  JSON.parse(call) as LanehostCall,
  servingFrom([role ?? "", lanesDir ?? "", facts ?? "{}"]),
)
process.stdout.write(`${JSON.stringify(result)}\n`)
