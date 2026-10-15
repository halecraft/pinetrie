// jj/fixtures — what jj's tests share: a lane's record proven jj, as the
// adapter proves one (`proveJjLane`).

import { rootIdFor, type ThreadId, writerId } from "@pinetrie/core"
import { type JjLane, proveJjLane } from "./lane/points.ts"

/** `lane`'s record, keeping a jj history, proven. */
export function jjLaneFor(lane: ThreadId): JjLane {
  const proved = proveJjLane({
    lane,
    root: rootIdFor("test"),
    history: "jj",
    by: writerId("probe@example.com"),
    createdAt: 0,
  })
  if ("kind" in proved) throw new Error("a jj lane's record is not jj")
  return proved
}
