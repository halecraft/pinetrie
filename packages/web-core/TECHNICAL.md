# `@pinetrie/web-core` — technical notes

The web client's own decisions (ADR-0194): what it decides from the
browser's inputs, pixels, a pointer, the order the browser dispatches
events in, animation frames, an element's attributes, a clipboard's MIME
types, the URL's hash and history. `@pinetrie/web` is its shell: the
components and hooks measure, listen and draw, and decide nothing these
modules decide. What any client decides alike is `@pinetrie/interface`'s
(`packages/interface/TECHNICAL.md`); a terminal takes nothing from here.

## The rule, and its fence

- **A module is here when its inputs or constants are the browser's.** One
  a terminal would call with its own inputs, and keep what it returns, is
  interface's. A module that held both halves split (S269): `foldMotion`
  (interface's `column-motion.ts`) and `planFoldMotion` (`fold-motion.ts`);
  `imageSpot` and `imageEdge` (`image-edge.ts`); the page's names and words
  (interface's `page.ts`) and its hash and history (`page-url.ts`); what a
  copy takes (interface's `clip.ts`) and how the browser's clipboard
  carries it (`clip-carrier.ts`); what a drop does (interface's `drag.ts`)
  and how a drag is read and drawn (`drag.ts`).
- **It declares only `@pinetrie/core` and `@pinetrie/interface`**
  (`workspace.test.ts`), so React, the DOM's packages and the page's
  components do not resolve here, in the type check, Vitest and Vite
  alike. `tsconfig.pure.json` checks it with no DOM, no Node types and
  only the globals `pure-globals.d.ts` declares. A DOM type a module once
  took is a structural one (`popover-place.ts`' trigger box,
  `image-click.ts`' modifier keys).
- **How the page draws stays the page's**, pure or not: `React.memo`'s
  rules (`same-props.ts`, `message-props.ts`) and the palette's colours,
  checked against `index.html` (`colors.ts`).
- **`index.ts` is written by `pnpm run indexes`** (`scripts/indexes.ts`):
  by name, exactly what the page imports through it.

## A fold in motion (`fold-motion.ts`, ADR-0137)

`planFoldMotion` decides how a column moves into its strip or out of it,
from boxes the page measured where the column is wide (`FoldScene`) and
the strip's geometry its CSS declares; the page plays it
(`packages/web/TECHNICAL.md`, "Folding in motion"). A fold and an unfold
take the same scene and differ only in which way their frames run. Which
column folds, and which way, is interface's `foldMotion`.

- **The strip is predicted, both ways**: at the wide column's left and
  top, its name centred across `geometry.width` at `nameTop`, a line high
  and the wide name long, its mark centred at `markTop`, its toggle and its
  box each centred in their rows (`toggleTop` and `toggleHeight`, `boxTop`
  and `boxHeight`; a strip with no box, the canvas column's, fades it). An
  unfold's strip
  lies where the column now starts, so it needs no measuring either. The
  browser suite's check of the turn proves the prediction is where the CSS
  draws the strip.
- **The turn** (S167): the wide name turned 90° clockwise about its own
  top-left, then moved so its right edge meets the strip name's and its
  top its top. At the same font size every glyph lands exactly. A name
  that wraps (its height not `line`), outgrows `nameMax` or is missing does
  not turn: it fades with the rest.
- **One edge, sampled** (`FoldFrame`): eased out over 8 samples, played
  linearly between, the column's right edge and every column after it.
  At each sample the edge stays `CLEAR` px right of the turning name and
  the mark, where an edge eased alone would cut a long name mid-turn.
- **The clamp**: folding can shrink the strip's scroll below where it
  stands; the browser then clamps it and every column moves right. Every
  column moves by it as the fold goes, so the commit's jump is part of
  the motion.
- **Nothing moves** under reduced motion, during a drag, for a column out
  of the strip's view, or one already no wider than its strip.

## A drag, read and drawn (`drag.ts`, `edge-scroll.ts`, `image-edge.ts`, ADR-0134)

What the page's one drag engine (`packages/web/use-drag.ts`) decides from
the pointer, as values; what a drop there does is interface's (`planDrop`,
`dropIntents`, `packages/interface/TECHNICAL.md`, "Drags").

- **A handle is marked by attributes** (`dragProps`) and read back
  (`sourceOfElement`); `DRAG_HANDLE` matches every handle, `NOT_A_HANDLE`
  where a press starts no drag, and a press is a drag once it moves
  `DRAG_START` px.
- **What a frame draws is a value** (`drawPlan`): the dragged element's
  translate (never a scale, a rotation or a shadow, S153), the ghost's
  position off the strip, each column's shift (`neighbourShifts`, by the
  columns' widths in px), the target's mark (`dropMark`), the handle's lean,
  and what a hold there opens (`opens`). S153's drawing conditions are its
  unit tests. A mark names its attribute too: `root` for a canvas's
  landing (`data-root-drop`), any other for `data-drop-mark`.
- **A sidebar row splits in quarters** (`sidebarSpot`): its top and
  bottom are between rows, its middle onto its canvas. Only a card's drag
  reads it: a canvas's has no put target (`CanvasOver`), and reorders among
  the rows (`landingIn`).
- **What a hold opens is decided from the target** (`heldOpens`), after
  `ITEM_HOVER_MS`: a card onto a sidebar canvas (its row's middle half)
  opens that canvas, a card over ▦ opens the board, a card over the
  inventory's toggle opens the panel (a drop there takes, aiming at no
  slot), and a canvas's drag opens nothing (ADR-0134, ADR-0171). Only what
  a card could be dropped onto opens, so the ring never fills where the
  drop would make a new canvas. When the shell decided this from the row
  under the pointer, for every source, a canvas dragged over another in
  the sidebar filled the ring and opened it, and looked like a drop *into*
  that canvas.
- **An image's edges** (`imageEdge`): a fixed band at each edge,
  `EDGE_BAND_PX` or a quarter of a small image, along its height, or its
  width two to a row; interface's `imageSpot` turns the edge into a spot.
- **A drag near an edge scrolls** (`edgeScroll`): faster the nearer the
  edge, within `EDGE_ZONE` px, at most `EDGE_SPEED` px a frame.

## The clipboard's carrier (`clip-carrier.ts`, S151)

`planCopy` writes a clip's text (interface's `clipText`) as `text/plain`,
the selection's own HTML or the text escaped in one element carrying
`data-pinetrie` as `text/html`, and the same JSON (interface's `clipJson`,
inside a carrier with a nonce, the host and the text) as
`application/x-pinetrie`. `readPaste` reads the custom type, then the
attribute (the page parses `text/html`: WebKit writes it again in its own
form), then the text; a carrier counts only when it decodes, was written on
this host (the page's origin) and names the text pasted, `\r\n` taken as
`\n`. Shift held at the paste's keydown (Cmd+Shift+V) makes it text.

## A person's picture (`picture-crop.ts`, ADR-0098)

- **The crop is a value** (`Crop`: a zoom and the square's centre, in the
  image's pixels). `fitCrop` starts with the largest centred square;
  `moveCrop` turns a drag over the preview into image pixels, the square
  moving against the pointer; `zoomCrop` keeps the centre; `cropSource` is
  what `drawImage` reads. Every step goes through one clamp, which keeps the
  zoom in [1, `MOST_ZOOM`] and the square inside the image.
- **The browser sends `PICTURE_SIZE`** (256): the host fits anything larger
  than `PICTURE_MOST` (512, re-exported by interface), so a picture from
  any client is drawn from at most 512 pixels.
- **Its words are `pictureWords`**, and the host's answer's
  `pictureProblem` (interface's), which reads a refusal or a failure as a
  rename's does.

## The rest

- **A scroller follows its end** (`follow.ts`), **a column's view is
  measured** (`viewport.ts`), **a new column is placed** (`align.ts`) and
  **the ask at a column's top is found** (`ask-bar.ts`) from what the page
  measures: `packages/web/TECHNICAL.md` states each rule beside the hook
  that measures for it.
- **The inventory panel docks** left, centre or right, the nearest third to
  where its frame is dropped (`inventory-dock.ts`, `snappedDock`), kept per
  device (`dockCodec`).
- **A page's URL** (`page-url.ts`): its hash (`hashOfPage`,
  `pageOfHash`), and how leaving treats the browser's history
  (`planLeave`, by `PAGE_STATE`).
- **What the host kept of an upload** (`kept-images.ts`): which dropped
  files are images, each under its file's name, and how many were left
  out; the page uploads (`image-upload.ts`).
- **A component's memory of the screen** (`screen-memory.ts`): what it
  knew when it unmounted, kept for the page's life.
- **The theme** (`theme.ts`, ADR-0196): light, dark or the system's,
  kept per device (`themeCodec`). The system's sets no `data-theme` on the
  root (`themeAttribute`), so the stylesheet's `color-scheme: light dark`
  follows the browser. Its words, and the account menu's heading over
  them, are `themeWords` and `THEME_HEADING`.
- **A series' geometry** (`sparkline.ts`, `sparkPath`): interface's
  `SeriesView` points, 0 to 1, in an SVG's own units. A null point is a
  minute with nothing read, and the line breaks there rather than joining
  across it; a point alone is a dot, so a host a minute old still draws.
  The page draws each run's path and its fill from its own first x
  (`packages/web/TECHNICAL.md`, "Pages").
