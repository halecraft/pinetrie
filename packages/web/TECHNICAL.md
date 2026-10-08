# `@pinetrie/web` — technical notes

The browser page (ADR-0093): React components, hooks and what touches the
DOM, drawing what `@pinetrie/interface` decides
(`packages/interface/TECHNICAL.md`): the sidebar of roots down the left, the
root you are on as a rail beside a strip of columns, and the board in the
footer (`docs/06-interface.md`, ADR-0122). Its connection to the host is
`@pinetrie/session` (`packages/session/TECHNICAL.md`), which declares no
React. The page implements the interface's `AppPorts` (`app.tsx`) and keeps
in the browser what the interface encodes (`tab-state.ts`,
`storage-keys.ts`). A module named here that is not in this directory, such
as `layout.ts` or `viewport.ts`, is the interface's.

## Renders (S54, S59)

A render of `App` redraws no message whose content did not change, and a
presence write renders no `App` at all. A cascade into every message costs
CPU in any build, and in the development build memory too: React keeps a
timeline entry per render whose props changed (S54: 255 MB in minutes). In
the development build each element costs about 35 µs to create whether or
not it then redraws, so a column that builds a 1,500-message list takes
about 55 ms (S59).

- **Presence is read by what shows it, never by `App` or a `Column`**
  (`use-presence.ts`). Each field has its own read (`readReading`,
  `readTyping`), and Kyneta wakes a read only for writes to
  its field (S59). `useSelector` re-renders its reader on every such write,
  a write of the same value included (the page's 10 s refresh), so the
  readers are small:

  | field | read by |
  |---|---|
  | `typing` | `TypingLine` (`composer.tsx`) |
  | `reading` | `SeenBy` (a column's header), `LiveRail` (rings, and which rail items stay), `Readers` and `ReaderMenus` (`root-signals.tsx`) |

  Each read keeps its array while the field's entries are the same, so the
  refresh's render reuses the memos below it. `App` still writes your
  presence (the reported columns, the refresh, `typing`); writing reads
  nothing.

- **`readSessionFacts` keeps each fact it did not change, by identity.**
  Any write to the session's values (a directory refresh, a card's move,
  which writes its history) reads every fact again, and each read builds
  new maps. `keptFacts` (`projection.ts`) keeps the previous value of each
  fact that reads the same (`sameData`), per held view, and the whole
  object when nothing changed; the tree and the asks are kept by their own
  reads, and compared by identity. Without it, a card moved by someone else
  redrew every message list (the browser suite's "another window's card
  redraws the column and none of its messages").
- **Every subscription is `useSelector(ref, read)` over a named read**, never
  an inline `useTracked(() => …)`. `useTracked` re-runs a thunk that is a new
  function, so an inline one reads the document again on every render,
  whatever caused it, and gives the index and everything projected from it a
  new identity (`@kyneta/react`'s identity rule). `useSelector` memoises its
  thunk on the ref and the read, and a module-level read never changes. A
  read that takes an id (a stream's text) is a `useCallback` on that id.
- **`Message` is `memo(MessageView, sameMessageProps)`** (`message-props.ts`,
  pure). `MESSAGE_PROPS` says how each prop is compared, and its type refuses
  a prop that is not in it. `sameProps` (`same-props.ts`) makes the rule
  from the table, for every memoised component: the review's pane and each
  of its file sections are the others (below). The node, its tools, its join, its fork tracks,
  its closed branches and its calls' streams (`callStreams`) are compared by
  value, since `projectSpine` builds new nodes on every projection. The rest
  are compared by identity.
- **People's pictures come by context** (`Pictures`,
  `pictures-context.ts`, ADR-0098), from `readParticipantPictures`, which
  keeps its map while the pictures are the same. Only `Initial` reads it:
  circles are drawn deep in avatar stacks, readers' menus, column headers
  and the footer, and none inside a memoised message list, so a picture
  set redraws circles alone.
- **What a message's tables and images need from the pane comes by context,
  never a prop** (`pane-context.ts`, ADR-0078). `PaneReach` (what the pane
  shows, and `open`) is provided by `Column`, memoised on the subject with
  a stable `open`; `MessageSource` (the message's entry, or a reply still
  streaming) by `MessageView`, memoised on its id, and by `Reply`. A
  context change redraws only `MessageTable`, `BlobImage` and `AskWork`,
  which read it, and React records no such render, since their props are
  the same. So `MessageList` takes no handler for an ask's review.
- **`AskWork` decides nothing:** it lays out `planAskWork`'s rows
  (`@pinetrie/interface`), and reads only `view.ask` and `view.running`
  besides. A word drawn from `AskView` here would escape the test that an
  ask's summary is said once (`packages/interface/TECHNICAL.md`, "Asks,
  densities and folds").
- **A message is given only its own calls' streams** (`callStreams`), never
  `liveWork`'s map: the map is new whenever the facts are, and would redraw
  every message.
- **A message reports what its reader asks as a `MessageAct`**
  (`message-tools.ts`) through one `onAct`, which `Column` makes once with
  `useStable` and passes on as its column's intent (below). A handler per
  message would be new on every render of the column.
- **A column's messages are one memoised `MessageList`**
  (`message-list.tsx`, `message-list-props.ts`), so a column that renders
  for anything else (a card, its composer's intent, a run elsewhere) builds
  no list. `view` is compared by identity: `App` keeps it while the index
  and the columns are the same, and comparing a long
  thread's nodes would cost part of what skipping saves. So any change to
  those, a column opened or closed included, builds every column's list
  once. `lane` and `joins` are rebuilt on every render of the column and
  compared by value; `sameData` compares a `Map` by its entries.
- **The review redraws with its data, not its column.** `ReviewPane` compares
  its target, line and `narrow` by value, since `columnView` and `paneView`
  build them anew, and its `close` is `useStable`'s. A file section (up to 5,000 lines) compares its
  row by value, so a scroll that moves the list's current file redraws no
  diff. `useFetched` keys on its URLs' values, not the array's identity. The
  browser suite checks that typing beside an open review redraws neither.
- **A layout change is resolved in the same render,** not only a new index:
  `resolveLayout` runs on `stored` too, so a column opened at a lane's tip
  is drawn bound at once. It returns the same state when nothing moves, so
  the effect that stores it settles after one pass.
- **The browser suite counts renders** from React's development build, which
  `startHost` serves with `NODE_ENV` unset, as `pnpm run host:react-dev`
  does (`pnpm run host` serves production React): React measures every
  render whose props changed on its "Components ⚛" track, with the changed
  props' diff (`componentRenders` in `apps/pinetrie/e2e/browser.ts`). A
  production build records none, and every count would pass, so the suite
  stops at its start unless the page has recorded some. A render whose props
  are the same (a state change, a `useSelector` write) is not recorded. An
  entry is named by the function that rendered: a message's is
  `MessageView`, the function `memo` wraps, and a list's
  `MessageListView`, so a check counting `Message` counts nothing.

## Kept per tab (`tab-state.ts`, ADR-0027)

`tabState` keeps a value under one key in two slots: the tab's
(`sessionStorage`), read first, which survives a reload; and the device's
(`localStorage`), which a new tab starts from. It knows nothing of pine·trie; a
value's stored form is its codec's. It keeps the layout, under the key
`pinetrie-columns:<session>`, which predates root tabs, and the sidebar's width
(`pinetrie-list`, `list-width.ts`, ADR-0088). The width is saved only when you
fold or unfold, so until then the default follows the window (`shownWidth`).

The stores are built in `main.tsx`, the one module that touches
`sessionStorage`, `localStorage` and `window` as it loads, and `App` is
given them (`AppStores`).

`deviceState` keeps a value in the device's slot only, shared by the device's
tabs: where the inventory is docked, how you read a review
(`pinetrie-review`, ADR-0087), and who you are (`pinetrie-identity`,
below), which `reconcileName`'s `store` also saves, with the same email, so
it reloads no tab. What you have dealt with is not here but in your
attention document, on every device of yours (ADR-0077), which merges; here
the latest save wins. `subscribe` hears another tab's save through the
`storage` event, which fires only in the other tabs, and hears a `clear()`
as `undefined`. Both write through `writeSlot`, which drops a full quota's
error.

- **Every change is saved, the document's too:** the resolved layout, each
  time it changes. Saving only what a person does
  would store older anchors, and `followTip` from an older anchor can land on
  a newer branch below it. So with two tabs open, the device slot holds
  whichever changed last: both move their columns as messages arrive.
- **The codec is the edge** (`encodeLayout`, `decodeLayout`), in the house
  shape: a TypeBox schema, then a build step field by field. A layout decodes
  whole or not at all, and `v` rejects an older one: a `v: 2` layout (before
  your tabs were yours, ADR-0030) is dropped once and overwritten by the first
  save; so is a `v: 4` one (before the sidebar was your own document,
  ADR-0122), and the page opens on the sidebar's last root, else the board. A lane that is not a lane name
  is left off; `sync` binds the column again.
- **`reserved` is stored** (ADR-0057), and decoded only in the shape the host
  accepts (`parseNewLane`), so a reload keeps the thread's name. The device
  slot copies it into a new browser tab, where the column binds to the lane
  once either copy sends.
- **`fresh.pending` is never stored**, by either side: restoring it would send
  its message again. A "branch here" column comes back empty. `fresh.prefill`
  is stored, blank or content: only `pending` is sent on opening. What was
  typed over it is a card, kept by the column's key (Your message and notes, below).
- **Restored anchors the document lacks are pruned once, after
  `whenSettled`.** Until then, missing means not yet arrived: `connectSession`
  returns before the document does (S29: 0 of 50 had it). Neither
  `docStatus`'s `"populated"` nor `useDocReady` will do, since both turn true
  with the first data. Once is enough: entries are immutable, and compaction
  keeps them.
- **Restored columns usually open at their end.** `alignOnOpen` runs when a
  column first renders, usually before the document has arrived, so it finds
  no fork point. When the document is there first, a column aligns with its
  fork point, as a new one does.
- **A failed write is ignored,** each slot on its own. `getItem` is not
  guarded: where storage is disabled, touching it throws, and reading who you
  are does so first.
- **In the browser suite,** the main page comes from `browser.newContext()`.
  A page from `browser.newPage()` owns its context, and Playwright refuses a
  second tab in it; each `browser.newPage()` is a new context, with storage of
  its own, so it is a device of its own that would ask who you are:
  `asPerson(page, email, name)` stores an identity before it loads. A page
  from `page.context().newPage()` shares the main page's storage, so it is
  the same person.

## Revealing a picked message (`use-reveal.ts`, S33)

`useReveal(container)` returns `reveal(id)`, which `openAt` calls for a pick
that scrolls and for one that opens a column.

- **It tries at once.** Picking a message a column on the tab you are on
  already draws changes no layout state: `show` for the same tab returns the
  same state, so no render follows, and an effect waiting for one never runs
  (S33: the rail's scroll-to did nothing). Otherwise the id waits for the render
  the pick causes, in a layout effect with no dependencies.
- **It scrolls only a message that is out of view.** A branch opened from its
  fork point is already level with it, and centring it would undo that.
- **It dispatches `PLACED`.** A column scrolled down, from 0 or from a shorter
  path, has not moved up, so it is still following, and the next resize would
  take it to its end (S33, answer 6). Since the Archive preview went, every
  column it scrolls was placed by `App`'s alignment first, so this is
  defensive: no suite check reaches it (ADR-0122).
- **It is declared after the alignment effect in `App`,** so a pick the
  alignment left out of view is scrolled to in the same commit.

## The page's colours (`index.html`, ADR-0081)

`:root` names them: `--page` (the paper the columns and the root you are on
are drawn on), `--chrome` (the sidebar and the footer), `--edge` (their lines
and the selected item's sides), `--on` (the selected item's left edge) and
`--side` (the sidebar's width, which the footer's own cell shares: 15rem,
11.5rem under 56rem, 3rem under `:root[data-list="icons"]`, ADR-0088). No
page-colour literal is left in the stylesheet. `--surface` is the colour
behind a thing, set by context: `--page` by default, `--chrome` in
`#sidebar` and `#bottom`, the hover fill on a hovered item, `--page` on
the selected one and on a thread card. A ring that must read as a gap around
a dot (`.root-status.needs-you`, `.card-pip`) is drawn in `--surface`, so
it matches whatever the dot sits on.

## Colour carries the link, not geometry

Each column takes the rail track of its last message (`branchColors`); its
header, its fork dot in the parent column and its rail track share that
colour. There are no connector lines, so sibling branches never cross.

- **A root seeds its colours** (`palette.ts`, ADR-0089, S110). Its
  `RootId`'s hash picks the slot its trunk takes, and track *n* takes
  `(seed + 7n) mod 12`. Which slot is the same in any client; the page's
  colour for a slot is `colors.ts`'s (`slotColor`). The seed of the root you are on, or of the root a
  new tab minted, is `TrackSeed`, a context `App` provides around the
  workspace; `useTrackColors()` turns a track into its colour, slot and
  `--track` style. It changes only with the root, which remounts the
  columns anyway, so memoised messages are not redrawn for it. Context
  reaches the narrow pane's dialog through its portal.
- **One inline `--track` per column** (`useTrackColors().style`), on
  `.column`: the header's border, name and origin dot, the thread's details
  and the pane read `var(--track)` in CSS. A fork dot sets its own, the
  track of the branch it opens, and so does the narrow pane's dialog, which
  is outside the column.
- **Hover linking is CSS.** Headers and fork dots carry `data-color`, the
  track's palette slot; `:has()` rules in `index.html` outline one in
  `var(--track)` when the other is hovered. No component state. CSS cannot
  match two elements' attribute values, so there is a selector pair per
  slot, all in one rule, and `colors.test.ts` checks there is one for
  each. One declaration means a mutation of it reaches whichever slot the
  browser check's branch lands on.
- **The palette is twelve colours**, in hue order, so tracks twelve apart in
  one root share one; the rail shows them the same way. `data-track` stays
  the track itself, which the browser suite matches between a column, its
  fork dot and the rail.
- **A root's colour is its trunk's** (`rootSlot`): a folded list's tile
  (ADR-0088), the rail's trunk and the first column all take it.

## Layout: columns scroll independently

Each column scrolls on its own, its composer at its foot. `alignOnOpen` in
`app.tsx` places a column when it first appears: it scrolls the column (or
grows a spacer above its first message) so that message is level with its fork
point in the column showing it. A shared vertical scroll was tried in design
and dropped: forks far apart could not be seen together
(`docs/06-interface.md`).

- **`placement` (`align.ts`) is the rule, pure;** `place` in `app.tsx`
  measures, calls it, and scrolls or sets the spacer.
- **Columns are placed left to right, the first at its end.** Every column of
  a tab shown again mounts at the top, and `useFollow` takes the first to its
  end only in a ResizeObserver callback, after the alignment effect. Measured
  against an unplaced parent, a branch from far down it got a spacer the
  height of the parent's content above the fork, with its own messages below
  it (3141 px of blank in a 445 px view, in the browser suite).
- **A fork point below the view of the column showing it counts as none:**
  the column opens at its end. Level with it would be off screen, behind a
  spacer taller than the view. A fork point above the view is still met, by
  scrolling alone. So a spacer is never taller than the view it lines up with.

## A column's view (`viewport.ts`, `use-viewport.ts`, ADR-0058)

Each column measures which of its messages are in view, and the same span
serves the rail's outline and the column's spot.

- **`useViewport` measures once a frame at most**, on the body's scroll and
  the body's and content's resizes, as `useAskBar` does: every
  `.msg[data-entry]`'s box, then `visibleSpan`, two binary searches. A
  fold's line is no message: a view's top in it is at 1 of the message
  above, and the span covers the folded messages between. It writes the
  `ViewportStore` only when `sameSpan` says the span moved.
- **Only `RailViewport` reads the store** (`rail.tsx`, with
  `useSyncExternalStore`), so a scroll redraws the outlines alone, not a
  column and not the rail's dots. `railView` turns a column's ids and
  edges into bands, one per branch, of whole items, each at its branch's
  `across`, so an outline keeps the
  shape of what it wraps; ticks, a line where the view's top or bottom
  falls inside a capsule, sliced as `pickAt` reads it, at most two and one
  when both fall within `EDGE_MERGE`; and the `extent` the rail keeps in
  view. A tick never spans the part in view: seeing most of a capsule, it
  read as the capsule's fill.
- **Outlines are under the dots and ticks over them**: `RailViewport` is
  drawn after the dots, `.rail-view` has `z-index: -1` and `.rail-tick`
  `1`, and `.rail-tree` is `isolation: isolate`, so the outline's -1
  stays inside the tree. A tick is 2 px, wider than a capsule, with a dark
  edge, centred on its edge (`tickBox`): on a capsule filled in the
  column's colour, its ends and edge are what show.
- **The rail follows `moved`**, the column whose view changed last, in a
  layout effect that runs only when the views change: a redraw for
  presence or a new message leaves the rail's scroll alone. The store
  ignores a write that changes nothing (`sameViewport`): a column's
  measuring runs again whenever its effect does, and would take `moved`
  from the column the reader scrolls. `railScroll`
  holds while the pointer is over the rail and for `RAIL_HOLD_MS` after
  the reader scrolls it or the pointer leaves. The rail's own scroll is told
  from the reader's by the `scrollTop` it last set.
- **A spot is saved in `seen.leave`**, with `SeenEnd`, from the latest
  span, not a measurement then: React runs layout effects' cleanups while
  the tree is being taken apart. `keepSpot` keeps one per column, by the
  ids it shows (`ColumnView.nodes`), which no other column of its tab
  shows, so a branch's spot never replaces its parent's.
- **`placeOnReturn` runs in the alignment effect, before `alignOnOpen`**,
  and `settle`s the column as alignment does. It gives up, and alignment
  places the column, when the spot's message is not drawn (in a closed
  fold) or the content fits the view: only alignment sets the spacer that
  lines a short branch up with its fork point.
- **Selectors:** `.rail-view[data-key][data-track]`, one per band, and
  `.rail-tick[data-key][data-track]`, keyed by their column. The browser suite tests "around a dot" over every outline of
  a column: a column's view can lie on two branches.

## Moving columns (`reorder.ts`, `use-column-drag.ts`)

A column's header is its drag handle, once the tab has two columns. Its grip
(`.grip`) moves it from the keyboard. `move` in `columnsReducer` is the one
action; `reorder.ts` decides, purely, which gap a pointer is in (`gapAt`),
where a drop there lands (`landing`), what a key does (`keyMove`), and how
fast the strip scrolls near an edge (`edgeScroll`).

- **Nothing moves until the drop.** Moving a column changes what the columns
  right of it show (`projectColumns`), so a live reorder would redraw the
  columns under the pointer. During a drag, the column slides with the pointer
  and `data-drop` (`before`, or `after` on the last column) marks the gap.
- **A drag writes to the DOM, not to React state:** a transform,
  `data-dragging` on the column, `data-reordering` on the strip. A render of
  `App` per pointer move would redraw every column. The column's centres are
  measured once, when the drag starts, in the strip's content coordinates, so
  edge scrolling does not skew them.
- **The slide is clamped to the strip's ends.** A transform widens a scroll
  container's overflow, so an unclamped column dragged right would keep
  widening the strip that the edge scroll is chasing.
- **A press on a control starts no drag** (`NOT_A_HANDLE`): the name and the
  origin row are buttons. A thread's details are drawn below the header,
  outside it, so no press on them starts one. The header is `user-select: none`; the offer's
  bookmark, which a press copies, is in the work strip, outside it. A press is
  a drag only once it has moved 5 px, so clicks still reach the header.
- **Escape or a cancelled pointer moves nothing.** A drop in the gap on either
  side of the column also moves nothing, and marks nothing.
- **After a move by key, the column is scrolled into view.** Its grip keeps
  focus through React's DOM move in Chromium, which the browser suite checks.
  Its mutation removing an explicit `focus()` survived, so there is none.
- **The order is never realigned.** A column moved right keeps its scroll,
  though it now starts after its fork point. A column moved first loses its
  spacer (`column.tsx`).

## Following a column's end (S32)

A column at its end stays there as it grows; once the reader scrolls up, it
holds still. `follow.ts` is the rule, pure; `useFollow` (`use-follow.ts`) reads
the scroller, calls it, and scrolls. A running tool's output uses the same hook.

- **It follows height, not data.** A ResizeObserver watches the column's
  viewport and `.column-content`, and scrolls to the end in the frame the
  layout changed. A streaming reply, markdown reflowing, a tool row opening,
  an image, the composer growing: each is a change of size.
  Following new messages alone missed a reply being written (S32: 900 px
  behind by its end).
- **A scroll up is the reader leaving.** The column only moves down on its
  own, and remembers where it last left the scroll, so a scroll event above
  that releases it, however small. Its own follow's echo, arriving after the
  content grew further, is not a move up. A scroll the browser clamps after
  content shrank lands exactly at the end, which is not leaving either. The
  height alone cannot tell a clamp: clicking `.open-branch` scrolls its message
  into view and removes the button in the same moment.
- **Chromium dispatches scroll events before ResizeObserver callbacks** in each
  frame (S32), so the reader's scroll is seen before the next follow could
  undo it. No wheel, key or touch listeners are needed.
- **It follows again** on a scroll down to within 24 px of the end, on the
  reader's own send (`onSend`), and on **↓ new below**, which shows while
  released with content grown since, or while placed short of its end after
  mounting behind (below).
- **`alignOnOpen` settles it:** it dispatches `PLACED` on the body, and the
  column follows only if it was placed at its end. Without it, a column
  aligned short of its end would jump there on its first ResizeObserver
  callback. `useReveal` dispatches it too (below). A placement at the end
  clears ↓ new below; one short of it keeps it.
- **↓ new below survives an unmount** (ADR-0049). A column of a root tab you
  leave is unmounted, and `useFollow` tells it (`seen.leave`) whether ↓ new
  below showed; the column saves that with its tip (`SeenEnd`) in `App`.
  Mounted again, it starts with ↓ new below when `behind` says it moved on
  since. Nothing clears that before `alignOnOpen` places it: its `holding`
  step leaves `unseen` alone, and its first resize comes after the
  placement. The snapshots are never pruned, unlike `aligned`, which must
  forget every column off the tab you are on: a closed column's key is never
  used again, except `first-<root>`, which comes back as its root's only
  column, placed at its end, and that clears ↓ new below. A reload keeps no
  snapshots. `App` keeps them in a `screenMemory` (`screen-memory.ts`), a
  plain object made once, which a component may read during render: a
  `useStable` handler run during render runs the previous render's function.
- **While a lane runs on its path, a following column does not get shorter**
  (`holding`, ADR-0044). A shrink is taken up by `.column-floor`, below the
  content: its height is what the content lost since it was last set
  (`held`), and what grows next uses it up. The ResizeObserver callback runs
  after layout and before paint, so the floor is painted in the frame the
  content shrank in. The rule reads `.column-content`'s own height:
  `scrollHeight` is at least the view's, so it cannot say how far short
  content shrank.
- **The floor keeps its height while released, and goes when the run ends or
  on `PLACED`.** Turning `holding` off never scrolls: at the end, the browser's
  clamp keeps the column there. If a run ends shorter than its floor, the
  column moves once, then. A column that shrinks mid-run for another reason,
  such as a column opened to its left, keeps its floor until the run ends.
- **A release keeps the tip it left at** (`releasedTip`, ADR-0106): set by
  the first scroll up, kept while released however the run grows, and
  cleared by following again. `SeenEnd.released` carries it across an
  unmount; `seen.leave` also runs when the page is hidden. An ask whose
  run ended after it stays open (`foldOpen`).
- **The floor is at most a third of the view** (`FLOOR_MAX`, ADR-0049).
  `capFloor` applies wherever the floor is set, so a view that gets shorter
  cuts a standing floor too. `held` counts the capped floor, so what the cap
  gave up is not claimed again. Since tool rows stay open, what the floor
  still takes up is a row the reader folds mid-run, and columns opened to the
  left.

## Tools and live work (ADR-0107)

- **A tool call is a row under the agent's message** (`ToolRow` in
  `message.tsx`), its result folded in a `<details>`, cut at 20,000
  characters for display. Its summary is `rowSummary`'s (`@pinetrie/interface`,
  ADR-0114), in this order:
  - `.tool-tag`, the tool's word ("shell", "read", "search"), absent for a
    call that touched nothing it names, whose word is then its preview;
  - `.tool-label`, the preview: what the call touched (`subjectOf`, core),
    to its first line or 120 characters, with "…" when cut. A `grep` or
    `find` shows its pattern and the path it searches;
  - `.tool-label-whole`, all of it, when that reads otherwise: a long or
    multi-line command whole, a long one-line chain laid out a step a line
    (`@pinetrie/shell`). CSS on `[open]` swaps it for the preview, so the
    command is never drawn twice and no state is kept;
  - `.tool-status`: ✓, ✗ or ….

  Each is drawn in runs (`Runs`), a `<span class="sh-<role>">` each, and a
  plain run as bare text: a command's names, options, strings, variables,
  redirects, keywords and operators are coloured apart. The live row is the
  committed row, so a running command, once its row opens, shows it whole.
- **The tag floats right, first in the summary**, so it takes the row's top
  right and the label wraps around it. The summary stays a list item: a
  flex summary loses its ▶. An open command is one inline block beside the
  tag, so every line of it has the room the tag leaves: `LAYOUT_WIDTH`
  (`tool-row.ts`) is 44 characters, the Mac's SF Mono at .8rem (0.6em a
  character) in a 28rem column's 25.5rem, less the ▶ and the tag. A wider
  open command drops below the tag. Measured in headless Chromium, whose
  fallback monospace is 0.5em wide, so it is the Mac's font that sets the
  width.
- **How much of a row shows is `rowSize`'s** (`tool-row.ts`, ADR-0049):
  `closed`, `capped` or `full`, from two facts the row holds.
  `revealed` is set by a timer once the call's output has streamed for
  `REVEAL_MS` (500ms) while the row is drawn, and never unset; the reader's
  last choice wins over it. So a fast command never opens, a slow one opens
  `capped` (command at most 5rem, output at most 10rem, each scrolling) and
  stays open when its result arrives, and only the reader closes it. A click
  makes a closed or capped row `full`, uncapped, and a full one closed.
  `data-size` names the size; a closed row draws no output, so a check reads
  `.tool-output` only after opening its row.
- **A row keeps what it decided across an unmount** (ADR-0049, amended by
  ADR-0054). `revealed` and the reader's choice are one `RowMemory`, which
  `App` keeps by call id in a `screenMemory`, passed down to `ToolRow` as
  `rows` (an identity prop in both props tables, made once). `useRemembered`
  (`message.tsx`) starts from it and writes it in the same call that sets
  the state, so a row unmounted at any moment has left its latest state. A
  remembered `revealed` starts no timer: a running command's row on a tab
  shown again is open from its first frame. A reload remembers nothing.
- **A result with an image opens its row too** (ADR-0051): `rowSize`'s third
  fact, `shows`, is read from the result, so the row opens `capped` when the
  result arrives and on every mount after, and the reader's choice still
  wins. `toolBody` (`tool-row.ts`) draws the images (`.tool-images`,
  `StoredImage` in `blob-image.tsx`) in place of the text, whose caption and
  resize note become each image's `title`; the call's path (`subject`) is its
  `alt`. A capped row caps an image at 10rem tall through its width,
  `min(100%, 10rem × --ratio)`, which `StoredImage` sets: overriding `width`
  would drop the box the `width` and `height` attributes give before the
  image loads.
- **One `ToolOutput` draws the live output and the result**, and follows its
  end (`useFollow`). The result keeps the live output's element and scroll:
  at its end, or where the reader left it. A result is its own entry in the tree;
  `projectSpine` pairs it with its call on the same path, so it adds no column
  row and no rail row. A message that only called tools shows only its rows.
- **Live work hands over to its entry in one render** (ADR-0044). `App`
  reads the stream records with the index (`readSessionFacts`), and
  `liveWork` (`live.ts`, pure) decides what is drawn. Each reads its own text
  (`readStreamText`), so a delta re-renders only it.
  - A reply is drawn at the column's end (`Reply` in `column.tsx`) while it
    is its lane's current reply (`isCurrentReply`, the host's own rule). Its
    entry moves the lane's tip, so the entry and the stream's end are one
    change.
  - A tool's output is drawn in its own row (`ToolRow`) while the call has a
    stream and no result, once the row is open. The result replaces it in the
    same element (`ToolOutput`).
