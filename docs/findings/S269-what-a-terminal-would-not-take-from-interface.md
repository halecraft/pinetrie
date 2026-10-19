# S269 — Thirteen of interface's modules decide, whole or in part, from the browser's pixels, pointer, scroll, clipboard or URL, and one does I/O: a terminal client would take none of that

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** ADR-0093's yardstick puts in `@pinetrie/interface` whatever
a TTY would need. The rule `packages/interface/TECHNICAL.md` states puts
there every module that does not touch React or the DOM (S115). The two
differ for a pure module whose inputs are the browser's: a measured box,
a pointer's position, a scroll event's order, an animation frame, a
clipboard's formats, a URL. Which of interface's 115 modules are those,
whole or in part?

**Kill criterion.** If fewer than three modules decide from such inputs,
the two rules agree closely enough, and nothing moves.

**Throw away.** The scans; the classification below is the answer.

## Answers

**The test applied.** A module stays when a terminal would call it with
its own inputs and keep what it returns. It belongs to the page when its
inputs or its constants are the browser's: pixels, a pointer, the order
the browser dispatches scroll events and `ResizeObserver` callbacks in,
animation frames, an element's attributes, a clipboard's MIME types, the
URL's hash and history, or `fetch`.

**Found by** scanning each non-test module for geometry, pointer, scroll
and timing words (eight or more hits each: `viewport.ts` 64,
`fold-motion.ts` 61, `follow.ts` 59, `drag.ts` 28, `rail-view.ts` 26, then
`reorder.ts`, `picture-crop.ts`, `ask-bar.ts`, `align.ts`, `image-edge.ts`,
`inventory-dock.ts`), and for I/O (`fetch`, timers, clocks, storage,
`location`, `history`). Each hit was read against its header and its
exports, and against which interface modules import it.

**Wholly the page's**, since what they decide from is the browser's:

| module | why |
|---|---|
| `follow.ts` | its rule rests on the browser dispatching scroll events before `ResizeObserver` callbacks, and a callback running after layout and before paint |
| `viewport.ts` | measured boxes and `scrollTop` (`Box`, `spotScrollTop`, `RAIL_HOLD_MS`) |
| `align.ts` | a spacer's height and a scroll, in pixels |
| `ask-bar.ts` | a measured `WorkBox` |
| `picture-crop.ts` | a crop dragged and zoomed over an image, `PICTURE_SIZE` 256 px; a terminal draws no picture |
| `inventory-dock.ts` | a floating panel snapped to the nearest third of `x` and `width`; a terminal has no floating panel |
| `screen-memory.ts` | what a component knew when it unmounted: React's lifecycle, as a `Map` |

**Split**, one half each:

| module | stays in interface | the page's |
|---|---|---|
| `fold-motion.ts` | `foldMotion`: which columns a layout action moves (`perform.ts` and the `layout` effect read it) | `planFoldMotion` and `Rect`, `FoldScene`, `FoldFrame`: the motion's geometry, sampled |
| `reorder.ts` | `landing`, `neighbourShifts`, `keyMove`, `cardBeforeGap` (`page-keys.ts`, `drag.ts`) | `pointerGap`, `edgeScroll`, `EDGE_ZONE`, `EDGE_SPEED` |
| `image-edge.ts` | `ImageEdge`, `imageSpot` (`card-intents.ts`, `put-target.ts`) | `imageEdge` and `EDGE_BAND_PX` |
| `page.ts` | `PageName`, `pageWords`, `profileWords`: a page over the stage is a screen in any client | `hashOfPage`, `pageOfHash`, `planLeave`, `BACK`, `PAGE_STATE`: the URL's hash and the browser's history |
| `drag.ts` | `planDrop`, `dropIntents` and the types they take (`DragSource`, `DragAt`, `DragFrom`, `PlannedDrop`): what a drop over a target asks, through `putLanding`, `landing`, `neighbourShifts`, `imageSpot`, `planRootDrop` and rules' `imagesIn` | `DRAG_HANDLE` (CSS attribute selectors), `dragProps` (`data-` attributes), `sourceOfElement` (reading an element), `NOT_A_HANDLE`, `DRAG_START` 5 px, `drawPlan` (a pointer and its speed), `sidebarSpot` (a `y` in a row's box), `hoverOpens` with `ITEM_HOVER_MS`, `dropMark`, `Point` |
| `clip.ts` | `Clip`, `ClipFacts`, `cardClip`, `threadClip`, `planCopy`'s choice of what a copy takes | `CLIP_MIME`, `CLIP_ATTRIBUTE`, `readPaste`: `application/x-pinetrie`, a `data-pinetrie` attribute in `text/html`, and WebKit's rewriting of it |

**Not interface's at all:** `upload.ts` calls `fetch("/blob")`, a URL
relative to the page. It is the package's one I/O, in a package that
"does no I/O". Posting a blob to the host is a client's connection to
it: `@pinetrie/session`'s, which knows the host's address in Node as in a
browser. Its `Upload` type stays where `perform.ts` reads it.

**Why the no-DOM check did not catch it:** `packages/interface/tsconfig.json`
drops the DOM library but inherits the root's `types: ["node"]`, and
Node's types declare `fetch`, `Blob`, `URL` and `TextEncoder`. The check
refuses `window` and `document`; it cannot refuse a global both declare.

**Stays, though it looked close:** `rail-view.ts` (the rail in rows and
tracks, which ADR-0093 names a terminal's), `list-width.ts` (a list full
or folded to icons), `identity.ts`, `focus.ts` and `focus-claim.ts` (focus
is any client's), the key tables (`page-keys.ts`, `card-keys.ts`,
`grid-keys.ts`: a terminal has keys), `same-data.ts` (`projection.ts`
compares with it), `palette.ts` (slots, each client its own colours).

**So:** seven modules move whole, six split, and one leaves for
`session`. The kill criterion is not met; the rules differ.

**ADR-0093 named two of these as interface's** under the rule it replaced
("a value, its rules and its codec are the interface's"): `inventory-dock.ts`
and `list-width.ts`. The yardstick keeps `list-width.ts` and moves
`inventory-dock.ts`, so the plan's ADR amends ADR-0093 there.

**Corrected** the same day: `drag.ts` was first listed as wholly the
page's. Its plan of a drop imports rules' `imagesIn` and five of
interface's own functions, so moved whole it would need the page to
declare rules and interface to export what only it calls. It splits.

**Corrected** again as the plan carried it out (2026-10-20):
`reorder.ts`' `pointerGap` stays in interface, since it counts centres in
any unit and `root-target.ts` and `cardBeforeGap` call it; only
`edgeScroll`, `EDGE_ZONE` and `EDGE_SPEED` (px a frame) moved. `page.ts`'
`BACK` is a word, and stays. `fold-motion.ts`' half that stays became
`column-motion.ts`. Once `drag.ts` split, `neighbourShifts` (each
column's `translateX`, from widths in px) had only `drawPlan` to call it,
and moved to web-core with it.

**Read** 2026-10-19 from source, after accepted work's merge of that day.
