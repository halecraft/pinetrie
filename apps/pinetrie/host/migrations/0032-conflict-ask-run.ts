// host/migrations/0032-conflict-ask-run — every stored `CONFLICT_ASK` record
// is deleted. An ask once named when the host took it; it now names the run
// that asked, which an old record never kept, and under the old rule almost
// no stored ask still showed.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { CONFLICT_ASK } from "@pinetrie/rules"
import { deleteRecords } from "./rewrite.ts"

export const conflictAskRunMigration = deleteRecords({
  name: "0032-conflict-ask-run",
  namespace: CONFLICT_ASK.namespace,
  home: CONFLICT_ASK.home,
})
