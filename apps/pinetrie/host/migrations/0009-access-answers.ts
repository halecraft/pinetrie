// host/migrations/0009-access-answers — a lane's owner allows, denies or takes
// back its use of their ssh: its record says `allowed`, or `denied` with
// `takenBack`, not `approved`, or `refused` with `revoked`. A record in the
// old shape does not decode, so the lane would read as having asked nothing:
// each is renamed in place. A record from before each state named its host
// still does not decode, and its lane asks again.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { ACCESS } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

/** A stored access record whose answer is in the old words, renamed; null for any other. */
export function accessAnswers(contents: unknown): object | null {
  if (contents === null || typeof contents !== "object") return null
  const { personal } = contents as { readonly personal?: unknown }
  if (personal === null || typeof personal !== "object") return null
  const p = personal as Readonly<Record<string, unknown>>
  if (p.kind === "approved")
    return { ...contents, personal: { ...p, kind: "allowed" } }
  if (p.kind === "refused") {
    const { revoked, ...rest } = p
    return {
      ...contents,
      personal: { ...rest, kind: "denied", takenBack: revoked === true },
    }
  }
  return null
}

export const accessAnswersMigration = rewriteRecords({
  name: "0009-access-answers",
  namespace: ACCESS.namespace,
  home: ACCESS.home,
  rewrite: accessAnswers,
})