- **A stream goes when its entry arrives,** which a fast model can do between
  two renders, so a check that must see one uses a slow scripted model. A
  check that must see a run in progress, not its reply, pauses the reply
  (`ScriptedModel.pause`).
- **Live work is drawn in its committed form's box.** A streaming reply is a
  `.msg.assistant.streaming`, and its mark is a 2px bar in the gutter, drawn
  by a border image outside the box, which takes no width: text wraps as its
  entry will.
- **The dock** (`dock.tsx`, ADR-0113) is the column's foot, after the
  scrolling body: the queue's header (`.queue-head`, sticky), the queued
  cards (`.queue-cards`, each a `QueuedCardEditor` in a `.queued-card`, a
  fact a `.queued-fact`), "+ add to queue" (`.add-to-queue`), the line
  (`.the-line`), the column's notices, then what `Column` puts in it: your
  message (`Composer`) and the notes line. CSS caps it at a third of the
  column (`.dock`'s `max-height`) and it scrolls within. It reads presence
  (`readTypingIn`) itself, for `queueHead`, so typing redraws the dock and
  not the column (S59).
- **Which queued cards are blank** is `useBlankQueued` (`blankQueued` over
  the page's copies of their texts), read once in `App`: the lanes take it
  (`readHeldLanes`: a blank card does not wait, so it draws no ring), and
  each column's dock is given it, so ▸ and the ring cannot disagree. It
  changes only when the set does, so typing in a queued card redraws
  nothing that reads it.
  - **The header's one button** (`.next-button`) is `.stop` (sending
    `stop`), `.resume` (`carry-on`) or `.release-queue` ("send queue (n)",
    the `holdQueue` act). Its ⋯ (`.queue-menu-trigger`) holds `.resume`,
    `.hold-queue`, `.release-queue` ("release hold") and `.unqueue-all`.
    The browser suite reads `.stop` as "the lane runs" (`page.ts`), and a
    carry-on message's row is `.msg.carry-on`. No header is drawn
    read-only, nor for a thread with no lane.
  - **▸** is a `data-next`: on `.queue-head` (the run), on the
    `.queued-card` that goes next, or on `.dock` (`message`: your send).
  - **A queued card folds by CSS alone**: its box stays mounted, one line
    high, its footer hidden, until it holds the focus
    (`.card-editor.queued:not(:focus-within)`). A component that swapped a
    face for the editor would remount the box and lose the caret, which
    Alt+↑ must keep.
  - **"+ add to queue"** is the `queueNew` act with `hold-if-idle`; the dock
    focuses the new card's box once it is drawn.
  - **A queued card revealed** (an undo, a trace) is scrolled to in its
    dock (`revealCard`, `useRevealCard`), apart from the thread's scroll.
- **What the agent is doing shows in three places, none taking layout**
  (ADR-0054). `running` (`lane.running`, Stop's fact) is computed once in
  `Column`.
  - The mark before the thread's name (`.thread-mark`: the `✦`, or the
    banner over it) pulses while it is true, titled by `workingWords`, which
    names the running ask (`askWords`, ADR-0106). The square pulses, not
    the star, which a banner hides.
  - A live row the work opened carries `data-revealed`, and
    `.tool.live[data-revealed]::after` draws a ring around it. A call
    shorter than `REVEAL_MS` is never revealed, so it shows none. The ring
    is a positioned pseudo-element, not an `outline`, so it can reach 1rem
    into the column's right gutter (1.75rem, against .75rem on the left)
    and sit centred in the column. The browser suite measures it from the
    row's box and the pseudo-element's resolved insets.
  - `.working-line` is drawn at the content's end for the whole run, before
    the queued cards; in outline the running ask's own line pulses, and
    `.column[data-density="outline"]` hides it. `.column-content:has(.tool.live[data-revealed])`
    hides it, so no value restates `ToolRow`'s live rule or `REVEAL_MS`.
  - **The line has zero height**, drawn by a shadow and lifted by a
    transform. An empty block's margins collapse through it, so the gap is
    the same with or without it. With a height, as `.column-content`'s last
    child its bottom margin escapes the content, and the content, whose own
    height the follow rule reads, would grow and shrink with each run.
  - Playwright counts a zero-height element as hidden: wait for
    `.working-line` with `state: "attached"`, or read its computed
    `visibility` (S67).
- **What a new thread starts from** (ADR-0104, ADR-0102). When a send would
  create a lane and you have WIP bookmarks, a line left of the button
  (`StartLine`, `.start-line`) says what it starts from, in `startWords`'
  words ("starts from accepted work ▾", "starts from your unfinished work:
  wip/x ▾"), and opens `baseChoices` (`send.ts`): accepted work, then each
  WIP with how far it is behind accepted work. With no WIP there is no
  choice, and no line; a fork from a conflicted commit says so there
  (`forkWords`). The base is each editor's state until sent, and is sent
  with the chat. Every thread's agent works in a lane of its own: there is
  no place to choose. The words are `.start-words`: `Menu` passes no
  attributes to its trigger, so they sit on a span inside it.
- **A column's header** (ADR-0040) names who works in it (`✦ amber-fox`,
  `✦ new agent`, or nothing in a conversation), then, in a second row, where
  it forks. It shows no commit and nothing of where the lane works.
- **The work strip** (`WorkStripView`, a row of the column's header,
  ADR-0113) is the lane's
  offer for its own copy (ADR-0105): `offerWords`' line, which opens the
  review while the offer is open and holds files (ADR-0047, below), the
  bookmark apart, which a press copies to find it in jj or jjui, its
  buttons, and a `⋯` menu for the rest
  ("catch up with accepted work", "rewrite description"). What the lane runs
  now (`activityOf`: a turn, a resolution, or a split, from its latest
  prompt's role) comes first: while it runs, accepted work counts files so far
  and offers nothing. A lane with no copy of its own has no strip.
- **Catching up and splitting are a card queued at once** (ADR-0108,
  ADR-0061, ADR-0080): the button is the `queueNew` act, which makes a card
  in the queue with the command and no text, in one `queue-card` request:
  it is never drawn as a note. A split waits while the thread works, and a
  queued one makes the strip's split button quiet (`offerView`'s
  `queued`); only a catch-up makes the offer busy. The card carries its
  command from its first write, so the drain the queueing starts pops it
  with it. Your message in the composer is not touched. A card that carries a command anyway (one unqueued) says above its box what
  sending it does first (`commandNote`), its placeholder says its text is
  optional, and its button names the command (`commandSendWords`: "catch
  up", "catch up and send", "split"), its queue place in the title. The card is
  then queued like any other (`planSend`, which carries the command), and
  the host carries the command out when it pops it.
- **One-line messages** (`LINE_ROLES`, core) show as one line each, their
  speaker from one table (`ROLE_LABEL`, `message.tsx`): `land` ("catching
  up"), `update` ("caught up"), `stack`, `carry-on` ("resumed"), and the
  host's facts, `fact` ("offer": what an acceptance, a squash, a refresh
  or a description asked for did, ADR-0080) and `behind` ("the base": its
  new work). Each line is its rule's words function (`updateLine`,
  `factLine`, `behindLine`, `@pinetrie/rules`); the update's names what it
  merged by `catchUpName`.
- **A fact waiting for a run's end** is drawn above the line as a quiet row
  (`.queued-fact`, worded by `factLine`), with no controls: nobody moves it
  (ADR-0080).
- **"Needs you" comes from the tree** (ADR-0080): the strip's `needs_you`
  is the thread's newest `ask_about_conflict` (`conflictAskedAt`) when it is
  newer than the offer's record.
- **Open offers in your repo** ("work ready to accept") are your inbox's
  rows for the threads you follow, each leading with the thread's name and
  opening it, and a thread card's ⇡ for everyone (ADR-0091). Move to Done
  in an item's `⋯` names the threads whose offers it withdraws (`offeredByRoot`,
  `dropsWords`). All read `openOffers`, which keeps only `offerStatus`'s
  `open` (ADR-0067): one accepted work already holds (`held`) has nothing to
  add, so it is neither counted nor named, as the strip says.
