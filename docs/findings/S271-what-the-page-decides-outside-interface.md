# S271 — The page calls 35 rules functions and 9 reads directly, a terminal would repeat each, and its manifest can drop both packages once interface gives them a home

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** ADR-0093 makes the page draw what `@pinetrie/interface`
decides. A decision the page makes from `@pinetrie/rules` or
`@pinetrie/reads` itself is one a terminal client would have to make
again.

1. What does `@pinetrie/web` take from rules, reads and Kyneta, and from
   core beyond its vocabulary?
2. Could the page's manifest drop `@pinetrie/rules` and `@pinetrie/reads`,
   so resolution refuses such a decision, as it refuses pi outside
   `packages/pi`?
3. Does `@pinetrie/session` assume a browser? (The coupling survey of
   2026-10-19 counted `window` and `localStorage` in `connect.ts`,
   `open-threads.ts` and `open-repair.ts`.)

**Kill criterion.** If most of what the page takes from rules and reads
is types and constants, which decide nothing, the manifest stays as it
is and the work is only moving functions.

**Throw away.** The import graph (`sandbox/coupling/graph.mjs`, outside
the repo).

## Answers

1. **Every non-test import of the page, by package:**

   - **rules, 35 values in 20 files**, concentrated in `app.tsx` (11) and
     `column.tsx` (8):
     - which cards a column shows: `queuedOn`, `yourCard`,
       `pinnedCardsAtEnd`, `marginCards`, `entryMarginCounts`,
       `marginCounts`, `traceEnd`, `effectiveBase`, `threadReach`
       (`column.tsx`, `media-column.tsx`);
     - the board and the canvas: `taskBoard`, `tasksInArchive`,
       `unstartedThreads`, `canvasPinnedCards`, `canvasList`,
       `columnGlances`, `canvasLines`, `reachableAgents`, `TRASH_KEEP_MS`,
       `CANVAS_BUSY_REASON` (`app.tsx`, `board.tsx`, `sidebar.tsx`,
       `canvas-column.tsx`, `message.tsx`);
     - words: `displayName`, `readableThreadName`, `askLine`, `factLine`,
       `pointsText` (a digest's points), `UNTITLED_IMAGE`, `movedBackBy`,
       `writersOfClients`;
     - a message's blocks, numbered as an address names them:
       `markBlocks`, `blockKey`, `BLOCK_PROPERTY` (`markdown.ts`);
     - a review: `decodeRevisionReview`, `reviewUrl`, `diffUrl`;
     - a share's link: `shareMarkdown`; and `blankQueued`, which decides
       that a lane with only blank cards queued is not waiting
       (`use-blank-queued.ts`).
   - **rules, 16 types**, records drawn as props: `SeatRecord` (6 files),
     `DigestRecord` (3), `CardTitleRecord`, `AcceptedRecord`,
     `CommandSummary`, `WorkflowState`, `CardOnCanvas`, `TraceRecord`,
     `CardHistoryRecord`, `QueuedCard`, `QueuedText`, `MarginCard`,
     `RootRecord`, `RunEndReportRecord`, `BlockNode`, `WorkStripButton`.
   - **reads, 9 values:** `readRoots`, `readHeldIndex`, `participantsIn`,
     `readParticipantNames`, `readParticipantPictures` (`app.tsx`),
     `readReading`, `readReadingCanvases`, `readTyping` (`use-presence.ts`),
     `readTypingIn` (`dock.tsx`).
   - **core, 42 values.** Most are vocabulary (`isCanvasId`, `parseCardId`,
     `PRODUCT_NAME`, `firstLine`, `messageText`, `errorText`), but some
     decide what a column shows: `agentCandidates`, `threadMembers`,
     `nearestRevision`, `pointConflicts`, `pinnedInView`, `entryMargin`,
     `runPrompt`, `laneWork`, `askSpan` (`column.tsx` takes 11).
   - **Kyneta, 11 files:** `@kyneta/react`'s `useSelector`, `useDocStatus`,
     `ExchangeProvider` and `attach` (React's binding to the documents);
     `@kyneta/schema`'s `subscribe` in four hooks, each a subscription
     kept outside `useSelector` for a reason the hook states (Kyneta's
     `useTracked` renders on every tracked read), and `POSITION` for a
     text's anchors (`use-share-files.ts`); `@kyneta/exchange`'s
     `whenSettled` (`app.tsx`). These carry out subscriptions and edits:
     the shell's work, deciding nothing, but `blankQueued` above.
2. **Yes.** 35 of the 51 names taken from rules are functions and
   constants that decide; with reads' 9, 44 decisions. The kill criterion
   is not met. Each has a home: a view interface already has
   (`columnView`'s facts take the column's cards; `boardView` the board's;
   `askView`'s digest its points as words), the projection
   (`readSessionFacts` and `readHeldLanes` already gather reads; the
   participants and the roots join them), or interface's `presence.ts`
   for presence's reads: who else is here and typing is what is shown,
   which the session never decides. The 16 types
   reach the page through interface's views, or as types interface's
   index re-exports. Then `packages/web/package.json` drops both
   packages, and `workspace.test.ts` pins its dependencies as it pins
   interface's. Core stays declared, for its vocabulary: resolution cannot
   tell `isCanvasId` from `agentCandidates`, so the decisions core lends
   the page move by hand, without a fence.
3. **No.** Those hits were comments ("This window's column…", "your own
   document"). `packages/session/TECHNICAL.md` states it runs unchanged
   in a browser and in Node, the caller passing the `WebSocket`
   constructor; the e2e suites' `join` (`apps/pinetrie/e2e/harness.ts`)
   drives a host through it from Node. A program as a client already
   exists there.

**Read** 2026-10-19 from source; the counts are of non-test `import`
statements.
