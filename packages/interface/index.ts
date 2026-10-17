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
export { placement } from "./align.ts"
export {
  appView,
  type CanvasRail,
  canvasRail,
  canvasWork,
  laneRootsOf,
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
  canvasStatus,
  doneThreads,
  type Item,
  type Level,
  type Moments,
  markOf,
  moving,
  type Status,
  threadStatus,
  threadWriters,
} from "./attention.ts"
export {
  addStateIntent,
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
  type CatchUps,
  CLEAR_COMMAND,
  type ControlWords,
  canvasMarkerWords,
  canvasPinnedMarkerWords,
  DISCARD_CARD,
  DISCARD_CARD_TITLE,
  HISTORY_TITLE,
  historyItemWords,
  historyWords,
  INVENTORY,
  KEEP,
  KEEP_TITLE,
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
  sizeWords,
  traceWords,
  writtenWords,
} from "./card-words.ts"
export {
  CLIP_ATTRIBUTE,
  CLIP_MIME,
  type Clip,
  type ClipFacts,
  clipOfFocus,
  planCopy,
  type Received,
  readPaste,
} from "./clip.ts"
export {
  type CellFace,
  type ClipboardCellView,
  clipboardCellView,
} from "./clipboard-cell.ts"
export type { Codec } from "./codec.ts"
export {
  COLUMN_MENU_LABEL,
  type ColumnMenuSection,
  columnHeadEnd,
} from "./column-menu.ts"
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
  type Column,
  type ColumnKey,
  type ColumnMode,
  keyText,
  type Pending,
  type Prefill,
  threadAnchor,
  type UnstartedMode,
  unstartedOf,
} from "./columns.ts"
export { matchCommands } from "./commands.ts"
export {
  type Completion,
  type CompletionOption,
  completion,
} from "./completion.ts"
export { copyText } from "./copy-text.ts"
export { plural } from "./counts.ts"
export {
  type Armed,
  type CanvasOver,
  type CardOver,
  DRAG_HANDLE,
  DRAG_START,
  type DragAt,
  type DragFrom,
  type DragSource,
  type DragVerdict,
  type DrawPlan,
  type DropMark,
  dragProps,
  dragVerdict,
  drawPlan,
  dropIntents,
  dropMark,
  type HoverOver,
  hoverOpens,
  ITEM_HOVER_MS,
  NOT_A_HANDLE,
  type Point,
  sidebarSpotAt,
  sourceOfElement,
} from "./drag.ts"
export type { Effect, IntentState } from "./effects.ts"
export {
  cardOfFace,
  DETAIL_ON,
  type Detail,
  type DrawnCard,
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
export type { Focus } from "./focus.ts"
export { claimFocus, type FocusKey } from "./focus-claim.ts"
export {
  type ColumnMotion,
  type FoldMotion,
  type FoldScene,
  planFoldMotion,
  type Rect,
} from "./fold-motion.ts"
export {
  type FoldedFace,
  type FoldedMark,
  foldedMark,
  foldedView,
  foldedWords,
  NO_MARK,
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
export {
  columnForeign,
  columnReadOnly,
  foreignWords,
} from "./foreign-column.ts"
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
  readersByCanvas,
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
  insertAt,
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
  columnProposals,
  NO_PROPOSAL_MEMORY,
  type ProposalButton,
  type ProposalFacts,
  type ProposalMemory,
  type ProposalPress,
  proposalView,
} from "./proposal-view.ts"
export {
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
  neighbourShifts,
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
  type SidebarView,
  sidebarView,
} from "./sidebar-view.ts"
export {
  elsewhereWords,
  holdsText,
  ownCards,
  type Signal,
  signalOfLevel,
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
export { type Upload, uploadBlob } from "./upload.ts"
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
