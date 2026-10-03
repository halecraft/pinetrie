// pi/one-root — the documents of a session with one root, for tests: pi's
// sessions over the session's document and that root's (ADR-0063). Every
// lane is in it unless its record names another.

import { type LaneName, type RootId, rootIdFor } from "@pineta/core"
import { LANE, recordsOf } from "@pineta/marginalia"
import {
  newRootDoc,
  newSessionDoc,
  type RootDocHandle,
  readValues,
  type SessionDocHandle,
} from "@pineta/schema"
import type { AgentDocuments } from "./agent.ts"

/** The root a test's lanes and entries are in. */
export const ONE_ROOT: RootId = rootIdFor(
  "01a0ffd2-0000-7000-8000-00000000000a",
)

export function oneRoot(
  root: RootDocHandle = newRootDoc(),
  session: SessionDocHandle = newSessionDoc(),
): AgentDocuments {
  const roots = new Map<RootId, RootDocHandle>([[ONE_ROOT, root]])
  return {
    session,
    async root(id) {
      const known = roots.get(id)
      if (known !== undefined) return known
      const made = newRootDoc()
      roots.set(id, made)
      return made
    },
    rootOfLane: (lane: LaneName) =>
      recordsOf(LANE, readValues(session, LANE.namespace)).get(lane)?.root ??
      ONE_ROOT,
  }
}