- **Selectors in the browser suite:** a column's offer is `.work.offer`, with
  `data-state` (`ready`, `conflicts`, `stack`, and the rest of
  `offerView`'s states); its line is `.offer-line` (a button when the offer
  can be reviewed; its caret is CSS, so its text is the words alone), its
  bookmark `.offer-bookmark`, and each button `.offer-<button>`, the add
  button being `.offer-accept`. The review is `.review`, with `.review-list` (rows
  `.review-list-file`, titled with the display path) and `.review-diffs`;
  each file is `.review-file[data-key][data-letter][data-state]`, its head
  `.review-file-head`, its diff `.review-diff` of `[data-kind]` lines. The
  28rem check measures `.column-thread`. The header's `.agent-name` holds the thread's name in
  `data-thread` (`.agent-name.pending` before it has one); its origin row
  is `.origin`. A lane's divider is `.lane-join`, with `data-thread`. The
  header's mark is `.thread-mark` (`.pulse` while its lane runs). The name
  has `aria-expanded`; open, the details are `.thread-details`, with
  `.thread-details-icon[data-spin]` around their mark,
  `.thread-details-started`, `.thread-details-where`,
  `.thread-details-working`, `.thread-details-behind` and
  `.thread-details-start`. Accepted work is `.working-line`, and a row the work opened `.tool[data-revealed]`.
