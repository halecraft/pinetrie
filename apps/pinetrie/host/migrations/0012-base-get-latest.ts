// host/migrations/0012-base-get-latest — a lane's base record names what
// getting the latest would change `getLatest`, not `catchUp`. An old record
// does not decode, so the lane would read as never read: each is renamed in
// place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { BASE } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

export const baseGetLatest = rewriteRecords({
  name: "0012-base-get-latest",
  namespace: BASE.namespace,
  home: BASE.home,
  rewrite: renamedFields({ catchUp: "getLatest" }),
})
