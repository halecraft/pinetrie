// @pinetrie/interface — what a person sees and can do, decided, for any
// client. A name only this package and its tests use is imported from its
// module.
//
// Written by `pnpm run indexes`: each name some file imports through it, from
// the module that declares it, and nothing else.

export { type AccessView, accessWords } from "./access-view.ts"
export {
  type AccountItem,
  accountView,
  accountWords,
  inventoryWords,
} from "./account-view.ts"
export { addressWords, EDIT_AS_TEXT } from "./address-words.ts"
export { agentsRow, agentsWords } from "./agents-view.ts"
export {
  acceptedRefusal,
  branchOutRefusal,
  copyRefusal,
  gateRefusal,
  HELD_WORDS,
  imageRefusal,
  openRefusal,
  publishUndone,
  spinOffRefusal,
} from "./answer-words.ts"
export {
  appView,
  canvasRail,
  canvasWork,
  laneRootEntries,
  type OpenProposedChanges,
  type RailStub,
  type ReadOnly,
  railStubWords,
  type SshAsk,
  type Stage,
  threadWork,
} from "./app-view.ts"
export {
  type AskRow,
  type AskSummary,
  type FoldMemory,
  foldMemory,
  planAskWork,
  toggled,
} from "./ask-fold.ts"
export type { Segment } from "./ask-segments.ts"
export {
  type AskView,
  askView,
  type ColumnRow,
  lastEndedAsk,
  pathRows,
  rowHolds,
} from "./ask-view.ts"
export {
  ASK_FILES_TITLE,
  askFoldWords,
  askLine,
  type Density,
  LEFT_WORDS,
  workWords,
} from "./ask-words.ts"
export {
  arrivals,
  attentionItems,
  attentionWords,
  canvasStatus,
  doneThreads,
  type Item,
  type Level,
  type Moments,
  markLevel,
  moving,
  type StandingRunEnd,
  type Status,
  standingRunEnds,
  stripStates,
  threadStatus,
  threadWriters,
} from "./attention.ts"
export {
  addStateIntent,
  BOARD_MOVE_LABEL,
  type BoardSide,
  type BoardView,
  boardKeyAct,
  boardView,
  CLEAR_FILTER,
  type Count,
  canvasesWords,
  clickClosesBoard,
  filterTitle,
  filterWords,
  keptWords,
  type MarkAction,
  markWords,
  nameStateIntent,
  parseSearch,
  readyWords,
  type StateSignals,
  type StripState,
  searchWords,
  stateWords,
  type ThreadCard,
} from "./board-view.ts"
export {
  boardPlaceWords,
  CANVAS_LIST_HEADING,
  CANVAS_PINS_EMPTY,
  CANVAS_PINS_HEADING,
  type CanvasColumnView,
  canvasColumnView,
  canvasTrash,
  FOLD_CANVAS,
  pinnedCountWords,
  RENAME_CANVAS_TITLE,
  RESTORE_WORDS,
  trashHeading,
  trashKeepWords,
  trashWords,
  UNFOLD_CANVAS,
} from "./canvas-column-view.ts"
export {
  type CardColumn,
  heldByOthers,
  openColumns,
  type Strip,
  stripCards,
} from "./canvas-columns.ts"
export { canvasesOnBoard } from "./canvases.ts"
export {
  type CardFrameFacts,
  type CardFrameView,
  cardFrame,
  cardFrameWords,
  moveKey,
  moveWords,
} from "./card-frame.ts"
export { clipFacts, type PutHow } from "./card-intents.ts"
export { cardKeyAct, newCardKeys } from "./card-keys.ts"
export {
  type EditorEvent,
  type EditorState,
  editorState,
  free,
  shownBy,
  startText,
} from "./card-state.ts"
export {
  CLEAR_COMMAND,
  CLOSE_CARD,
  CLOSE_INVENTORY,
  canvasMarkerWords,
  canvasPinnedMarkerWords,
  HISTORY_TITLE,
  historyItemWords,
  historyWords,
  hostCardLine,
  INVENTORY,
  type LatestSources,
  movedBackWords,
  NEW_PIN,
  NEW_PIN_TITLE,
  newCardBox,
  noticeKey,
  noticeWords,
  PINNED_EMPTY,
  PUT,
  PUT_TITLE,
  pinnedMarkerWords,
  retiredWords,
  SAVE,
  SAVE_TITLE,
  TRASH_CARD_TITLE,
  TRASH_SELECTED,
  titleWords,
  tokenSizeWords,
  traceWords,
  writtenWords,
} from "./card-words.ts"
export {
  type Clip,
  type ClipFacts,
  clipJson,
  clipOfFocus,
  clipOfJson,
  clipText,
} from "./clip.ts"
export { type ClipboardCellView, clipboardCellView } from "./clipboard-cell.ts"
export type { Codec } from "./codec.ts"
export {
  COLUMN_MENU_LABEL,
  type ColumnHead,
  type ColumnMenuSection,
  columnHead,
} from "./column-menu.ts"
export type { ColumnMotion } from "./column-motion.ts"
export {
  branchColors,
  type ColumnView,
  earlierWords,
  projectColumns,
  threadTrack,
  trackIndex,
} from "./column-paths.ts"
export {
  AGENT_MARK,
  buttonCommand,
  columnView,
  composerPlace,
  type HeadIcon,
  type HeadIdentity,
  type HeadLine,
  type HeadOrigin,
  handleTitle,
  headLane,
  identityWords,
  joinWords,
  type LaneJoin,
  newPinPlace,
  type PinnedMarker,
  pinnedMarkers,
  pinnedStatus,
  promptParent,
  type ReserveStep,
  type ReviewTarget,
  reviewToggleTitle,
  textTokens,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
export {
  type Column,
  type ColumnKey,
  isNextSendBranch,
  type Pending,
  type Prefill,
  threadAnchor,
  unstartedMode,
} from "./columns.ts"
export {
  type Compact,
  compactWords,
  type Detail,
  type DrawnCard,
  type DrawnKind,
  KIND_ICON,
} from "./compact.ts"
export { type CompletionOption, completion } from "./completion.ts"
export {
  type ConflictShown,
  conflictsView,
  conflictsWords,
} from "./conflicts-view.ts"
export { COPY_MESSAGE, copyText } from "./copy-text.ts"
export { countWords, type ListKind } from "./count-words.ts"
export { plural } from "./counts.ts"
export {
  type CanvasOver,
  type CanvasSource,
  type CardOver,
  type CardSource,
  type DragAt,
  type DragFrom,
  type DragSource,
  dropIntents,
  type ImageSource,
  type PlannedDrop,
  planDrop,
} from "./drag.ts"
export type { Effect, IntentState } from "./effects.ts"
export type { Focus } from "./focus.ts"
export { claimFocus, type FocusKey } from "./focus-claim.ts"
export {
  type FoldedGlance,
  type FoldedMark,
  foldedMark,
  foldedView,
  foldedWords,
  glanceCardId,
  NO_MARK,
} from "./folded-column-view.ts"
export { jjWordsIn } from "./folder-words.ts"
export { columnForeign, columnReadOnly } from "./foreign-column.ts"
export { gridKeyAct } from "./grid-keys.ts"
export type { GridView } from "./grid-view.ts"
export {
  directoryRootEntries,
  inventoryThreads,
  planHeldRoots,
} from "./held-roots.ts"
export {
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByCanvas,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"
export {
  type HistoryEntry,
  type HistoryView,
  historyView,
  restoreStatus,
  restoreWords,
} from "./history-view.ts"
export {
  type AcceptedRecord,
  BLOCK_PROPERTY,
  type BlockNode,
  blankQueued,
  blockKey,
  CANVAS_BUSY_REASON,
  type CardHistoryRecord,
  type CardOnCanvas,
  type CardTitleRecord,
  type CommandSummary,
  canvasLines,
  canvasList,
  canvasPinnedCards,
  columnGlances,
  type DigestRecord,
  decodeRevisionReview,
  diffUrl,
  displayName,
  effectiveBase,
  entryMarginCounts,
  type MarginCard,
  marginCards,
  marginCounts,
  markBlocks,
  movedBackBy,
  type OutputSplitRecord,
  pinnedCardsAtEnd,
  type QueuedCard,
  type QueuedText,
  queuedOn,
  type RootRecord,
  type RunEndReportRecord,
  reachableAgents,
  readableThreadName,
  reviewUrl,
  type SeatRecord,
  shareMarkdown,
  TRASH_KEEP_MS,
  type TraceRecord,
  taskBoard,
  tasksInArchive,
  textBlocks,
  threadReach,
  traceEnd,
  UNTITLED_IMAGE,
  unstartedThreads,
  type WorkflowState,
  type WorkStripButton,
  type WorkStripState,
  writersOfClients,
  yourCard,
} from "./host-rules.ts"
export {
  type Identity,
  identityCodec,
  nameHint,
  PICTURE_MOST,
  parseIdentity,
  pictureProblem,
  planRename,
  reconcileName,
  renameProblem,
} from "./identity.ts"
export { type ImageEdge, imageSpot } from "./image-edge.ts"
export {
  type Inbox,
  type InboxItem,
  inboxMentions,
  isUnseen,
  markAllSeen,
  markSeen,
  seenNow,
} from "./inbox.ts"
export {
  type InboxSection,
  type InboxView,
  type InboxWords,
  inboxCount,
  inboxView,
  inboxWords,
  NOT_NEEDED,
} from "./inbox-view.ts"
export {
  type ColumnAct,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
export {
  type Flight,
  INVENTORY_CLOSED,
  type InventoryAct,
  type InventoryState,
  inventoryReducer,
  isInventoryShown,
  PEEK_MS,
} from "./inventory-state.ts"
export {
  emptyBenchWords,
  inventoryCountWords,
  inventoryView,
} from "./inventory-view.ts"
export {
  canvasStrip,
  decodeLayout,
  encodeLayout,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
  storedLayout,
  unlisted,
} from "./layout.ts"
export { leftLine } from "./left.ts"
export {
  type ListWidth,
  listFoldWords,
  listWidthCodec,
  shownWidth,
} from "./list-width.ts"
export {
  callStatementStreams,
  callStreams,
  type LiveWork,
  type StatementStreams,
} from "./live.ts"
export {
  type MachineStatusView,
  machineStatus,
  machineWords,
  sizeWords,
} from "./machine.ts"
export {
  addCommentWords,
  COMMENT,
  type MarginBeside,
  marginCountWords,
  shutMarginWords,
} from "./margin.ts"
export {
  commentVersionWords,
  type ImageView,
  leftOutWords,
  MEDIA_EMPTY,
  type MediaColumnView,
  mediaColumns,
  putOnCanvasButton,
  versionWords,
} from "./media-column-view.ts"
export {
  type MessageAct,
  type MessageTools,
  messageTools,
  showsText,
} from "./message-tools.ts"
export { speakerWords } from "./names.ts"
export {
  ADD_TO_QUEUE,
  type NextButton,
  type NextItem,
  nextButtonWords,
  nextItemWords,
  nextWords,
  type QueueHead,
  queuedCardsDrawn,
  queueHead,
  queueHeadPlan,
} from "./next.ts"
export {
  canvasNoteColumns,
  NOTES_EMPTY,
  type NoteColumnView,
} from "./note-column-view.ts"
export { actingSaid } from "./outcome-words.ts"
export { BACK, isPage, type PageName, pageWords, profileWords } from "./page.ts"
export { keyAct } from "./page-keys.ts"
export {
  type ColorSlot,
  rootSeed,
  SLOTS,
  stringHash,
  trackSlot,
} from "./palette.ts"
export {
  imageFiles,
  insertSnippet,
  pastedFiles,
  type Selection,
  SHARE_FILE,
  shareChip,
  shareSelection,
  shareStatus,
  UPLOADING,
} from "./paste.ts"
export { type AppPorts, perform } from "./perform.ts"
export {
  othersReading,
  othersWithValue,
  readReading,
  readReadingCanvases,
  readTyping,
  readTypingIn,
  seenBy,
} from "./presence.ts"
export { planReading, type TypedLast, typingDue } from "./presence-report.ts"
export {
  type HeldView,
  participantsIn,
  readHeldIndex,
  readHeldLanes,
  readParticipantNames,
  readParticipantPictures,
  readRoots,
  readSessionFacts,
  type SessionFacts,
} from "./projection.ts"
export {
  columnProposals,
  NO_PROPOSAL_MEMORY,
  type ProposalButton,
  type ProposalFacts,
  type ProposalMemory,
  proposalView,
} from "./proposal-view.ts"
export {
  historyLink,
  publishToast,
  publishView,
  publishWords,
} from "./publish-view.ts"
export {
  type CanvasPut,
  type ComposerPlacesStore,
  composerPlacesStore,
  DROP_ZONE,
  dropProps,
  type PutTarget,
  targetOfElement,
  targetOfFocus,
} from "./put-target.ts"
export { compactRail, type RailItem, type RailStretch } from "./rail.ts"
export {
  capsulePick,
  columnLandmarks,
  RAIL_LABEL,
  railItems,
  railKeep,
  railRings,
  railSpots,
  railView,
  type StretchFill,
  stretchFill,
  stretchWords,
  type Tick,
} from "./rail-view.ts"
export { cardBeforeGap, pointerGap } from "./reorder.ts"
export {
  DIFF_LINES_SHOWN,
  diffLines,
  type FileRow,
  type Loaded,
  type MediaRow,
  type MediaShown,
  MOVED_UNCHANGED,
  type ReviewPref,
  type ReviewPrefs,
  reviewPrefWords,
  reviewView,
  revisionReadWords,
  sectionState,
} from "./review.ts"
export {
  type MessageCount,
  messageCount,
  messageCountTitle,
  NO_TEXT,
  planTitle,
  renameKey,
  taskLabels,
  taskSummaries,
} from "./root-label.ts"
export {
  landingIn,
  placeAfter,
  ROOT_DROP_ZONE,
  ROOT_GROUP_ZONE,
  type RootDrag,
  type RootTarget,
  rootDropProps,
  rootGroupProps,
  rootTargetOfElement,
} from "./root-target.ts"
export { sameData } from "./same-data.ts"
export {
  parseQuery,
  type SearchResult,
  type SearchState,
  searchCorpus,
  searchOn,
  searchReducer,
  searchTexts,
} from "./search.ts"
export {
  type ColumnMatches,
  columnMatches,
  matchCountWords,
  SEARCH_CLEAR,
  SEARCH_CLOSE_TITLE,
  SEARCH_DONE,
  SEARCH_DONE_TITLE,
  SEARCH_FIELD_LABEL,
  SEARCH_OPEN_TITLE,
  searchLine,
} from "./search-view.ts"
export {
  type ButtonWords,
  baseChoices,
  type ColumnHow,
  type ComposerMode,
  forkWords,
  noModelLine,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  recipientWords,
  SEE_SETUP,
  sendable,
  sendButton,
  sendMore,
  settleSend,
  spent,
  startWords,
} from "./send.ts"
export { type SetupView, setupView } from "./setup-view.ts"
export {
  fileStateWords,
  noModelWords,
  originWords,
  refusalWords,
  setupPageWords,
  subscriptionWords,
} from "./setup-words.ts"
export {
  canvasIcons,
  dropsWords,
  type ItemIcon,
  type ItemMenuItem,
  listKey,
  openProposedByCanvas,
  pageTitle,
  readyProposed,
  renameIntent,
  SIDEBAR_WORDS,
  type SidebarView,
  sidebarView,
} from "./sidebar-view.ts"
export {
  elsewhereWords,
  holdsText,
  NO_STATUS_WORDS,
  ownCards,
  type Signal,
  signalWords,
  statusSignal,
  statusWord,
  statusWords,
  unsentSignals,
  withFilled,
} from "./signals.ts"
export { newColumnButton, type StartButton } from "./start-button.ts"
export {
  moveTitle,
  type ThreadCardHead,
  threadCardHeads,
} from "./thread-card.ts"
export {
  aboutKind,
  aboutText,
  aboutTooltip,
  type ThreadGlance,
  type ThreadPreview,
  threadGlance,
  threadPreview,
} from "./thread-glance.ts"
export { builtInIconUrl, type ThreadIcon, threadIcon } from "./thread-icon.ts"
export {
  type CrossCanvasLink,
  crossCanvasLinks,
  linkWords,
  opens,
  type ThreadLink,
  threadLink,
} from "./thread-link.ts"
export {
  callMark,
  callSplits,
  callStatus,
  liveRowSplit,
  NO_MEMORY,
  REVEAL_MS,
  type RowMemory,
  type Run,
  rowLead,
  rowSummary,
  rowView,
  runningFor,
  storedRowSplit,
  toolBody,
} from "./tool-row.ts"
export { callLabel, callPurpose, toolWord } from "./tool-words.ts"
export { endTraces, keptTraces, seenBatches, traceGroups } from "./traces.ts"
