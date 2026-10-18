// host/migrations/0007-land-merged — a land message's details name the state
// it merged `merged`, not `yours`. A message stored in the old shape does not
// decode: the column drops it, and a lane reading its base's news by what
// its lands merged would hear that news again. So every root's land
// messages are renamed in place, `content` untouched.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { LAND_TYPE } from "@pinetrie/rules"
import { renamedFields, rewriteHistory } from "./rewrite.ts"

export const landMerged = rewriteHistory({
  name: "0007-land-merged",
  customType: LAND_TYPE,
  rewrite: renamedFields({ yours: "merged" }),
})