- **The invite key** needs no client code: the host's redirect sets a cookie
  that same-origin requests and upgrades carry. `connectSession({ key })` is
  for Node clients.

## Reviewing an offer (`review.ts`, `review-pane.tsx`, `use-fetched.ts`, ADR-0047)

The offer's line opens a review in the column's pane ("A column's pane",
below). So does an ask's file count (ADR-0106): every review is of spans
(`DiffSpan`), an offer's revisions or an ask's range from its prompt's
commit to its last turn's (`askReviewTarget`), and `ReviewTarget.title`
heads a range, which has no description.

- **A column is `.column` > `.column-thread` + its pane.** `.column` stays
  `#strip`'s direct child with its key, position and track, so dragging,
  alignment and revealing find it as before; the thread, 28rem, holds the
  header, body, others' cards, strip and composer. The pane's frame owns
  the review's width, Escape, focus and coming into view, and `PaneHead`
  its head and close; `ReviewPane` draws the list and the diffs inside
  `.review`, which fills `.pane`.
- **Every URL names its commits** (`reviewUrl`, `diffUrl`, `@pinetrie/rules`),
  and the answer is immutable, so the browser's HTTP cache is the only
  cache and `useFetched` has no refetch rule. The record's `commits` is what
  changes; the page never keys on its `at`, which every trigger rewrites.
