// host/migrations/0008-turn-disk-private — a turn's record lists the ignored
// paths no command made from source as its disk's `private`, not `local`. A
// record in the old shape does not decode, so the column would lose its
// ask's counts and files: each is renamed in place, in every root.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { REVISION } from "@pinetrie/rules"
import { renamedFields, rewriteRecords } from "./rewrite.ts"

const renameDisk = renamedFields({ local: "private" })

/** A stored turn record whose disk holds `local`, with it renamed; null for any other. */
export function turnDiskPrivate(contents: unknown): object | null {
  if (contents === null || typeof contents !== "object") return null
  const { disk } = contents as { readonly disk?: unknown }
  const renamed = renameDisk(disk)
  return renamed === null ? null : { ...contents, disk: renamed }
}

export const turnDiskPrivateMigration = rewriteRecords({
  name: "0008-turn-disk-private",
  namespace: REVISION.namespace,
  home: REVISION.home,
  rewrite: turnDiskPrivate,
})
