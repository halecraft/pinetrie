// host/migrations/0002-image-versions — the places document's card record
// gains `versions`, an image's versions as JSON. A stored record without it
// reads it as "", so no data moves: registering it accepts the new hash.

import type { Migration } from "./index.ts"

export const IMAGE_VERSIONS: Migration = {
  name: "0002-image-versions",
  kind: "places",
  from: "0283794d78e992727e2e933fa029b70753",
}
