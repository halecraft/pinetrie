// host/split-call — `split_offer` (ADR-0080): a split card queued on the
// agent's lane, in one step on the documents' keeper, as the strip's button
// queues one. The drain pops it when the run ends (`queued-card-pop.ts`).

import { atEntry, cardId, type LaneName } from "@pinetrie/core"
import {
  readLatestPrompt,
  readOffers,
  readPlaces,
  readRunAuthor,
  readRunning,
} from "@pinetrie/reads"
import {
  offerStatus,
  planSplitCall,
  SPLIT_QUEUED,
  splitRefusal,
  type ToolAnswer,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "./basics.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Provenance } from "./provenance.ts"

/** What `split_offer` answers when its call reaches no thread. */
const NO_THREAD: ToolAnswer = {
  text: "This call reached no thread.",
  isError: true,
  details: null,
}

export const createSplitCall =
  (deps: {
    readonly basics: Pick<
      Basics,
      "docs" | "session" | "live" | "places" | "newId"
    >
    readonly keeper: Pick<HostKeeper, "run">
    /** Drain a lane whose queue a card joined, unless it runs. */
    readonly drain: (lane: LaneName) => void
    /** Each card's history: the split's card is the host's write. */
    readonly provenance: Pick<Provenance, "before" | "after">
  }) =>
  (lane: LaneName): Promise<ToolAnswer> =>
    deps.keeper.run(async () => {
      const { docs, session, live, places, newId } = deps.basics
      // gather
      const root = docs.rootOfLane(lane)
      const doc = await docs.laneDoc(lane)
      const tip = doc === null ? null : readLaneTip(doc, lane)
      const by = doc === null ? null : readRunAuthor(doc, session, lane)
      if (root === null || doc === null || tip === null || by === null)
        return NO_THREAD
      // plan
      const planned = planSplitCall({
        offer: offerStatus(readOffers(session).get(lane)),
        cards: readPlaces(places),
        lane,
        prompt: readLatestPrompt(doc, lane)?.role,
        running: readRunning(live, lane),
        by,
        id: cardId(newId()),
        root,
        at: atEntry(tip),
      })
      if (planned.kind === "refused")
        return { text: splitRefusal(planned.why), isError: true, details: null }
      // execute
      const before = deps.provenance.before()
      applyPlaceSteps(places, [planned.step])
      await deps.provenance.after({ kind: "host" }, before)
      deps.drain(lane)
      return { text: SPLIT_QUEUED, isError: false, details: null }
    })
