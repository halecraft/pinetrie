// @pinetrie/interface — what a person sees and can do, decided, for any
// client (ADR-0093). It exports by name only what another package imports;
// a name only this package and its tests use is imported from its module.

export {
  type AccountItem,
  accountView,
  accountWords,
  inventoryWords,
} from "./account-view.ts"
export { addressWords, EDIT_AS_TEXT } from "./address-words.ts"
export { type AgentsRow, agentsRow, agentsWords } from "./agents-view.ts"
export { placement } from "./align.ts"
export {
  appView,
  laneRootsOf,
  NO_RAIL,
  type OpenOffer,
  type RailStub,
  type ReadOnly,
  railStubWords,
  type Stage,
  type TaskRail,
  taskRail,
  taskWork,
  threadWork,
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
  askLine,
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
  doneThreads,
  type Item,
  LEVEL_CLASS,
  LEVEL_WORDS,
  type Level,
  type Moments,
  markOf,
  moving,
  type Status,
  taskStatus,
  threadStatus,
  threadWriters,
} from "./attention.ts"
export {
  addStateIntent,
  BOARD_SEARCH,
  type BoardKey,
  type BoardSearch,
  type BoardShown,
  type BoardSide,
  type BoardView,
  boardKeyAct,
  boardView,
  CLEAR_FILTER,
  type Count,
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
  tasksWords,
} from "./board-view.ts"
export {
  type CardColumn,
  type CardView,
  defaultView,
  heldByOthers,
  keyOfColumn,
  openColumns,
  type Strip,
  stripCards,
  type TaskColumn,
  type TaskView,
} from "./canvas-columns.ts"
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
export { cardKeyAct } from "./card-keys.ts"
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
  type CatchUps,
  CLEAR_COMMAND,
  canvasMarkerWords,
  closeAskWords,
  DISCARD,
  DISCARD_CARD,
  DISCARD_CARD_TITLE,
  HISTORY_TITLE,
  historyItemWords,
  historyWords,
  INVENTORY,
  KEEP_IN_INVENTORY,
  movedBackWords,
  NEW_PIN,
  NEW_PIN_PLACEHOLDER,
  NEW_PIN_TITLE,
  noticeKey,
  noticeWords,
  PINNED_EMPTY,
  PUT,
  PUT_TITLE,
  pinnedMarkerWords,
  retiredWords,
  sizeWords,
  TAKE_COPY,
  TAKE_COPY_INTO_INVENTORY,
  taskPinnedMarkerWords,
  traceWords,
  writtenWords,
} from "./card-words.ts"
export type { Codec } from "./codec.ts"
export {
  COLUMN_MENU_LABEL,
  type ColumnMenuItem,
  type ColumnMenuSection,
  columnMenu,
  FIRST_NOTE_COLUMN,
} from "./column-menu.ts"
export {
  branchColors,
  type ColumnView,
  earlierWords,
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
  promptParent,
  type ReserveStep,
  type ReviewTarget,
  START_WORDS,
  startedWords,
  type ThreadDetails,
  tokensOf,
  type WorkFacts,
  type WorkStrip,
  workingWords,
} from "./column-view.ts"
export {
  BOUND,
  branchesAt,
  type CardKey,
  type ClosableColumn,
  type Column,
  type ColumnKey,
  type ColumnMode,
  isClosable,
  keyText,
  type Pending,
  type Prefill,
  threadAnchor,
  type UnstartedMode,
  unstartedOf,
} from "./columns.ts"
export { matchCommands } from "./commands.ts"
export { copyText } from "./copy-text.ts"
export { plural } from "./counts.ts"
export type { Effect } from "./effects.ts"
export {
  cardOfFace,
  DETAIL_ON,
  type Detail,
  type DrawnKind,
  detailOf,
  type Face,
  type FaceOf,
  faceOf,
  KIND_ICON,
  type NoteColumnFace,
  noteColumnFace,
  type ReferenceFace,
  type TextFace,
  textFaceWords,
} from "./face.ts"
export {
  FOLD,
  type FoldedFace,
  foldedView,
  foldedWords,
  UNFOLD,
  UNNAMED_THREAD,
} from "./folded-column-view.ts"
export {
  behind,
  type FollowEvent,
  type FollowState,
  follow,
  initialFollow,
  type SeenEnd,
} from "./follow.ts"
export { gridKeyAct } from "./grid-keys.ts"
export type { GridView } from "./grid-view.ts"
export {
  inventoryThreads,
  planHeldRoots,
  rootEntriesOf,
} from "./held-roots.ts"
export {
  type OpenMenus,
  peopleHere,
  peopleIn,
  readerHeading,
  readersByTask,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"
export {
  type Identity,
  identityCodec,
  nameHint,
  parseIdentity,
  pictureProblem,
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
  type InboxView,
  type InboxWords,
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
export { type CardPreview, inventoryView } from "./inventory-view.ts"
export {
  decodeLayout,
  encodeLayout,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
  storedLayout,
  taskColumns,
  taskStrip,
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
  ADD_COMMENT,
  COMMENT,
  marginFaceWords,
  SHUT_MARGIN,
} from "./margin.ts"
export { markdownOf } from "./markdown-of.ts"
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
  queueHead,
  queueHeadPlan,
} from "./next.ts"
export {
  ADD_NOTE,
  NOTES_EMPTY,
  type NoteColumnView,
  noteColumnsOf,
  noteCountWords,
} from "./note-column-view.ts"
export {
  BACK,
  hashOfPage,
  PAGE_STATE,
  type PageName,
  pageOfHash,
  pageWords,
  planLeave,
  profileWords,
} from "./page.ts"
export { type KeyFocus, keyAct } from "./page-keys.ts"
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
} from "./paste.ts"
export {
  type AppPorts,
  perform,
} from "./perform.ts"
export {
  type Crop,
  cropSource,
  fitCrop,
  MOST_ZOOM,
  moveCrop,
  PICTURE_SIZE,
  pictureWords,
  zoomCrop,
} from "./picture-crop.ts"
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
} from "./publish-view.ts"
export {
  CARD_MIME,
  type ComposerPlacesStore,
  composerPlacesStore,
  DROP_ZONE,
  dropProps,
  type PutTarget,
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
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  recipientWords,
  sendable,
  sendButton,
  settleSend,
  spent,
  startWords,
  UPLOADING,
} from "./send.ts"
export {
  dropsWords,
  type ItemIcon,
  type ItemMenuItem,
  listKey,
  offeredByTask,
  pageTitle,
  renameIntent,
  type SidebarView,
  sidebarView,
  taskSprites,
} from "./sidebar-view.ts"
export {
  holdsText,
  ownCards,
  unsentSignals,
  withFilled,
} from "./signals.ts"
export {
  boardStateWords,
  FOLD_TASK,
  pinnedCountWords,
  RENAME_TASK_TITLE,
  TASK_LIST_HEADING,
  TASK_PINS_EMPTY,
  TASK_PINS_HEADING,
  type TaskColumnView,
  taskColumnView,
  UNFOLD_TASK,
} from "./task-column-view.ts"
export {
  NO_TASKS,
  type Tasks,
  type TaskThreads,
  tasksOf,
} from "./tasks.ts"
export {
  type ThreadCardHead,
  type ThreadMove,
  threadCardHeads,
} from "./thread-card.ts"
export {
  bareThreadFace,
  faceStatus,
  type PreviewRow,
  type ThreadFace,
  type ThreadPreview,
  threadFace,
  threadPreview,
} from "./thread-face.ts"
export {
  type CrossTaskLink,
  crossTaskLinks,
  heldWords,
  type LinkOpen,
  linkWords,
  openOf,
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
  type RowMemory,
  type RowSummary,
  type RowView,
  type Run,
  rowSummary,
  rowView,
  runningFor,
  toolBody,
} from "./tool-row.ts"
export { callLabel, toolWord } from "./tool-words.ts"
export {
  keptTraces,
  seenBatches,
  traceGroups,
  tracesAt,
} from "./traces.ts"
export {
  type TextUpload,
  uploadImage,
  uploadText,
} from "./upload.ts"
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
