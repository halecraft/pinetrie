// host/commands/gate — every person's command, and every send made for one,
// cleared by the one gate (`planGate`) before it is carried out.

import type { Gated, RootId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readLaneRecords,
  readParticipantNames,
  readPlaces,
  readRevisions,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type CanvasIndex,
  type Cleared,
  displayName,
  type GateFacts,
  type GateRoot,
  gateRefusal,
  planGate,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { LaneWork } from "../work/index.ts"

interface GateDeps {
  readonly basics: Pick<Basics, "session" | "places" | "docs">
  readonly work: Pick<LaneWork, "project">
}

/**
 * `command` cleared, or the gate's refusal. A branch's root is opened only
 * when the gate asks for it (`read`), after the archive has let it through.
 */
export async function clear<C extends Gated>(
  deps: GateDeps,
  command: C,
  canvases: CanvasIndex,
): Promise<
  | { readonly kind: "cleared"; readonly command: Cleared<C> }
  | Extract<Outcome, { readonly kind: "refused" }>
> {
  const { session, places, docs } = deps.basics
  // gather
  const facts: GateFacts = {
    canvases,
    cards: readPlaces(places),
    archived: readArchived(session, places),
    lanes: readLaneRecords(session),
    kind: deps.work.project?.kind ?? null,
    roots: new Map(),
  }
  // plan, reading the roots it asks for, once
  let plan = planGate(command, facts)
  if (plan.kind === "read") {
    const roots = new Map<RootId, GateRoot>()
    for (const root of plan.roots) {
      const doc = await docs.root(root)
      roots.set(root, {
        index: readTreeIndex(doc),
        revisions: readRevisions(doc),
      })
    }
    plan = planGate(command, { ...facts, roots })
  }
  switch (plan.kind) {
    case "cleared":
      return plan
    case "read":
      throw new Error("the gate asked again for roots it was given")
    default: {
      const names = readParticipantNames(session)
      return gateRefusal(plan, w => displayName(w, names.get(w)))
    }
  }
}
