// @pinetrie/interface — what a person sees and can do, decided, for any
// client (ADR-0093). It exports by name only what another package imports;
// a name only this package and its tests use is imported from its module.

export { placement } from "./align.ts"
export {
  appView,
  hereRail,
  laneRootsOf,
  type OpenOffer,
  type ReadOnly,
  workAnywhere,
} from "./app-view.ts"
export {
  type AtTop,
  askAtTop,
  sameAtTop,
  type WorkBox,
} from "./ask-bar.ts"
export {
  type AskDraw,
  type AskRow,
  type FoldFacts,
  type FoldMemory,
  type FoldRow,
  foldMemory,
  planAskWork,
  toggled,
} from "./ask-fold.ts"
export {
  type Segment,
  segmentPath,
} from "./ask-segments.ts"
export {
  type AskView,
  askView,
  type ColumnRow,
  columnRows,
  lastEndedAsk,
} from "./ask-view.ts"
export {
  askWords,
  DENSITIES,
  type Density,
  densityWords,
  type FoldPart,
  LEFT_WORDS,
  workWords,
} from "./ask-words.ts"
export {
  arrivals,
  attentionOf,
  attentionWords,
  doneRoots,
  type Item,
  LEVEL_CLASS,
  LEVEL_WORDS,
  type Level,
  type Moments,
  markOf,
  moving,
  rootStatus,
  type Status,
  threadWriters,
} from "./attention.ts"
export {
  type BoardItem,
  type BoardSide,
  type BoardView,
  boardView,
  clickClosesBoard,
  closedWords,
  nameStateIntent,
  readyWords,
  type StripState,
  stripWords,
} from "./board-view.ts"
export { reorderOf } from "./card-intents.ts"
export { cardKeyAct } from "./card-keys.ts"
export {
  cardMarks,
  holdsText,
  ownCards,
  withFilled,
} from "./card-marks.ts"
export {
  type EditorEvent,
  type EditorState,
  type EditorStep,
  editorState,
  free,
  needsCard,
  shownBelow,
  shownBy,
  startText,
} from "./card-state.ts"
export {
  type CatchUps,
  CLEAR_COMMAND,
  cardStatus,
  closeAskWords,
  commandNote,
  DISCARD,
  HISTORY,
  HISTORY_TITLE,
  historyWords,
  INVENTORY,
  KEEP_IN_INVENTORY,
  movedBackWords,
  NEW_CARD,
  NEW_CARD_TITLE,
  NEW_PIN,
  NEW_PIN_PLACEHOLDER,
  NEW_PIN_TITLE,
  PIN,
  PIN_TITLE,
  PINNED_EMPTY,
  PUT,
  PUT_TITLE,
  pinnedMarkerWords,
  pinnedStatusWords,
  pinnedWords,
  queuedWords,
  REMOVE,
  refusalKey,
  refusalWords,
  reorderWords,
  retiredWords,
  sizeWords,
  TAKE_COPY_INTO_INVENTORY,
  TAKE_INTO_INVENTORY,
  TAKE_INTO_INVENTORY_TITLE,
  traceWords,
  UNPIN,
  UNQUEUE,
  writtenWords,
} from "./card-words.ts"
export type { Codec } from "./codec.ts"
export {
  branchColors,
  type ColumnView,
  projectColumns,
} from "./column-paths.ts"
export {
  AGENT_MARK,
  bannerUrl,
  columnView,
  composerPlace,
  detailsTitle,
  type HeadBanner,
  type HeadIdentity,
  type HeadOrigin,
  headLane,
  identityWords,
  joinWords,
  type LaneJoin,
  newPinAt,
  type PinnedMarker,
  pinnedMarkers,
  pinnedStatus,
  type QueueControls,
  queueControlWords,
  type ReserveStep,
  type ReviewTarget,
  type RunButton,
  runWords,
  START_WORDS,
  startedWords,
  type ThreadDetails,
  tokensOf,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
export {
  type Column,
  isAnchored,
  type Pending,
  type Prefill,
} from "./columns.ts"
export { matchCommands } from "./commands.ts"
export { copyIntoInventoryText } from "./copy-into-inventory-text.ts"
export { copyText } from "./copy-text.ts"
export { plural } from "./counts.ts"
export type { Effect } from "./effects.ts"
export {
  behind,
  type FollowEvent,
  type FollowState,
  follow,
  initialFollow,
  type SeenEnd,
} from "./follow.ts"
export {
  planHeldRoots,
  rootEntriesOf,
} from "./held-roots.ts"
export {
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByRoot,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"
export {
  type Identity,
  identityCodec,
  nameHint,
  parseIdentity,
  planRename,
  reconcileName,
  renameProblem,
} from "./identity.ts"
export {
  type Inbox,
  type InboxItem,
  isUnseen,
  markAllSeen,
  markSeen,
  mentionsOf,
  seenNow,
} from "./inbox.ts"
export {
  type InboxSection,
  inboxCount,
  inboxView,
  inboxWords,
} from "./inbox-view.ts"
export {
  type ColumnAct,
  claimFocus,
  type Intent,
  nameEffects,
  planIntent,
} from "./intent.ts"
export {
  type Dock,
  dockCodec,
  snapTo,
} from "./inventory-dock.ts"
export { keyAct } from "./inventory-keys.ts"
export { inventoryView } from "./inventory-view.ts"
export {
  columnsOf,
  decodeLayout,
  encodeLayout,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
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
  type MessageAct,
  type MessageTools,
  messageTools,
  showsText,
} from "./message-tools.ts"
export {
  cardHeading,
  speakerLabel,
  withContributors,
} from "./names.ts"
export {
  dropsWords,
  type ItemIcon,
  type ItemMenuItem,
  listKey,
  type OpenListView,
  offeredByRoot,
  openListView,
  pageTitle,
  renameIntent,
  rootSprites,
} from "./open-list-view.ts"
export {
  type ColorSlot,
  rootSeed,
  SLOTS,
  stringHash,
  trackSlot,
} from "./palette.ts"
export {
  imageMarkdown,
  insertAt,
  pastedFiles,
  type Selection,
  uploadImage,
} from "./paste.ts"
export {
  type AppPorts,
  perform,
} from "./perform.ts"
export {
  readingAt,
  seenBy,
  whoIsAt,
} from "./presence.ts"
export {
  planReading,
  type TypedLast,
  typingDue,
} from "./presence-report.ts"
export {
  type HeldView,
  readHeldLanes,
  readSessionFacts,
} from "./projection.ts"
export {
  publishToast,
  publishView,
  publishWords,
  resolveIntent,
} from "./publish-view.ts"
export {
  CARD_MIME,
  type ComposerPlacesStore,
  composerPlacesStore,
  DROP_ZONE,
  dropProps,
  targetOfElement,
} from "./put-target.ts"
export {
  compactRail,
  type RailItem,
  type RailStretch,
} from "./rail.ts"
export {
  columnLandmarks,
  pickAt,
  railItems,
  railKeep,
  railView,
  type StretchFill,
  stretchFill,
  stretchWords,
  type Tick,
} from "./rail-view.ts"
export {
  edgeScroll,
  gapAt,
  keyMove,
  landing,
} from "./reorder.ts"
export {
  DIFF_LINES_SHOWN,
  diffLines,
  type FileRow,
  type Loaded,
  type ReviewPref,
  reviewPrefWords,
  reviewView,
  sectionState,
} from "./review.ts"
export {
  firstLinesOf,
  labelsOf,
  type MessageCount,
  messageCount,
  messageCountTitle,
  NO_TEXT,
  planTitle,
  renameKey,
  summariesOf,
} from "./root-label.ts"
export {
  encodeRootDrag,
  landingIn,
  parseRootDrag,
  placeAfter,
  planRootDrop,
  ROOT_DROP_ZONE,
  ROOT_GROUP_ZONE,
  ROOT_MIME,
  type RootDrag,
  type RootTarget,
  rootDropProps,
  rootGroupProps,
  rootTargetOfElement,
} from "./root-target.ts"
export { sameData } from "./same-data.ts"
export {
  type ScreenMemory,
  screenMemory,
} from "./screen-memory.ts"
export {
  type ButtonWords,
  baseChoices,
  type ColumnHow,
  type ComposerMode,
  forkWords,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  recipientWords,
  sendable,
  sendButton,
  settleSend,
  spent,
  UPLOADING,
  whereChoices,
  whereWords,
} from "./send.ts"
export {
  CALL_MARK,
  callStatus,
  click,
  NO_MEMORY,
  REVEAL_MS,
  type RowMemory,
  rowSize,
  toolBody,
} from "./tool-row.ts"
export {
  keptTraces,
  seenBatches,
  traceGroups,
  tracesAt,
} from "./traces.ts"
export {
  type Box,
  keepSpot,
  placeAt,
  railScroll,
  type Span,
  type Spot,
  type SpotStore,
  sameSpan,
  spotFor,
  spotOf,
  spotStore,
  type ViewportStore,
  viewportStore,
  visibleSpan,
} from "./viewport.ts"
