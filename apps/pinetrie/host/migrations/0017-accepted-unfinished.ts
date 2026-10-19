// host/migrations/0017-accepted-unfinished — accepted work's record lists the
// unfinished work above it as `unfinishedWork`, not `wips`. An old record does
// not decode until the host's next observation: it is renamed in place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { ACCEPTED } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

export const acceptedUnfinished = rewriteRecords({
  name: "0017-accepted-unfinished",
  namespace: ACCEPTED.namespace,
  home: ACCEPTED.home,
  rewrite: renamedFields({ wips: "unfinishedWork" }),
})
