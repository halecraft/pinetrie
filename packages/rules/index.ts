// rules — each stored shape and the pure rules about it. A name only this
// package and its tests use is not exported here: its tests import it from
// its module.
//
// Written by `pnpm run indexes`: each name some file imports through it, from
// the module that declares it, and nothing else.

export {
  ACCEPTED,
  ACCEPTED_KEY,
  type AcceptedActionState,
  type AcceptedRecord,
  acceptedActionState,
  type FolderAcceptedRecord,
  nothingToPublish,
  type PublishTicket,
  type PublishWork,
  planAcceptedAction,
  planAcceptedRecord,
  planPublishFinish,
  publishWork,
} from "./accepted.ts"
export {
  ACCESS,
  type AccessNews,
  type AccessRecord,
  answersFor,
  emptyAccess,
  type OutsideHost,
  type PersonalAccess,
  planAccessAnswer,
  planAccessChange,
  planAccessOutside,
  planAccessRecovery,
  planAccessUse,
  planPersonalSign,
} from "./access.ts"
export {
  getLatestRefusal,
  planSplitCall,
  refusedAnswer,
  resolveAnswer,
  SPLIT_QUEUED,
  SPLIT_UNMADE,
  splitRefusal,
  type ToolAnswer,
} from "./agent-commands.ts"
export {
  ALLOWANCE,
  type AllowanceRecord,
  addedTokens,
  DEFAULT_ALLOWANCE,
  mayRequest,
  newAllowance,
  planSpend,
  type RequestTokens,
} from "./allowance.ts"
export {
  type ArchiveTeardown,
  archivedIn,
  CANVAS_BUSY_REASON,
  type Crossing,
  planArchive,
  planLanesGone,
} from "./archive.ts"
export {
  BANNER,
  BANNER_ATTEMPTS,
  type BannerAnswer,
  type BannerAsk,
  type BannerRecord,
  bannerAnswer,
  bannerDue,
  bannerPrompt,
  bannerStillWanted,
  DEFAULT_ICON_MODEL,
  ICON_SOURCES,
  ICONS,
  ICONS_KEY,
  type IconConfig,
  type IconsRecord,
  iconConfig,
  planAsk,
} from "./banner.ts"
export {
  BASE,
  type BaseRecord,
  effectiveBase,
  type ForkBegin,
  type LatestNow,
  latestNow,
  type ParentNow,
  parentNow,
  planBegin,
  planParentUpdate,
  planUpdateFrom,
  updateRefusal,
} from "./base.ts"
export {
  BEHIND_TYPE,
  type BehindMessage,
  behindContent,
  behindLine,
  decodeBehind,
  encodeBehind,
  planBaseNews,
} from "./behind.ts"
export {
  BLOCK_PROPERTY,
  type BlockNode,
  blockKey,
  markBlocks,
  textBlocks,
} from "./blocks.ts"
export {
  type BoardMove,
  boardCanvases,
  boardStates,
  type CanvasRole,
  canvasRole,
  isBoardCard,
  planBoardMove,
  planMoveToActive,
  planWorkflowChange,
  planWorkflowSeed,
  taskBoard,
  tasksInArchive,
  WORKFLOW,
  WORKFLOW_KEY,
  type Workflow,
  type WorkflowState,
  workflowState,
} from "./board.ts"
export {
  CANVAS_CAP,
  type CanvasFactMessage,
  type CanvasMessage,
  canvasLines,
  canvasList,
  columnGlances,
  decodeCanvas,
  decodeCanvasFact,
  encodeCanvas,
  encodeCanvasFact,
  NEW_MEDIA_TITLE,
  planCanvasFacts,
  UNTITLED_IMAGE,
} from "./canvas.ts"
export {
  type CanvasIndex,
  type CardOnCanvas,
  canvasOfPlace,
  cardsOnCanvas,
  indexCanvases,
  isOnCanvas,
  type KindOnCanvas,
  NO_CANVAS_INDEX,
  planThreadOpen,
  type ThreadOpen,
  type ThreadOpening,
  unstartedThreads,
} from "./canvas-index.ts"
export {
  type CanvasPinnedMessage,
  decodeCanvasPinned,
  encodeCanvasPinned,
} from "./canvas-pinned.ts"
export {
  decodeCard,
  encodeCard,
  pinnedCardsAtEnd,
  placeEnd,
  planCardSweep,
  yourCard,
} from "./card.ts"
export {
  type CardFacts,
  type CardPlan,
  type CardRefusal,
  type ImageRefusal,
  planBusyQueue,
  planCanvasPlacement,
  planCardCommandSet,
  planCardMove,
  planCardPaste,
  planCardQueue,
  planCardReorder,
  planCardSpend,
  planCardSpinOff,
  planCardTick,
  planCardWidth,
  planImagesPut,
  planImageVersion,
  planProposalPress,
  planThreadCopy,
  planThreadOpening,
  planUndo,
  planUndoAnswer,
  planUndoReach,
  type StoredBlob,
} from "./card-commands.ts"
export {
  CARD_HISTORY,
  type CardEvent,
  type CardHistoryRecord,
  type Cause,
  changeVerb,
  movedBackBy,
  type ProvenanceSteps,
  planProvenance,
  planTraceSweep,
  planTrashSweep,
  TRACE,
  TRASH_KEEP_MS,
  type TracedPlace,
  type TraceRecord,
  traceEnd,
  trashDeadline,
  trashedTime,
  type Verb,
} from "./card-history.ts"
export { planCardRead } from "./card-read.ts"
export { CARD_TITLE, type CardTitleRecord, titledCards } from "./card-title.ts"
export {
  COMMANDS,
  COMMANDS_KEY,
  type CommandRef,
  type CommandSource,
  type CommandSummary,
  expandSkill,
  type GatheredCommand,
  isCommandLabel,
  labelCommands,
  parseCommand,
  resolveCommand,
} from "./commands.ts"
export { type ModelRef, modelRef } from "./config.ts"
export {
  CONFLICT_ASK,
  type ConflictAskRecord,
  planConflictAsk,
} from "./conflict-ask.ts"
export { mintContainer } from "./containers.ts"
export {
  CONTEXT,
  CONTEXT_KINDS,
  CONTEXT_RULES,
  contextInView,
} from "./context.ts"
export type { CopyPlan, CopyThread } from "./copy.ts"
export {
  byteWords,
  count,
  countOrNone,
  namesAndMore,
  plural,
  shortId,
} from "./counts.ts"
export {
  type Answer,
  DIGEST,
  type DigestBody,
  type DigestRecord,
  digestRequest,
  digestText,
  digestToWrite,
  parseDigest,
  pointsText,
  URGENCY_ALONE,
  URGENCY_THEN_DIGEST,
} from "./digest.ts"
export {
  type ClassedWrites,
  decodeRegistry,
  ignoreQuery,
  planStaleOutputs,
  registryAfter,
  turnDisk,
  unattributed,
  writesToClass,
} from "./disk.ts"
export {
  decodeFact,
  decodeQueuedFact,
  encodeFact,
  encodeQueuedFact,
  FACT_TYPE,
  type FactMessage,
  factContent,
  factLine,
  tokensWords,
} from "./fact.ts"
export {
  FOCUS,
  FOCUS_REQUEST_HEAD,
  type FocusRecord,
  focusRequest,
  focusToWrite,
  parseFocus,
  planFocus,
} from "./focus.ts"
export {
  CONFLICT,
  conflictKey,
  decodeFolderStamps,
  encodeFolderStamps,
  FOLDER_WRITE_JOURNAL,
  STATE,
} from "./folder-records.ts"
export {
  type Cleared,
  type GateFacts,
  type GateRefusal,
  type GateRoot,
  planGate,
} from "./gate.ts"
export {
  type LatestInRunDone,
  planGetLatest,
  planLatestInRun,
  planLatestInRunAnswer,
  planSettle,
  type Resolution,
  type Settle,
  type SettleFacts,
} from "./get-latest.ts"
export {
  foreignIn,
  foreignLaneWords,
  foreignRefusal,
  type RunAt,
  type ThreadHolding,
  takenIn,
  threadCardHolding,
} from "./held.ts"
export { planReorder } from "./in-place.ts"
export {
  decodeLand,
  LAND_TYPE,
  type LandMessage,
  type PromptBudget,
} from "./land.ts"
export { baseMovedOn, latestSourceName, mergedFrom } from "./latest-from.ts"
export { addressLink, type LinkedQuote, pastMarkdown } from "./links.ts"
export { isCurrentReply, planClear, planEndRun, planStream } from "./live.ts"
export { MACHINE, MACHINE_KEY } from "./machine.ts"
export {
  entryMarginCounts,
  type MarginCard,
  marginCards,
  marginCounts,
} from "./margin.ts"
export { MARK, type MarkRecord, planMark } from "./mark.ts"
export { type ImageInColumn, imagesIn } from "./media.ts"
export {
  addressMessage,
  agentByDefault,
  decodeMessage,
  encodeMessage,
  MESSAGE_TYPE,
  type MessageDecision,
  type MessageDetails,
  messageImageShas,
  type PersonMessage,
  type PromptMessage,
  planAfterStep,
  planDelivery,
  planRunSteps,
  promptAuthor,
  renderableMessage,
  type StepOutcome,
  withMessageImages,
} from "./message.ts"
export { planHistorySweep, type UndoResult } from "./move-history.ts"
export { pastedCard } from "./moves.ts"
export {
  NAME,
  type NameRecord,
  planNames,
  planReserve,
  type ReservePlan,
  readableThreadName,
} from "./names.ts"
export { NEW_NOTES_TITLE, type NoteCard, notesIn, notesNear } from "./notes.ts"
export type { GatheredStart, OpenPlan, OpenThread } from "./open.ts"
export { keyAfter, orderAfter, orderBetween, orderKeys } from "./order.ts"
export {
  displayName,
  PARTICIPANT,
  PICTURE,
  PICTURE_MOST,
  participants,
  pictureWrites,
  planFittedPicture,
  planPicture,
} from "./participant.ts"
export {
  decodePinned,
  encodePinned,
  PINNED_RULE,
  PINNED_TYPE,
  type PinnedMessage,
  type PinnedStatus,
  pinnedDiff,
  pinnedReads,
} from "./pinned.ts"
export { inventoryFull, type PlaceStep } from "./place-steps.ts"
export { type BranchOutRefusal, parseProposal } from "./proposal.ts"
export {
  isNotYetAccepted,
  PROPOSED_CHANGES,
  planDescribeAsk,
  planDescribeSettle,
  planRefresh,
  planStackEnded,
  planWorkingCopyEdits,
  proposedChangesRecord,
  proposedChangesSeen,
  proposedChangesStatus,
} from "./proposed.ts"
export { planProposedAct } from "./proposed-act.ts"
export { type PutImageAsk, planImageAsk } from "./put-images.ts"
export {
  blankQueued,
  type CarryPlan,
  canvasPinnedCards,
  isQueuedMessage,
  isQueuedText,
  NONE_BLANK,
  planCarry,
  planFactCard,
  planNextQueuedCardPop,
  planUnqueueAll,
  planUnsent,
  type QueuedCard,
  type QueuedMessage,
  type QueuedText,
  queuedOn,
} from "./queue.ts"
export {
  planHoldSweep,
  planQueueHold,
  QUEUE_HOLD,
  type QueueHold,
} from "./queue-hold.ts"
export { rankOfDrop } from "./rank.ts"
export {
  awayWords,
  type LateScope,
  lateAway,
  reachableAgents,
  threadReach,
} from "./reach.ts"
export {
  byTarget,
  decodeRecords,
  deleteRecord,
  type Home,
  type RecordSpec,
  recordsIn,
  setIfChanged,
  setRecord,
} from "./records.ts"
export {
  AGENTS_RULE,
  ANSWER_TYPE,
  type AnswerMessage,
  decodeAnswer,
  decodeRelay,
  encodeAnswer,
  encodeIncoming,
  encodeRelayMessage,
  INCOMING_TYPE,
  type IncomingEntriesMessage,
  RELAY_TYPE,
  type RelayRefusal,
  relayLine,
  relayRefusalText,
  unreachableRefusal,
} from "./relay.ts"
export { removalsText, type StaleRemoval } from "./removals.ts"
export { describeRequest, transcriptLines } from "./request.ts"
export { planResolveCommand } from "./resolve.ts"
export {
  answerDiff,
  answerReview,
  decodeRevisionReview,
  diffUrl,
  fileUrl,
  MAX_DIFF_BYTES,
  parseReviewPath,
  planReviewRead,
  type RecordedSpan,
  type ReviewAnswer,
  type ReviewAsk,
  type ReviewFacts,
  readableSpan,
  reviewUrl,
} from "./review.ts"
export { planRootDelete } from "./root.ts"
export { ROOT, type RootRecord } from "./roots.ts"
export { roundRequest } from "./round.ts"
export {
  type EndReply,
  parseEndReply,
  parseUrgencyLine,
  pendingRunEndReport,
  RUN_END_REPORT,
  type RunEndReport,
  type RunEndReportRecord,
  runEndedToWrite,
} from "./run-end-report.ts"
export {
  checkRecipe,
  dirtyPaths,
  drainLane,
  laneFold,
  tracesWithCommands,
} from "./runs.ts"
export {
  planSeatSweep,
  planSeats,
  SEAT,
  type SeatRecord,
  writersOfClients,
} from "./seat.ts"
export {
  planSendMessage,
  planSendReach,
  planSendRoot,
  type SendRefusal,
  type SharedBlob,
} from "./send.ts"
export {
  type ModelLine,
  type NoModel,
  SETUP,
  SETUP_KEY,
  type SetupModel,
  type SetupRecord,
  type SetupSession,
  type SetupSubscription,
  type Shaping,
  SUBSCRIPTION_SETTING,
} from "./setup.ts"
export {
  laneReads,
  planForgottenReaders,
  planGoneLineages,
  planSharedLineages,
  SHARED_LINEAGE,
  type SharedLineage,
  type SharedRead,
  type SharedWriter,
  sharedTouches,
} from "./shared.ts"
export {
  DEFAULT_QUOTE_BYTES,
  isUtf8Text,
  planSaveBlob,
  readableBlobs,
  shareMarkdown,
  textBlobs,
} from "./shares.ts"
export { planKindSweep, planUndeclaredSweep, RECORD_SPECS } from "./specs.ts"
export type { SpinOff } from "./spin-off.ts"
export {
  decodeSshFact,
  planSshNews,
  SSH_FACT_TYPE,
  type SshFactMessage,
} from "./ssh-news.ts"
export { decodeStack, planStack, type StackMessage } from "./stack.ts"
export { planStartup } from "./startup.ts"
export {
  type Attributed,
  type JoinEvent,
  joinStart,
  joinStep,
  joinVerdict,
  OUTPUT_SPLIT,
  type OutputSplitRecord,
  outputSplitRecord,
  outputSplitWrite,
  planVerdictChange,
  settledSplit,
  type Verdict,
  type VerifiedSplit,
} from "./statement-output.ts"
export {
  CARRY_ON_TYPE,
  type CarryOnMessage,
  carryOnState,
  decodeCarryOn,
  planCarryOn,
  planStop,
  runStopper,
} from "./stop.ts"
export { THREAD } from "./thread.ts"
export {
  planTitling,
  replyTitle,
  TITLE_REQUEST_HEAD,
  type TitleConfig,
  type TitleTrigger,
  titleRequest,
  titleStillWanted,
} from "./title.ts"
export {
  canvasContextCards,
  canvasTitle,
  pinnedContextCards,
  planCanvasContext,
  planHeldAnswer,
  planLiveDigest,
  planPendingRunEndReport,
  planPinnedContext,
  planQueuedPop,
  planRelayAnswer,
  planRelayDelivery,
  planRoundAsk,
  planRoundNext,
  planRunEndReport,
  queuedTextCards,
  type RelayAnswer,
} from "./told.ts"
export { encodeUpdate, folderLatest, type UpdateMessage } from "./update.ts"
export {
  forkSource,
  LANE,
  LANE_FORK,
  type LaneForkRecord,
  PROJECT,
  PROJECT_KEY,
  type ProjectRecord,
  planForkEnd,
  planForkRedo,
  planLaneRecords,
  planTurn,
  planTurnRevision,
  REVISION,
  sourceHistory,
} from "./work.ts"
export {
  type WorkStripActivity,
  type WorkStripButton,
  type WorkStripState,
  type WorkStripView,
  workStripState,
  workStripView,
} from "./work-strip.ts"
