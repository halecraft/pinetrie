// jj — jj's adapter: your repo (its owner, offers, accepted work), each
// lane's own repo (`lane/`), and your repo at startup (`startup.ts`). Of
// your repo, only what other packages use: no runner, since steps run on the
// owner alone, and an offer is read only through a gather
// (`offer-gather.ts`), which picks the read path, so the separate reads and
// the one-read path stay inside.

export { beginFacts, readWipState } from "./accepted.ts"
export { fileAt } from "./file-at.ts"
export * from "./lane/index.ts"
export type { Moved } from "./observe.ts"
export {
  type CommitSpan,
  fileDiff,
  readOffer,
  revisionRead,
  startOfOffer,
} from "./offer.ts"
export {
  gatherDescribe,
  gatherOffer,
  gatherOfferAcceptance,
  gatherPlace,
  gatherRefresh,
  gatherStack,
  type OfferInput,
} from "./offer-gather.ts"
export { repairOffer } from "./offer-repair.ts"
export {
  describeEffects,
  type OfferEffects,
  offerAcceptanceEffects,
  offerEffects,
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
  planCatchUpUndo,
  planPublishCatchUp,
  planPublishMove,
  planSetup,
  setupProposal,
} from "./plan.ts"
export { renameAccepted } from "./pre-accepted.ts"
export {
  type JjProjectDir,
  prepareProjectDir,
  prepareShared,
} from "./startup.ts"
export type { RepoStep } from "./step.ts"
