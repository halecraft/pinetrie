// host/migrations/0013-accepted-get-latest — accepted work's record names
// what getting your working copy the latest would do `getLatest`, not
// `catchUp`, under `workingCopy`. An old record does not decode, so the
// publish button would read nothing until the next observation: it is
// renamed in place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { ACCEPTED } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

const renameWorkingCopy = renamedFields({ catchUp: "getLatest" })

/** Accepted work's stored record with its working copy's old field renamed; null for any other. */
export function acceptedGetLatest(contents: unknown): object | null {
  if (contents === null || typeof contents !== "object") return null
  const { workingCopy } = contents as { readonly workingCopy?: unknown }
  const renamed = renameWorkingCopy(workingCopy)
  return renamed === null ? null : { ...contents, workingCopy: renamed }
}

export const acceptedGetLatestMigration = rewriteRecords({
  name: "0013-accepted-get-latest",
  namespace: ACCEPTED.namespace,
  home: ACCEPTED.home,
  rewrite: acceptedGetLatest,
})
