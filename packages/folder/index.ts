// @pinetrie/folder — a folder project's history decided as values: its graph
// of states, the path merge's plan, the snapshots kept, the writes of an
// accept or a restore, a resolution, a review, and what each records. It
// exports by name only what another package imports; a name only this
// package and its tests use is imported from its module.

export {
  checkStage,
  isSameInode,
  isStillOwn,
  journalPaths,
  keptAsides,
  type PathNow,
  pathWrites,
  planAccept,
  planAsides,
  planNames,
  planRecovery,
  planRestore,
  planWriteSteps,
  type RecoveryStep,
  type StageEntry,
  type TargetFact,
  type WriteStep,
} from "./accept.ts"
export {
  isAncestor,
  isRecorded,
  type LaneStates,
  laneStates,
  planLaneMerge,
  planMergeBase,
  type StateGraph,
  shownMergeId,
} from "./graph.ts"
export {
  type KeepPlanned,
  planKeep,
} from "./keep.ts"
export { planLineRead } from "./line.ts"
export {
  type MergePlanned,
  type PathFacts,
  pathsToCompare,
  pathsToGather,
  planPathMerge,
} from "./merge.ts"
export {
  planFolderRecords,
  planShownMerge,
  type ShownMergePlan,
  shownPoint,
} from "./proposed.ts"
export {
  type FolderRecords,
  planGetLatestRecords,
  planStateRecords,
} from "./records.ts"
export { planResolve } from "./resolve.ts"
export {
  pairRenames,
  planFolderReview,
  renameCandidates,
  type SizedPath,
} from "./review.ts"
