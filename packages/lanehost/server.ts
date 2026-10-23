// lanehost/server — one role's process, started by the host through its
// runtime's `docker exec -i` on the lane runtime's Node, speaking
// `@pinetrie/channel` over its stdin and stdout:
//   <runtime loader> … node /pinetrie/packages/lanehost/server.ts <role> <lanesDir> <facts>
// The host closes it by ending stdin, which also ends its project's lock
// (`start-serving.ts`).

import { serve } from "@pinetrie/channel"
import { holdLock } from "@pinetrie/lock"
import { dropUnfinishedSnapshots } from "./disks.ts"
import type { LanehostCall, LanehostHello } from "./protocol.ts"
import { servingFrom } from "./serving.ts"
import { startServing } from "./start-serving.ts"

const serving = servingFrom(process.argv.slice(2))

await startServing(serving, {
  hold: file => holdLock(file, { platform: "linux", until: process.stdin }),
  drop: dropUnfinishedSnapshots,
  serve: (refused, answer) =>
    serve<LanehostHello, LanehostCall, never, unknown>(
      { role: serving.role, refused },
      answer,
    ),
  // A lock gone from under it: another host may take the project now.
  lost: () => process.exit(1),
})
