// host/migrations/0023-incoming — what came into an asked agent of the thread
// that asked is an `incoming` message, not `heard`: each stored one takes the
// new `customType`, its details and `content` untouched. One left in the old
// type decodes as nothing, and the asked thread would hear it all again.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { INCOMING_TYPE } from "@pinetrie/rules"
import { rewriteHistory } from "./rewrite.ts"

export const incomingType = rewriteHistory({
  name: "0023-incoming",
  customType: "pinetrie.heard",
  rewrite: () => null,
  renamedTo: INCOMING_TYPE,
})