- **`reviewView` decides the rows**: titles and bodies through
  `withoutTrailers`, letters, line counts, flags by path from the record,
  and each file's placeholder height (`estimate`, in diff lines). A file
  changing more than 400 lines starts collapsed.
- **`sectionState` decides a section**: collapsed while your toggle says so,
  waiting until an `IntersectionObserver` (one per pane, 1,000 px ahead)
  finds it near the view, then its fetch; a 413 is too large. Once near, a
  section stays wanted.
- **Each file's head is `position: sticky` in `.review-diffs`.** Chromium's
  scroll anchoring keeps the view still as sections above it load and
  replace their placeholders.
- **How you read a review is the device's** (`review-prefs.ts`, ADR-0087):
  wrapping and the folded file list, a `deviceState` under
  `pinetrie-review`, the same in every column. `App` provides them as
  `ReviewPrefsContext`, which only `ReviewPane` reads, so no message list
  redraws for them. Wrapping is CSS on `.review[data-wrap]`: `pre-wrap`, and
  a hanging indent of one character, so a continuation clears the `+`/`−`
  column. A wrapped section may load taller than its placeholder's
  estimate; scroll anchoring absorbs it, as it does any section.
- **A 404 for a commit the offer has just left is brief:** the record arrives
  with the new commits, and the review asks for their URLs.

## A column's pane (`pane.ts`, `pane.tsx`, ADR-0078)

Beside the thread, a column has one pane, holding one thing at a time: the
offer's review, an ask's, a table from a message, a stored image, or the
thread's notes board (ADR-0113).

- **A subject is a name, never data** (`PaneSubject`): the offer, the notes
  board (drawn while the column has a thread end), an ask by
  its entry, a table by its entry and its number in that message, an image
  by its hash and the message it is in (null in a reply still streaming).
  `paneKey` names it as a string; `samePane` compares keys, and the pane is
  keyed by it, so another subject mounts afresh and comes into view.
- **`paneView` decides what a subject draws, and null closes the pane.**
  The offer's review goes with the strip's, an ask's with its span, a table
  or an image with its message leaving the column (`ColumnView.nodes`).
  `Column` resets its one state in render when the view is null, so no
  frame draws a pane that is gone, and the next offer does not open it
  unasked. `Column` asks on every render: a message's tree is parsed once
  per node (`treeOf`, a `WeakMap`), and `App` keeps a column's nodes while
  the index is the same, so a table keeps its identity and `TablePane`,
  memoised, redraws only when the column's messages change.
- **The pane's width is the strip's** (ADR-0087, S109). `#strip` is an
  inline-size container, and `.pane` is
  `clamp(40rem, 100cqw - 28rem - 1px, 64rem)`: what the strip has beside the
  thread and `.column`'s right border. The sidebar and the rail are outside
  the container, whatever their width. A container applies no layout
  containment, so the fixed menus inside columns still place against the
  window (S109). `pane.test.ts` reads `index.html` to hold the numbers to
  `pane.ts`'s.
- **Two frames, one breakpoint, measured on the strip** (`narrowStrip`,
  `useStripNarrow`, `NarrowContext`). Wide, the pane is `section.pane`,
  `.column`'s child after `.column-thread`. Where the strip is narrower than
  the thread and 40rem, it is `dialog.pane`, modal, portalled to `body`:
  the top layer covers every stacking context and makes the page inert.
  `App` measures `#strip` with a `ResizeObserver`, so folding the sidebar
  crosses accepted work as a window resize does; crossing it remounts the pane.
  A media query could not: it reads the window, and the sidebar's width
  varies. The strip comes and goes with what the workspace shows, so the
  hook checks on each render whether it still observes the element there.
- **Focus goes back to what had it.** The wide frame reads
  `document.activeElement` in render, before `PaneHead`'s layout effect
  takes focus, and gives it back in its layout cleanup, which React runs
  while the section is still in the document. The dialog closes itself in
  its cleanup, so a modal dialog's own return applies however it goes (S66).
- **The dialog's `close` event is the reader's only when the dialog is
  still in the document and shut.** A cleanup's `close()` dispatches the
  event later: StrictMode's second mount has the dialog open again by then,
  and an unmounted one has been replaced by the next subject's. Taken as
  the reader's, it closed every pane just opened over a narrow window.
- **`--track` is set once, on `.column`**, and on the dialog, which is
  outside it. The pane's border, a shown table's or image's outline and
  ⤢'s pressed colour read it.
- **A table in the pane is `display: table`,** not the thread's
  `display: block; overflow-x: auto`: a table that scrolls itself would pin
  its header row to itself. The pane's body scrolls both ways, and
  `thead th` is sticky in it. These rules come after the `.text` ones,
  which they override at equal specificity.
- **Selectors:** `.column[data-pane]`, `.pane` (`dialog.pane[open]` when
  narrow), `.pane-head`, `.pane-close`, `.pane-body`, `.pane-table`,
  `.pane-image img[data-zoom]`, `.pane-link`; in the thread,
  `.table-wrap[data-shown]`, `.table-bar .table-open[aria-pressed]` and
  `img.blob-image[data-shown]`.

## Message text is markdown (S27)

`messageTree` (`markdown.ts`) turns a message's text into the tree
`MessageText` draws: remark-parse, remark-gfm and remark-rehype, as
react-markdown runs them, then pine·trie's own pass over the tree. Owning the
pipeline keeps the tree a pure function, testable without a DOM.

- **Nothing in it is HTML.** Raw HTML becomes text. A link or image URL keeps
  only http, https, mailto, relative and `#` targets (`safeUrl`, react-markdown's
  `defaultUrlTransform`; micromark's `sanitizeUri` HTML-encodes `&`, which a
  React prop would carry literally).
