// host/migrations/0005-accepted-working-copy — accepted work's record names
// your `@-` line against it `workingCopy`, not `yours`. The host's
// next observation would write the record whole, but until then an old one
// does not decode, so it is renamed in place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { ACCEPTED } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

export const acceptedWorkingCopy = rewriteRecords({
  name: "0005-accepted-working-copy",
  namespace: ACCEPTED.namespace,
  home: ACCEPTED.home,
  rewrite: renamedFields({ yours: "workingCopy" }),
})
