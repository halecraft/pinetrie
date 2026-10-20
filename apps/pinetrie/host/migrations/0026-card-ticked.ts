// host/migrations/0026-card-ticked — the places document's card record
// gains `ticked`, a thread's, a note column's or a media column's box. A
// stored record without it reads it as "", unticked, so no data moves:
// registering it accepts the new hash.

import type { Migration } from "./index.ts"

export const CARD_TICKED: Migration = {
  name: "0026-card-ticked",
  kind: "places",
  from: "021c2551de2c5407d0256bc79fb580ee86",
}