- **A pasted image is sized in the tree** (ADR-0042). `messageTree` takes the
  message's images by hash, and `finish` gives a `/blob/` image it finds there
  its stored `width` and `height`, `loading="lazy"` and `decoding="async"`.
  The box has its final shape before the image loads, so `alignOnOpen`
  measures stable offsets and following sees one size, not two. The CSS caps
  it at the column's width with `height: auto`, which keeps the ratio the
  attributes give. A blob image the message does not hold (a
  streaming one's) is drawn unsized. A click on a blob image
  (`.blob-image`) opens it in the column's pane, and a Cmd- or Ctrl-click
  in a new tab (`imageClick`).
- **Each table is numbered in the tree** (`dataTable`, in document order,
  nested ones included), so the pane names a table by its message and
  number (`tableAt`, `tableHeads` for its title). `drawTree` draws a tree;
  in a message, `<table>` is `MessageTable`, with its bar, and `<img>`
  `BlobImage`.
- **Streaming text goes through remend**, which closes an unfinished `**`,
  fence or link, with `singleTilde` and `comparisonOperators` off: those
  escape mid-text, and the message would change when it commits. Committed
  text never goes through it.
- **One `white-space: pre-line` on `.text`** shows soft breaks as people type
  them. The pass drops the newlines to-hast puts between blocks and after a
  `<br>` (text with no position), which would otherwise show as blank lines.
  Chrome then ends a paragraph at a shown newline, so a triple-click there
  selects a line.

## The session (`@pinetrie/session`)

The page's one connection to a host is `SessionClient`, from
`@pinetrie/session`; its parts, and the order they are made in, are in
`packages/session/TECHNICAL.md`. `main.tsx` connects and hands its
`exchange` to `ExchangeProvider`, so React renders from the same connection.

## Your message and notes (ADR-0048, ADR-0113)

What you type is a card: a record in the places document, which only the
host writes (ADR-0059), and a `TextDoc` of its own (`session.cardText`),
which this client writes. The page reads the records as `session.cards`; how
the session sends moves and draws them until its copy holds them
(`card-moves.ts`), and when it destroys a spent card's copy, is in
`packages/session/TECHNICAL.md`.

- **A move is planned once.** `planIntent` builds each `Move` with core's
  `moveOf` (an unqueue's target is `noteOf`, a queue's root
  `queueRoot`), from the cards as drawn, and the session sends it.
- **Refusals are worded here** (`refusalWords`), from the session's
  `CardRefusal`: an unqueue the pop beat says "already sent", a move
  someone made first names them. A column draws its own, and the panel the
  inventory's.

- **Where the column's cards are.** `Column` resolves its thread's end with
  `threadOf`, as a reply would go, and finds your message there with
  `yourCard` (`composing` only) and the notes with `cardsAt("note", …)`. A
  fresh column's cards are found by its key (`CardPlace` `fresh`), and
  every one there but your message is drawn as a note. So a tab switch, a
  reload or another device finds the same card: it belongs to the thread,
  not to the mounted column. Nobody else's message is drawn.
- **A column publishes its composer** (`ComposerSpot`: its place and your
  message there) for `planPut`: a put on the column makes a note, a drop on
  the composer (`data-put-composer`) your message, swapping out one with
  text (`App`'s `filled` says which hold text).
- **The notes are on the notes board** (`notes-board.tsx`, `NotesBoard`), a
  `CardGrid` in the column's pane, each opening as a `NoteCardEditor`. The
  column's notes line (`.notes-line`) says how many there are and whose,
  opens and closes the board (`.notes-toggle`), and is the column's drop
  target for a new note.
- **`CardGrid`** (`card-grid.tsx`) draws a `GridView` as index cards, each
  cell a button (the drop target, `dropProps`, and the card's drag) holding
  its `CardFace`. Its keys are `gridKeyAct`'s, on the grid; the open card
  is the caller's (`renderOpen`), drawn over its neighbours from its cell,
  towards the grid's middle (`data-side`), at least as tall as the cell,
  which it hides (`data-open`, by opacity so Escape can focus it again),
  carrying the selection's ring itself. A grid that makes cards
  (`onCreate`, the notes board's `newNote`; never the inventory's) draws a
  "+" in a selected empty cell (`.card-grid-new`) and makes one there on
  it or on Enter, then opens it once it is drawn, its box focused. A face's owner is an `Initial`,
  not an `Avatar`: the suites count people by `.avatar`. A cell's text
  comes from `useCardTexts`.
- **One editor for every card: `card-editor.tsx`, in one frame:
  `card-frame.tsx`** (ADR-0111). `CardEditor` is your composer's and the
  "+ pin" box's; every other card is a `BoundCardEditor`, a note named in
  its header with who else wrote in it. The frame's header is the card's drag handle (`draggable`,
  `data-card`, so Ctrl+Shift+I finds the card from it and `NOT_A_HANDLE`
  keeps a column's drag off it); a press on its ⋯ or × starts no drag. Its
  ⋯ is a `Menu` of the card's Move to ▸ items, then History. Its × discards.
  Its footer holds ↑ and ↓ and the editor's own primary button. What it
  shows is `cardFrame` (`packages/interface/TECHNICAL.md`, *Card frames*).
- **The frame's wrappers are the same with a card and without one.** The
  composer's box must stay one element (below): only what is inside the
  header changes when the card is created, and the room for ⋯ and × is kept
  (`.card-head-acts`), so the header does not shift.
- **`Composer` is the column's foot**: who else is writing at the end
  ("Bea is writing…", from presence) and your message's editor, in the
  `form.composer` the suites select by.
- **One uncontrolled textarea for the editor's whole life.** While there is no
  card, it holds what is typed and nothing else does. The `input` that makes
  `needsCard` true (anything `sendable` would send) creates the card from
  `element.value` and binds the same element to the card's text with
  Kyneta's `attach`, in that one handler: no keystroke falls between them,
  and focus and the caret stay where they are. A card that already exists is
  attached on mount. `editorState` (`card-state.ts`, pure) decides every step
  and names its acts in order (`create`, `attach`, `detach`); the
  component carries them out in turn. A new card is `create` then
  `attach`: bound first, the binding would write into a card that does not
  exist yet, and the first run of typing would be lost.
- **Every write the editor makes itself goes through the element**: a command
  chosen, an update's intent, a pasted image (`insertAt` decides the text).
  Each is `setRangeText` and a dispatched `input` event, so it is typing:
  local, it may create the card; bound, the binding writes it.
- **The editor's own text** (for the button's words, `sendable` and the rows)
  is set from the `input` event and, while bound, from a subscription to the
  card's document, which catches others' edits. No hook depends on whether a
  card exists.
- **Sending.** The editor sends the text it shows, with the card's id, and is
  read-only until the host answers; `sendButton` disables the button while it
  waits. Spent (`appended`, `started`, `queued`),
  the host has deleted the card, and the editor detaches and empties the box.
  On a conflict or a refusal the card is still there, so nothing is put back:
  `settleSend` has no `restore`. "Branch here" hands the text and the card to
  the new column as `pending`, and that column's send spends it.
- **A card gone while bound** (someone else sent it) detaches the box. Gone
  counts only once the card was seen in the records: a card just created is
  not there until the records redraw.
- **Undo** in a box reaches only its card (ADR-0052): `attach` sends Cmd+Z,
  Cmd+Shift+Z and Ctrl+Y to `session.undoFor(card)` (the session's notes say
  how). Creating a card is one step with its first text, so undoing past it empties
  the card; its record, which only the host writes, stays, so the box stays
  bound to it, and Cmd+Shift+Z there brings the text back. Typing is grouped
  by word.
- **The editor's unmount clears its binding's handle** as well as detaching:
  StrictMode mounts twice, and a stale handle leaves the second mount
  unbound.
- **Who wrote in a card** is `writersOfClients(textClients(cardText), seats)`: its
  Yjs `clientID`s, through the host's seat records (`readSessionFacts`
  reads them). Provisional (ADR-0048): undo does not remove a `clientID`, so
  someone who undid everything they wrote is still named. It stays until
  Kyneta can name the writers whose text still stands
  (ADR-0048, *Who contributed*); marks do not use it.
- **Closing a fresh column whose cards hold text** asks in its header: keep
  in inventory, the default (`keep`, below), or discard, which asks the host
  to remove them, outside any history, since no column could show them
  again.

## Pinned cards (ADR-0048 step 5)

A thread's pinned cards are drawn in a strip under its column's header,
outside the scrolling body (`pinned-strip.tsx`), so the thread's direction
stays in view; the strip scrolls past 30vh.

- **`Column` finds them with `cardsAt("pinned", threadEnd, …)`.** A fresh
  column, or one with no thread end, has no strip: a card is pinned at a
  thread's end, and a fresh column has none until its first send.
- **Each is a `PinnedCardEditor`** (`card-editor.tsx`), a `BoundCardEditor`
  with its size (`tokensOf`, four characters a token, as pi estimates) and
  its status in its header. It has no send: Enter is a new line. Its ⋯
  moves it to the notes, to the queue or into your inventory; your
  message's, a note's and a queued card's ⋯ pin it. Pin and unpin are moves
  (`planPin`, `planUnpin`, `card-intents.ts`), so the host records them and
  the undo key outside a box reverses them; `revealOf` shows a pinned place
  as a note, at its thread's end.
- **A card's status is `pinnedStatus`** (`column-view.ts`): the card's
  entry in `pinnedDiff(pinnedInView(index, end), …)`, the walk and the
  comparison the host plans a run's entry from, so the strip and the run
  agree on what the agent read. A card with no text yet has none.
- **"+ pin" opens a box at the strip's end** that makes a pinned card. It
  is a `CardEditor` whose `place` is pinned (`drawnPlace(pinnedOf(…))`, `@pinetrie/session`):
  the composer's create-on-first-keystroke rule, and the same element goes
  on editing the card, so nothing typed between the create and the binding
  is lost, which a hand-over to a `PinnedCardEditor` would. It never sends:
  Enter is a new line, it offers no commands, and Escape or blur closes
  it. While it is open, the strip leaves out the card it shows, as the
  column does for the composer's. `newPinAt` puts "+ pin" in the header
  while the thread has no pinned card, in the strip after, and nowhere while
  the box is open.
- **The empty strip shows only while a card is dragged.** `App` sets
  `data-card-drag` on the body from a card's `dragenter` to its `dragend`
  or drop, and the CSS shows `.pinned-strip[data-empty]` then. An empty strip
  that always took room moved where a column shown again puts its reader.
- **A send carries the pinned cards' versions.** `Column` puts the strip's
  card ids in `how.pinned`, and the session sends each with its version as
  this client has it (`versionOf`, `@pinetrie/session`); the run waits for
  them.
- **The marker above a run's prompt** is `pinnedMarkers(index, nodes)`,
  computed in `MessageList` from the index: a node whose parent is a cards
  entry gets `pinnedMarker(entry, pinnedInView(index, parentOf(entry)))`.
  A cards entry and its prompt are written in one commit, so the prompt's
  parent is the only place to look. The marker draws "no longer applies"
  only when what the entry replaced was read by its own lane: a branch's
  first run retires its parent's cards, and its column draws nothing for
  that. A null marker draws nothing.
- **Selectors for the browser suite (queue control, ADR-0048 step 7):**
  `.queue-controls` (with `data-held`, who holds it), its `.hold-queue`,
  `.release-queue` and `.unqueue-all`; a queued or pinned card's
  `.reorder-up` and `.reorder-down`.
- **Selectors for the browser suite:** `.pinned-strip`, its
  `textarea[data-card]`, and `details.pinned-read` just before its
  prompt's `.msg`. A card's frame is `.card-frame` (with `data-tone`), its
  header `.card-head` (`.card-state[data-state]`, `.card-by`), its ⋯
  `.card-menu-trigger` and its items `.move-to[data-to]` and
  `.card-history-item`; its × `.discard-card`. A notes board is
  `.pane-notes`, its cells `.note-cell[data-cell][data-card]`, the open
  card `.card-grid-open`; the column's `.notes-line` and `.notes-toggle`.
  `openNote` and `closeNotes` (`apps/pinetrie/e2e/browser/page.ts`) open a
  note on the board and close it.

## History and traces (ADR-0048 step 6)

- **Each card's ⋯ has History** (`card-history.tsx`), which opens the
  card's history in its body: `historyWords` for each event, oldest first,
  then `writtenWords`, the card's writers, read only while it is open. A
  card someone other than its owner unqueued or unpinned says so in its
  header (`MovedBack`, `movedBackBy`).
- **They read by context, not props** (`CardHistories`): `App` reads the
  histories with the session's facts and provides them, the seats, the
  session and the reader, in one object kept while those are the same, as
  `pane-context.ts` does for a message. A prop would pass through five
  editors.
- **A column draws your traces at its thread's end** (`traces.ts`):
  `tracesAt` keeps yours whose place resolves to this end (`placeEnd`, as a
  card there would), `traceGroups` makes one line per person and verb
  (`verbOf`), and `traceWords` words it ("Bea queued this", "3 cards moved
  by Bea"). Only a column that can be written draws them: an archived
  root's is a glance.
- **A click is `openTrace`** (`planOpenTrace`, `card-intents.ts`): the card's
  place now, as an undo's answer shows it (`revealOf`); a sent card's
  message; nothing for a card in someone else's inventory.
- **Seen is the host's.** An effect in `Column` sends `traces-seen` for the
  traces it draws, once each, while its `visible` state says the page can
  be seen (the read marks' condition, ADR-0077). The host deletes them; the
  column keeps drawing what it drew until it unmounts (`keptTraces`).
- **Selectors for the browser suite:** `.trace` (with `data-trace`, its ids)
  inside `.traces`; `.card-history-box` and its `li[data-event]`;
  `.moved-back`.

## Thread cards (`thread-card.tsx`, ADR-0111)

- **`ThreadHead` draws a thread card's header** for the board's cards and
  the sidebar's items from the same `ThreadCardHead`: the mark, the label
  (`.board-label` or `.open-label`, what each place's CSS and checks read),
  ⇡ and your pip. A board card's body is `.board-body`.
- **A card's drag reaches the board and the sidebar.** Board columns and
  the footer strip's open states carry `data-put-state`, the sidebar's
  items and its end `data-put-sidebar`, beside the root's own marks; while
  a card is dragged (`body[data-card-drag]`) they are outlined. A card held
  over ▦ for `ITEM_HOVER_MS` opens the board (`App`'s card drag).
- **The open states reach a card's ⋯ through a context** (`ThreadStates`,
  `thread-states.ts`), which `App` provides from the workflow: the
  composer's and a note's editors read it for their Move to a new thread.
- **A root the directory stops naming is pruned** as at settle (`App`): a
  thread lifted back into its card loses its columns, and a page on it
  moves to the sidebar's last root.

## Selectors in the browser suite

- **A message's own text is `.msg > .text`.**
- **`:text-is` matches the smallest element holding the text**, which in
  markdown is the paragraph, not `.text`. The suite finds a plain message by
  `.text > p:only-child:text-is(…)`.
- **Waiting on a selector** is in `apps/pinetrie/e2e/TECHNICAL.md`: a wait
  for an element CSS hides never ends early.

## Who you are (ADR-0037)

A person is their email: the principal every Exchange of theirs names, and so
their writer, `w-<email>`. Kyneta issues each tab its own peer id, a seat, so
the email is the only thing pine·trie chooses.

- **Asked once per browser, before anything connects.** `main.tsx` reads
  `pinetrie-identity` (a `deviceState`, `identity.ts`), or draws the form
  (`identity-form.tsx`: **email:** and **name:**) and waits for it. The form's
  rule is `parseIdentity`, over the host's own `normalizeEmail` and
  `normalizeName`, so it accepts exactly what the host would; the browser's
  own validation is off (`noValidate`).
- **The stored name follows the session's.** `reconcileName` (`identity.ts`,
  pure) is one decision with two steps: `send` the stored name to a session
  that has none for you, or `store` the session's name when it differs from
  the stored one, whichever device set it. So a session that has no name for
  you learns the one you go by now, not the one typed on a first visit. One
  effect in `App` performs it (`nameEffects`), keyed on `settled` and your
  session name: before
  the document settles, a missing name means not yet arrived, as for
  `prune`. It does nothing when nothing is stored for your email, which is a
  tab about to reload. Under `StrictMode` a `send` can run twice on a first
  join; the same name written twice is the same value.
- **Your avatar and name open the account menu** (`account-menu.tsx`,
  ADR-0098), a `Menu` whose `lead` (your avatar, name and email) is drawn
  above its list, since a menu holds only menu items. What it lists is
  `accountView`'s; folded, it holds the inbox, through the same
  `useInboxMenu` as the corner's (`inbox-menu.tsx`), and swaps its sections
  for the inbox's in place, bumping `focusKey` so the first item takes
  focus. The trigger's `title` is your name as shown (`nameFor`), the one
  mentions resolve against.
- **Your picture** (`picture-field.tsx`, ADR-0098) heads the profile page:
  your circle at 96px, "upload a picture" over a hidden file input, and
  "remove". An image chosen, dropped or pasted on the field is decoded by
  the browser (`createImageBitmap`) and cropped in `picture-crop.tsx`: a
  round preview, drawn at twice its CSS size, that a drag moves and a range
  zooms (`moveCrop`, `zoomCrop`). Nothing is uploaded until "use this
  picture", which draws the square at `PICTURE_SIZE` (256) to a canvas,
  sends the PNG to `POST /blob` (`uploadImage`), then asks for the
  `picture` command. A drag's files are hidden until the drop, so
  `dragover` accepts by `dataTransfer.types`.
- **A circle draws its person's picture over their initial** (`Initial`,
  `presence.tsx`): an absolutely placed `img` that covers the circle, so the
  initial shows while it loads, and again if it fails (the failed SHA-256
  is kept, so a new picture is tried). Rail rings, card pips and the
  inventory's borders stay colours: a person there is a mark, not a
  portrait.
- **Your profile is a page** (`profile-page.tsx`, Pages, below). Its submit
  is `planRename` (pure): refuse, unchanged, or send. A rename is sent on
  Enter or save, never on blur: a click on ← back or the sidebar blurs the
  field first. The draft starts from your name when the page mounts, so
  another device's rename does not overwrite what you type.
- **One name field** (`name-input.tsx`) serves the identification screen and
  the profile page: the rule is `normalizeName`, and the hint is `nameHint`, the
  handle the typed name gives. The client's words for the rule are its own;
  the protocol's refusal (`INVALID_NAME`) words it differently, and the
  profile shows it, under its code, only for a rule the client does not know.
- **Sign in as someone else**, in the account menu, clears the stored
  identity and reloads. Every tab subscribes to it, and reloads when another
  clears it or stores another email, so no tab goes on as the old person.
- **Presence is per seat** (`presence-seat.ts`, `@pinetrie/session`), so
  your tabs never overwrite or clear each other's; `core/presence.ts` shows
  each person once, and never you.
- **The host is found by principal** (`@pinetrie/session`): its seat is
  Kyneta's to issue.

## Pages (`page.tsx`, `use-page.ts`, ADR-0098)

A page covers the workspace: the profile is the first. Which page, and how
leaving treats the history, are `page.ts`'s (`@pinetrie/interface`).

- **The page is in the URL's hash** (`#profile`). `usePage` reads it with
  `useSyncExternalStore`, hearing `popstate` (Back and Forward) and
  `hashchange` (a typed URL). `goTo` is the `page` port: opening pushes an
  entry carrying `PAGE_STATE`; leaving goes `history.back()` over an entry
  this tab pushed, else replaces the page's entry with the bare URL
  (`planLeave`), since Back from a page loaded by its URL would leave
  pine·trie. `pushState` and `replaceState` fire no event, so `goTo` tells
  the subscribers itself.
- **The page is a sibling of `#workspace` in its grid cell**, after it in
  the document and at the board's `z-index` (3), so it covers the board
  too; the footer's menus (4) open over it.
- **The workspace stays mounted, laid out and `inert`** (with
  `aria-hidden`). Remounted, its columns would lose their scroll (the
  browser suite's Back check, and its mutation keying `#workspace` by the
  page). With `display: none`, `useStripNarrow` would measure the strip at
  0 and turn an open pane into a modal dialog over the page.
- **Showing anything in the workspace leaves the page**: `planIntent` puts
  `{ kind: "page", to: null }` first when a plan shows a root, a new tab or
  the board (`showsWorkspace`). The keys that act on cards or undo do
  nothing while a page shows (`keyAct`'s `page`).
- **A narrow pane is a modal dialog in the top layer.** Back or Forward onto
  a page while one is open leaves the dialog over the page, and the page
  inert under it. Opening a page from the menu cannot happen then: the
  dialog makes the footer inert.
- **The heading takes focus** when a page mounts (`tabIndex={-1}`): the
  menu item that opened it is gone.

## Gotchas

- **Kyneta's detach puts back the `readOnly` a box had when it was bound**
  (`attach`, `@kyneta/react`). React sets `readOnly` only when its prop
  changes, so a composer bound while its column was read-only stayed so
  once its card left (moved to the notes). `CardEditor`'s `unbind` sets it
  again from its state.
- **A menu closes when an element holding it scrolls** (`popover.tsx`): a
  column that follows its end as its notes change can close a card's ⋯
  just opened. The browser suite opens it again until its item is chosen
  (`chooseOnCard`, `apps/pinetrie/e2e/browser/page.ts`).
- **`.column-floor` is not `.spacer`.** The spacer, inside `.column-content`,
  lines a column up on opening; the floor, after it, holds a following
  column's height (`useFollow`). The floor's rule measures `.column-content`,
  spacer included.
- **A message folded into an ask's work is not drawn**, so it has no
  `.msg[data-entry]` until its fold opens: a check on a finished run's
  work reads the column raw (`readRaw`), or opens the fold.
- **A streaming reply is a `.msg` with no `data-entry`**, as a waiting message
  is. Anything that means "a message in the tree" looks for
  `.msg[data-entry]`; the browser suite counts the agent's steps by
  `.msg.assistant`, streaming or not.
- **A column mounts at `scrollTop` 0, and stays there through layout
  effects.** `useFollow`'s first scroll to its end comes in its
  ResizeObserver callback, a step later. Anything a layout effect measures
  against another column (alignment does) must place that column first.
- **A renamed root's item is an `<input class="open-title-input">`, not a
  `.open-root`**: an input inside a button is invalid HTML, so while the
  field is open, `.open-root[data-root]` is gone. Enter, Escape and blur all
  go through one `finish` that acts once: removing a focused field can fire
  a blur after Enter or Escape, which would save again, or save a cancel.
  Only Enter and Escape give the item focus back; a blur leaves focus where
  the person put it.
- **A folded list draws no `⋯` or ×**: its item's menu opens on
  `contextmenu`, and a check opens it with a right-click. `Popover` leaves
  ArrowDown to the list there, which moves focus between items.
- **An item's `⋯` and × are always rendered, hidden with `visibility`**,
  shown while it is hovered or focused, the one you are on too, or (the
  `⋯`) while its menu is open (`Menu`'s wrapper, `.open-more`, gains
  `open`). The menu is its child, so hiding the `⋯` would hide an open menu
  too. Both are absolutely placed over the label's end, so they take no
  width from the label. A browser check hovers first (`seeInMenu` does for
  every menu in the sidebar or on the board): Playwright waits on a hidden
  target until it times out.
- **The sidebar's right edge is an inset shadow on `#sidebar`**, which the
  selected item's fill covers: a descendant's background paints over an
  ancestor's inset shadow. The item reaches the list's right edge (the list
  has no right padding), so it meets the rail.
- **A column's × (`.close`) is `closable`** (`ColumnSlot`, `appView`):
  hidden on a root's only column (`columnsOf` would give it back).
- **A popover opens above its trigger in the window's lower half, and from
  its left edge in the left half.** A composer's `▾`, and the footer, are at
  the window's foot, so a list below would be out of sight; the sidebar's `⋯`
  and your avatar are at its left, so a box anchored by its right edge
  would open past it. Since `.popover` sets a `top` and a `right` in the
  stylesheet, an upward box sets `top: auto`, and a leftward one `right:
  auto`, or the stylesheet's wins.
- **Anything that pops out of a scrolling list is `position: fixed`.** Your
  list and the board scroll, so a menu positioned inside either is clipped
  by it. `Popover`
  places its box from its trigger's rect when opened, and closes on a
  resize or a scroll of an element holding the trigger, since a fixed box
  would drift from its trigger. Not on any scroll outside the box: a column
  following its end scrolls whenever an entry arrives, which closed every
  open menu without the person doing anything.
- **Playwright clicks what a person cannot see.** It scrolls a clipped element
  into view before clicking, so a check that a popup can be clicked does not
  show it is visible. Check what `elementFromPoint` finds at its centre: the
  browser suite's `chooseFromMenu` does, for every menu. It clicks no
  disabled item: it returns false, so the check expecting the item fails and
  the suite goes on.

- **Selectors for the sidebar and the board:** a root in the sidebar is
  `#sidebar .open-root[data-root="…"]`, the one you are on has
  `aria-current="true"` and its wrap `data-selected`, its × is the
  `.open-close` after it, its `⋯` (`.open-menu`) holds `.rename-root`,
  `.retitle-root` and `.move-to` (`.closes` for
  the closed state), a root being renamed is `.open-title-input`, new tabs
  are `.open-new`, and ＋'s buttons are `.add-agent`, `.add-menu` and
  `.add-conversation`. Folded, an item's `.open-root` or `.open-new` holds
  `.open-icon` (`.open-sprite`, `.open-initials` or `.open-fresh`), its
  menu ends in `.open-close-item`, its tooltip is `.open-tip` and its
  rename field sits in `.open-rename`; the fold control is `.list-fold`, and
  the inventory's toggle is the account menu's `.account-inventory`. The board is `#board`: a `.board-column[data-state]`
  per open state and `.board-closed` for the closed one, each item a
  `.thread-card[data-root][data-entry]` with `.board-open`, `.board-label`,
  `.reader-trigger` per reader (its menu `.reader`, `.open` while open),
  `.root-ready` when a thread has work ready, and `.item-menu`; the states
  scroll in `.board-states`, a head's count is `.board-count` (`[data-kept]`
  while filtered), and a filter's banner is `.board-filter` with
  `.board-filter-clear`, at the board's foot; `.state-name`; a state's ⋯ adds one with `.add-state-left` and
  `.add-state-right`, its field in a `.board-new-state` column.
  The footer is `#bottom`: ▦ is
  `.board-toggle`, whose `data-messages` is the session's message count
  (the browser suite's `countIsHosts` waits on it), with `.board-filtered`
  (⌕) while a filter is on and the board is closed. With the board closed,
  each state is `.strip-state[data-state]`; with it open, the strip holds
  `.board-search` (`[data-filtered]` while a filter is on), its
  `.board-search-clear` and `.board-mine` instead. A strip state and an open
  column's head show `.state-working` and `.state-ready` when nonzero; `connected` (`page.ts`) waits for
  `#sidebar .add-agent` with no `.sync-note`. The corner is
  `.footer-you`: its icons are in `.footer-tools`. Your inbox is `.inbox`,
  its trigger `.inbox-trigger` and badge `.inbox-badge[data-needs-you]`
  (folded, the same badge is on `.me-trigger`); your inventory's toggle is
  `#bottom .inventory-toggle`. Menu rows are `.here-thread`
  and `.inbox-row`, each with `data-entry`. You are
  `#bottom .me-trigger` (its `title` your name, its name `.me-name`),
  opening `.account`, whose lead holds `.profile-email` and whose items are
  `.account-inbox`, `.account-inventory`, `.account-profile`, `.not-you`
  and, in the inbox, `.account-back`. A page is
  `.page[data-page]`, with `.page-back`; the profile's holds
  `.picture-field` (`.picture-upload`, `input.picture-file`,
  `.picture-remove`; cropping, `.picture-crop` with `.picture-preview`,
  `.picture-use` and `.picture-cancel`; `.picture-problem`),
  `input[name="name"]`, `.name-handle`, `.name-problem[data-problem]`,
  `.profile-save`, `.profile-saved` and `.profile-email`. A person's
  picture is `.initial img`. The
  identification screen's email problem is `.identity-problem`.
- **A page with nothing in the sidebar opens on the board**, so a browser check
  that opens a second page opens its thread from there (`openFromBoard`), or
  from a reader on a thread card. To step away from a root so its columns
  unmount, a check opens a new tab and closes it again (`stepAway`,
  `stepBack`).
- **`.column` must stay `#strip`'s direct child**: `use-column-drag.ts`
  queries `:scope > .column`. A column's `.column-body` is inside
  `.column-thread`.
- **The clipboard needs a secure context.** An invite link over plain http
  has no `navigator.clipboard`. There, or when the clipboard refuses,
  `useCopy` (`copy.ts`) selects an element for the reader to copy: the
  bookmark its own text, a message its drawn text and tool rows. It tests for
  `navigator.clipboard?.writeText`, not `isSecureContext`: the browser
  suite hides the clipboard to check that path (S68), and can't make its
  page insecure. In the suite's Chromium, a context without the clipboard
  permissions refuses every write, so only a page given them (the main page,
  and the tool images' page) can check what was copied.
- **`.column-content` must stay unpositioned.** A positioned wrapper becomes
  the messages' offsetParent, and `alignOnOpen` measures `offsetTop` against
  the body's.
- **A ResizeObserver sees an inline element as 0 × 0.** `ToolOutput`'s
  `<code>` is `display: block` for it.
- **A tool row's summary click is its own** (`preventDefault`), and the
  state alone sets `open`. A native toggle would take a capped row to
  closed, and `toggle` fires for React's own `open` too, so it cannot tell
  who opened the row. Enter and Space on a summary are clicks.

- **Every scroll `useFollow` makes is instant.** A smooth one passes through
  positions short of the end, and the rule reads each as the reader leaving.

- **Message tools are hidden until hover or focus**, with `visibility`, so
  their boxes can be measured before a hover. `→` is `.tools > .branch`,
  copy `.tools > .copy`. A browser test must hover a message before
  clicking any of them, and again after moving the mouse elsewhere.
- **Stop aborts a running command only once the command has started.** With a
  slow model, the tool call itself streams first; a check waits for the live
  tool row before clicking Stop, as a person would.
- **`:last-of-type` matches element type, not class.** A lane's divider
  (`.lane-join`) and the stream are `div`s too; find a column's last message by querying `.msg`.
- **The agent's stream renders only in a column containing its tip.** When no
  open column does, the rail's pulse and, in another root, the tab's pulse are
  the only signs, and clicking the rail's pulse opens
  that thread.
