// web-core — the web client's own decisions, from the browser's inputs.
//
// Written by `pnpm run indexes`: each name some file imports through it, from
// the module that declares it, and nothing else.

export { placement } from "./align.ts"
export { type AtTop, askAtTop, sameAtTop, type WorkBox } from "./ask-bar.ts"
export {
  CLIP_ATTRIBUTE,
  CLIP_MIME,
  planCopy,
  readPaste,
} from "./clip-carrier.ts"
export {
  type Armed,
  DRAG_HANDLE,
  DRAG_START,
  type DropMark,
  dragProps,
  drawPlan,
  type HoverOver,
  hoverOpens,
  ITEM_HOVER_MS,
  NOT_A_HANDLE,
  sidebarSpot,
  sourceOfElement,
} from "./drag.ts"
export { edgeScroll } from "./edge-scroll.ts"
export { entryRevealScroll } from "./entry-reveal.ts"
export {
  type FoldMotion,
  type FoldScene,
  planFoldMotion,
  type Rect,
} from "./fold-motion.ts"
export {
  behind,
  type FollowEvent,
  type FollowState,
  follow,
  initialFollow,
  type SeenEnd,
} from "./follow.ts"
export { imageClick } from "./image-click.ts"
export { imageEdge } from "./image-edge.ts"
export { type Dock, dockCodec, snappedDock } from "./inventory-dock.ts"
export { keptImages } from "./kept-images.ts"
export { hashOfPage, PAGE_STATE, pageOfHash, planLeave } from "./page-url.ts"
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
export { type BoxPlacement, placeBox } from "./popover-place.ts"
export { type ScreenMemory, screenMemory } from "./screen-memory.ts"
export { sparkPath } from "./sparkline.ts"
export {
  THEME_HEADING,
  THEMES,
  type Theme,
  themeAttribute,
  themeCodec,
  themeWords,
} from "./theme.ts"
export {
  type Box,
  columnSpot,
  keepSpot,
  railScroll,
  type Span,
  type Spot,
  type SpotStore,
  sameSpan,
  spotFor,
  spotScrollTop,
  spotStore,
  type ViewportStore,
  viewportStore,
  visibleSpan,
} from "./viewport.ts"
