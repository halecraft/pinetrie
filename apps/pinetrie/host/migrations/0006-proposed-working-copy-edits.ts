// host/migrations/0006-proposed-working-copy-edits — each jj lane's proposed
// changes record names the files `@` changes `workingCopyEdits`, not
// `yourEdits`. An old record does not decode, so the host could not see it to
// delete it when the lane's proposed changes end: it is renamed in place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { PROPOSED_CHANGES } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

export const proposedWorkingCopyEdits = rewriteRecords({
  name: "0006-proposed-working-copy-edits",
  namespace: PROPOSED_CHANGES.namespace,
  home: PROPOSED_CHANGES.home,
  rewrite: renamedFields({ yourEdits: "workingCopyEdits" }),
})
