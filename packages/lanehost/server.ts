// lanehost/server — one role's process, started by the host through its
// runtime's `docker exec -i` on the lane runtime's Node, speaking
// `@pinetrie/channel` over its stdin and stdout:
//   <runtime loader> … node /pinetrie/packages/lanehost/server.ts <role> <lanesDir> <facts>
// The host closes it by ending stdin.

import { serve } from "@pinetrie/channel"
import { answer, type Serving } from "./answer.ts"
import type { LanehostCall, LanehostHello } from "./protocol.ts"
import { servingFrom } from "./serving.ts"

const serving: Serving = servingFrom(process.argv.slice(2))

serve<LanehostHello, LanehostCall, never, unknown>(
  { role: serving.role },
  call => answer(call, serving),
)
