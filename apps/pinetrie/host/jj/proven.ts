// host/jj/proven — a lane's record proven jj where jj's adapter must read
// its points: thrown with words where it acts on one lane (a base's
// update), or none where a lane jj cannot read has nothing in your repo to
// act on (a moved ref, a review's range).

import type { LaneRecord, ThreadId } from "@pinetrie/core"
import { type JjLane, proveJjLane } from "@pinetrie/jj"
import { foreignLaneWords } from "@pinetrie/rules"

/** `record` proven jj; thrown, with why, when it is not. */
export function requireJjLane(record: LaneRecord): JjLane {
  const proved = proveJjLane(record)
  if (!("kind" in proved)) return proved
  throw new Error(
    proved.kind === "foreign"
      ? foreignLaneWords(proved)
      : `${record.lane} has no copy of its own`,
  )
}

/** `lane`'s record among `records`, proven jj; null with no record, or one jj cannot read. */
export function recordedJjLane(
  records: ReadonlyMap<ThreadId, LaneRecord>,
  lane: ThreadId,
): JjLane | null {
  const record = records.get(lane)
  const proved = record === undefined ? null : proveJjLane(record)
  return proved === null || "kind" in proved ? null : proved
}
