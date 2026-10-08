// pi/one-root — the documents of a session with one root, for tests: what
// the scribe and the agent are over, the session's document and that root's
// (ADR-0063). Every lane is in it unless its record names another.

import { type RootId, rootIdFor, type ThreadId } from "@pinetrie/core"
import { LANE, recordsIn } from "@pinetrie/rules"
import {
  type RootDocHandle,
  readNamespace,
  type SessionDocHandle,
} from "@pinetrie/schema"
import { newRootDoc, newSessionDoc } from "@pinetrie/schema/fixtures"
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
    async root(id) {
      const known = roots.get(id)
      if (known !== undefined) return known
      const made = newRootDoc()
      roots.set(id, made)
      return made
    },
    rootOfLane: (lane: ThreadId) =>
      recordsIn(LANE, readNamespace(session, LANE.namespace)).get(lane)?.root ??
      ONE_ROOT,
  }
}
