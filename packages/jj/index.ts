// jj — jj's adapter: your repo (its owner, proposed changes, accepted work),
// each lane's own repo (`lane/`), and your repo at startup (`startup.ts`). Of
// your repo, only what other packages use: no runner, since steps run on the
// owner alone, but for a tidy's, which runs while no host and so no owner is
// there (`tidy.ts`); and proposed changes are read only through a gather
// (`proposed-gather.ts`), which picks the read path, so the separate reads and
// the one-read path stay inside.

export { beginFacts, readWipState } from "./accepted.ts"
export { readRepoFile } from "./file-at.ts"
export * from "./lane/index.ts"
export type { Moved } from "./observe.ts"
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
export { renameProposed } from "./pre-proposed.ts"
export {
  type CommitSpan,
  fileDiff,
  readProposedChanges,
  revisionRead,
  sideRev,
  startOfProposed,
} from "./proposed.ts"
export {
  gatherAcceptance,
  gatherDescribe,
  gatherPlace,
  gatherProposedChanges,
  gatherRefresh,
  gatherStack,
  type ProposedChangesInput,
} from "./proposed-gather.ts"
export { repairProposedChanges } from "./proposed-repair.ts"
export {
  acceptanceEffects,
  describeEffects,
  type ProposedChangesEffects,
  proposedChangesEffects,
  rebuildEffects,
} from "./proposed-steps.ts"
export { jjFileBytes } from "./review-content.ts"
export type { TimedCommand } from "./run.ts"
export {
  type JjProjectDir,
  prepareProjectDir,
  prepareShared,
} from "./startup.ts"
export type { RepoStep } from "./step.ts"
export {
  executeTidy,
  gatherTidy,
  isTidyRaced,
  type OpLogFacts,
  planTidy,
  planTidyHint,
  readOpLog,
  TIDY_DAYS,
  type TidyPlan,
  type TidyRefusal,
} from "./tidy.ts"
