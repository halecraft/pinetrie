# S115 — Of the client's modules, all but the hooks and five others need no DOM and no React; core's display code moves as one closed set

**Status:** Answered. Led to ADR-0093. Served
`PLAN-2026-10-05-interface-package`.

**Question.** If a second kind of client, a TTY, were written, which of
`@pinetrie/client`'s modules, and which of `@pinetrie/core`'s exports that
only the client imports, would it need? A module it needs cannot stay in a
package that depends on React.

**Kill criterion.** If most of the client's `.ts` modules touch the DOM or
React, there is no shared layer worth a package, and core's display code
stays where it is.

**Throw away.** A `tsconfig` extending the root's with `lib: ["ESNext"]`,
type-checking every non-test `.ts` in `packages/client`; an import scan of
core's exports by the packages that import them.

**Answers.**

1. **Of 82 non-test `.ts` modules in `packages/client`, the ones that touch
   the DOM or React are the 15 `use-*` hooks, `copy.ts`, `image-click.ts`,
   and the three React contexts `palette-context.ts`, `pane-context.ts` and
   `review-prefs.ts`.** Type-checked without the DOM, only `copy`,
   `image-click` and nine of the hooks fail; the contexts and the other
   hooks import React. Every other module type-checks: `intent.ts`,
   `perform.ts`, `layout.ts`, `send.ts`, every `*-view.ts`, the words.
   A grep for `window.` and `document.` had counted words in comments and
   called four of these DOM-bound (`intent`, `identity`, `list-width`,
   `tab-state`); the type check is the measure.
2. **Two more stay with the page because of what they produce, not what
   they touch.** `markdown.ts` builds a hast tree, HTML's, for
   `MessageText`, and `pane.ts` reads tables and images from it. A TTY
   renders markdown from its own tree. `message-props.ts` and
   `message-list-props.ts` are `React.memo` rules.
3. **Everything else is closed under imports:** no module outside the page's
   set imports one inside it, so the shared set moves without leaving an
   import behind.
4. **Five modules hold both halves, split by one rule: a value, its rules
   and its codec are shared; where the browser keeps it is the page's.**
   `identity.ts` (`IDENTITY_KEY`), `list-width.ts` (`LIST_KEY`, the media
   query `SMALL`), `tab-state.ts` (`tabState`, `deviceState`,
   `StorageLike`), `same-props.ts` (`sameProps`, the memo rule; its
   `sameData` is shared) and `palette.ts` (the hex colours; the slot a
   track takes is shared).
5. **38 of core's exports are imported by the client alone, but most are
   used inside core by what it exports to others,** so the move is decided
   by use, not by import. `projectRail` and `RailRow` stay:
   `summarizeRoots` (`packages/core/roots.ts`) is built from the rail's
   rows, and the host's titles and `@pinetrie/reads` read it. So do
   `projectSpine`, `followTip`, `pathIds`, `messageAt`, `runOf`,
   `lastWord`, `handleOf` and `isLongAsk`. What moves is closed: the
   columns (`projectColumns`, `ColumnSpec`, `ColumnView`, `branchColors`,
   `PENDING_TRACK`), the rail's drawing (`compactRail`, `placeRail`,
   `railLandmarks`, `RailItem`, `RailDot`, `RailStretch`, `RailAsks`,
   `stretchSpan`, `workStats`, `statsOf`, `WorkStats`), an ask's fold
   (`segmentPath`, `Segment`, `askStats`) and presence's reads
   (`whoIsAt`, `readingAt`, `seenBy`). Nothing staying in core, and
   nothing in `@pinetrie/rules` or `@pinetrie/reads`, uses any of it.
6. **`MIN_STRETCH` meant two things.** It was the rail's shortest capsule
   and the long-ask threshold `isLongAsk`, by which the host decides
   whether to ask a model for a digest (`packages/rules/digest.ts`,
   ADR-0075). A client's geometry must not change what the host pays for,
   so the two separate: `LONG_ASK` stays in core, and the rail's shortest
   capsule follows from its span.
7. **The fence works.** With `lib: ["ESNext"]`, `window`, `document`,
   `requestAnimationFrame` and DOM members (`getBoundingClientRect` on an
   `HTMLElement`) fail to type-check. A mention of the `HTMLElement` type
   alone does not: React's types declare it.
