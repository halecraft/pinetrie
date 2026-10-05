// repo — your repo, as the host reads and writes it (ADR-0038, ADR-0060,
// ADR-0065): the offers, the integration line, and lanes' refs in it, all
// through one owner (`startRepoOwner`). What a lane also runs, through a
// runner it is given, stays in `@pinetrie/lanes`. The runners on your repo are
// the owner's alone: this package exports none. Only what other packages
// use is exported: every read of an offer goes through a gather
// (`offer-gather.ts`), which picks the read path, so the separate reads and
// the one-read path stay inside.

export { beginFacts, readWipState } from "./line.ts"
export type { Moved } from "./observe.ts"
export { fileDiff, readOffer, revisionRead, startOfOffer } from "./offer.ts"
export {
  gatherDescribe,
  gatherOffer,
  gatherOfferIntegration,
  gatherPlace,
  gatherRefresh,
  gatherStack,
  type OfferInput,
} from "./offer-gather.ts"
export { repairOffer } from "./offer-repair.ts"
export {
  describeEffects,
  type OfferEffects,
  offerEffects,
  offerIntegrationEffects,
  rebuildEffects,
} from "./offer-steps.ts"
export {
  type RepoOps,
  type RepoOwner,
  type RepoReads,
  startRepoOwner,
} from "./owner.ts"
export {
  laneRefSteps,
  lineProposal,
  planCatchUpUndo,
  planLineSetup,
  planPublishCatchUp,
  planPublishMove,
} from "./plan.ts"
export type { RepoStep } from "./step.ts"
