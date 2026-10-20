// @pinetrie/interface — what a person sees and can do, decided, for any
// client. It exports by name only what another package imports;
// a name only this package and its tests use is imported from its module.

export { type AccessView, accessWords } from "./access-view.ts"
export {
  type AccountItem,
  accountView,
  accountWords,
  inventoryWords,
} from "./account-view.ts"
export { addressWords, EDIT_AS_TEXT } from "./address-words.ts"
export { type AgentsRow, agentsRow, agentsWords } from "./agents-view.ts"
export {
  appView,
  type CanvasRail,
  canvasRail,
  canvasWork,
  laneRootEntries,
  NO_RAIL,
  type OpenProposedChanges,
  type RailStub,
  type ReadOnly,
  railStubWords,
  type SshAsk,
  type Stage,
  threadWork,
} from "./app-view.ts"
export {
  type AskDraw,
  type AskRow,
  type AskSummary,
  type FoldFacts,
  type FoldMemory,
  type FoldRow,
  foldMemory,
  planAskWork,
  type SummaryAnchor,
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
  DENSITIES,
  type Density,
  densityWords,
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
  needsYou,
  type RunEndLevel,
  STRIP_LEVEL,
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
  type BoardKey,
  type BoardSearch,
  type BoardShown,
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
  type CanvasTrash,
  canvasColumnView,
  canvasTrash,
  FOLD_CANVAS,
  type PlaceOnBoard,
  pinnedCountWords,
  RENAME_CANVAS_TITLE,
  RESTORE_WORDS,
  type TrashRow,
  trashHeading,
  trashKeepWords,
  trashWords,
  UNFOLD_CANVAS,
} from "./canvas-column-view.ts"
export {
  type CanvasColumn,
  type CardColumn,
  type CardView,
  defaultView,
  firstUnticked,
  heldByOthers,
  openColumns,
  type Strip,
  stripCards,
  type YourCanvasView,
} from "./canvas-columns.ts"
export {
  type Canvases,
  type CanvasThreads,
  canvasesOnBoard,
} from "./canvases.ts"
export {
  type CardFrameFacts,
  type CardFrameView,
  type CardTone,
  cardFrame,
  cardFrameWords,
  moveKey,
  moveWords,
  type QueueOn,
} from "./card-frame.ts"
export {
  clipFacts,
  type Landing,
  type PutHow,
  type PutSource,
  putLanding,
} from "./card-intents.ts"
export { cardKeyAct, newCardKeys } from "./card-keys.ts"
export {
  type EditorEvent,
  type EditorState,
  type EditorStep,
  editorState,
  free,
  shownBy,
  startText,
} from "./card-state.ts"
export {
  CLEAR_COMMAND,
  CLOSE_CARD,
  CLOSE_INVENTORY,
  type ControlWords,
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
  type NewCardBoxView,
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
export {
  type ClipboardCellView,
  type ClipSummary,
  clipboardCellView,
} from "./clipboard-cell.ts"
export type { Codec } from "./codec.ts"
export {
  COLUMN_MENU_LABEL,
  type ColumnHead,
  type ColumnMenuSection,
  columnHead,
  type HeadBox,
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
export { type ColumnStatus, columnStatus } from "./column-status.ts"
export {
  AGENT_MARK,
  columnView,
  composerPlace,
  detailsTitle,
  type HeadIcon,
  type HeadIdentity,
  type HeadOrigin,
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
  START_WORDS,
  startedWords,
  type ThreadDetails,
  textTokens,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
export {
  BOUND,
  type CardKey,
  type Column,
  type ColumnKey,
  type ColumnMode,
  isNextSendBranch,
  keyText,
  type Pending,
  type Prefill,
  threadAnchor,
  type UnstartedMode,
  unstartedMode,
} from "./columns.ts"
export { matchCommands } from "./commands.ts"
export {
  type Compact,
  type CompactBadge,
  type CompactFacts,
  type CompactMark,
  type CompactText,
  cardCompact,
  compactWords,
  DETAIL_ON,
  type Detail,
  type DrawnCard,
  type DrawnKind,
  KIND_ICON,
} from "./compact.ts"
export {
  type Completion,
  type CompletionOption,
  completion,
} from "./completion.ts"
export {
  type ConflictShown,
  conflictChoiceWords,
  conflictsView,
  conflictsWords,
} from "./conflicts-view.ts"
export { COPY_MESSAGE, copyText } from "./copy-text.ts"
export { countWords, type ListKind } from "./count-words.ts"
export { byteWords, plural, whenWords } from "./counts.ts"
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
  foldToggle,
  glanceCardId,
  type ListGlance,
  mediaColumnGlance,
  NO_MARK,
  noteColumnGlance,
  stripTitle,
  UNNAMED_THREAD,
} from "./folded-column-view.ts"
export { jjWordsIn, wordsIn } from "./folder-words.ts"
export {
  columnForeign,
  columnReadOnly,
  foreignWords,
} from "./foreign-column.ts"
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
  madeWords,
  restoreStatus,
  restoreWords,
} from "./history-view.ts"
export * from "./host-rules.ts"
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
export {
  type ImageEdge,
  imageSpot,
} from "./image-edge.ts"
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
  cardFlight,
  type Flight,
  INVENTORY_CLOSED,
  type InventoryAct,
  type InventoryShown,
  type InventoryState,
  inventoryReducer,
  isInventoryShown,
  PEEK_MS,
  type ShowHow,
} from "./inventory-state.ts"
export {
  type Bench,
  emptyBenchWords,
  inventoryCountWords,
  inventoryView,
} from "./inventory-view.ts"
export {
  canvasStrip,
  decodeLayout,
  drawnColumns,
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
  callStreams,
  type LiveWork,
} from "./live.ts"
export {
  addCommentWords,
  COMMENT,
  type MarginBeside,
  marginCountWords,
  shutMarginWords,
} from "./margin.ts"
export { addressMarkdown } from "./markdown-of.ts"
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
  messageReference,
  messageTools,
  selectionReference,
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
export {
  BACK,
  isPage,
  type PageName,
  pageWords,
  profileWords,
} from "./page.ts"
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
  type ShareChip,
  shareChip,
  shareSelection,
  shareStatus,
  UPLOADING,
} from "./paste.ts"
export {
  type AppPorts,
  perform,
} from "./perform.ts"
export {
  othersReading,
  othersWithValue,
  readReading,
  readReadingCanvases,
  readTyping,
  readTypingIn,
  seenBy,
} from "./presence.ts"
export {
  planReading,
  type TypedLast,
  typingDue,
} from "./presence-report.ts"
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
  type ProposalPress,
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
export {
  compactRail,
  type RailItem,
  type RailStretch,
} from "./rail.ts"
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
export {
  cardBeforeGap,
  keyMove,
  landing,
  pointerGap,
} from "./reorder.ts"
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
  planRootDrop,
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
  type SearchAct,
  type SearchResult,
  type SearchState,
  type SnippetPart,
  searchCorpus,
  searchOn,
  searchReducer,
  searchTexts,
} from "./search.ts"
export {
  type ColumnMatches,
  columnMatches,
  type MatchRow,
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
  NO_MODEL_LABEL,
  noModelLine,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  recipientWords,
  SEE_SETUP,
  sendable,
  sendButton,
  settleSend,
  spent,
  startWords,
} from "./send.ts"
export { type SetupView, setupView } from "./setup-view.ts"
export {
  credentialWords,
  fileStateWords,
  layerWords,
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
  unsentSignals,
  withFilled,
} from "./signals.ts"
export {
  type CanvasStart,
  type NewColumn,
  newCanvasButton,
  newColumnButton,
  type StartButton,
  type StartItem,
} from "./start-button.ts"
export {
  moveTitle,
  type ThreadCardHead,
  type ThreadMove,
  threadCardHeads,
} from "./thread-card.ts"
export {
  bareThreadGlance,
  focusTitle,
  glanceStatus,
  type PreviewRow,
  type ThreadFocus,
  type ThreadGlance,
  type ThreadPreview,
  threadFocus,
  threadGlance,
  threadOpening,
  threadPreview,
} from "./thread-glance.ts"
export {
  builtInIconUrl,
  type IconLookup,
  type ThreadIcon,
  threadIcon,
} from "./thread-icon.ts"
export {
  type CrossCanvasLink,
  crossCanvasLinks,
  heldWords,
  type LinkOpen,
  linkOpen,
  linkWords,
  opens,
  type ThreadLink,
  threadLink,
} from "./thread-link.ts"
export {
  callMark,
  callStatus,
  NO_MEMORY,
  REVEAL_MS,
  type RowBody,
  type RowLead,
  type RowMemory,
  type RowSummary,
  type RowView,
  type Run,
  rowLead,
  rowSummary,
  rowView,
  runningFor,
  toolBody,
} from "./tool-row.ts"
export { callLabel, callPurpose, toolWord } from "./tool-words.ts"
export {
  endTraces,
  keptTraces,
  seenBatches,
  traceGroups,
} from "./traces.ts"
