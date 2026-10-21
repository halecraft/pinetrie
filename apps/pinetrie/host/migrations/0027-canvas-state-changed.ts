// host/migrations/0027-canvas-state-changed — the places document's card
// record gains `stateChanged`, whether a canvas's workflow state has changed.
// A stored record without it reads it as "", unchanged, so every canvas starts
// as one an agent's first run moves to Active, and no data moves: registering
// it accepts the new hash.

import type { Migration } from "./index.ts"

export const CANVAS_STATE_CHANGED: Migration = {
  name: "0027-canvas-state-changed",
  kind: "places",
  from: "02d75eb7709972026cd9702fe1d99a668a",
}
