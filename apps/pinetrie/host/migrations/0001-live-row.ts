// 0001-live-row — a stream's `under` and `callId` became nullable
// (PLAN-2026-10-06-schema-boundaries, Phase 1). Nothing moves: a starting
// host clears `pinetrie:live` before anything reads it.

import type { Migration } from "./index.ts"

export const liveRow: Migration = {
  name: "0001-live-row",
  kind: "live",
  from: "023fe7b49978283af189239cf817f070dc",
}
