# `@pinetrie/web` — technical notes

The browser page (ADR-0093): React components, hooks and what touches the
DOM, drawing what `@pinetrie/interface` decides
(`packages/interface/TECHNICAL.md`): the sidebar of roots down the left, the
root you are on as a rail beside a strip of columns, and the board in the
footer (`docs/06-interface.md`, ADR-0122). Its connection to the host is
`@pinetrie/session` (`packages/session/TECHNICAL.md`), which declares no
React. The page implements the interface's `AppPorts` (`app.tsx`) and keeps
in the browser what the interface encodes (`tab-state.ts`,
`storage-keys.ts`). What it decides from the browser's own inputs, a
pointer, scroll, the clipboard's formats, the URL, is `@pinetrie/web-core`'s
(`packages/web-core/TECHNICAL.md`), which declares no React: the page is
its shell. The page declares neither `@pinetrie/rules` nor `@pinetrie/reads`
(`workspace.test.ts`): what it draws by that the host decides too reaches it
from interface. A module named here that is not in this directory is
interface's, as `layout.ts`, or web-core's, as `viewport.ts`.

## The build (`vite.config.ts`, `stamp.ts`)

The page is served through Vite by `pnpm dev`, and as Vite's build by
`pnpm serve` (ADR-0148).

- **No Node builtin in what the page bundles.** Vite stubs one with a
  warning, and the build goes on, so the page throws only when the code
  that uses it runs. `biome.json` makes `noNodejsModules` an error in this
  package and every `@pinetrie/*` package it reaches, tests aside, and
  `workspace.test.ts` holds that list to the manifests' closure. Here
  `vite.config.ts` and `stamp.ts` are exempt: they run in Node at build
  time, and the host reads `stamp.ts` (`@pinetrie/web/stamp`). The page
  must never import it.

- **React and React DOM are deduplicated** (`resolve.dedupe`). A
  dependency that resolves a React of its own, as the linked Kyneta
  checkout once did, makes the build bundle two, and the page fails on its
  first hook, after the join form draws (S196). Vite's dev server hides it, so a test builds
  the page and counts one React by its chunks' module paths
  (`stamp.test.ts`).
- **A build writes its stamp,** `dist/inputs.json`: the SHA-256 of each
  file it read, `vite.config.ts` and each file under `public/` (which Vite
  copies without reading), and its mode. A host serving the build rebuilds
  when any differs or is gone (`isStampFresh`): content, not mtimes, since
  a jj checkout rewrites mtimes. Hashing every input takes about 28 ms
  (S196). A new file nothing imports yet cannot change the page until an
  import of it changes a listed file. The stamp names the builder's paths,
  so the npm package ships the build without it, and an installed host
  never rebuilds the page.

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
  compared by value; `sameData` compares a `Map` by its entries. `forks`
  is compared by identity, and `App` keeps it while its data is the same
  (`useSameData`): the rail it comes from is rebuilt on every card's
  change, so another window's typing redrew every list, and the browser
  suite's check of it failed one run in two whenever its card landed
  inside the counted window. The tab's `columns` are kept the same way,
  since the strip they come from is rebuilt with every card too.
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
  `startHost` serves with `NODE_ENV` unset, as `pnpm dev:react` does
  (`pnpm dev` and `pnpm serve` serve production React): React measures every
  render whose props its diff finds changed on its "Components ⚛" track,
  with that diff (`componentRenders` in `apps/pinetrie/e2e/browser/page.ts`).
  A production build records none, and every count would pass, so the suite
  stops at its start unless the page has recorded some. An entry is named by
  the function that rendered: a message's is `MessageView`, the function
  `memo` wraps, and a list's `MessageListView`, so a check counting
  `Message` counts nothing.
- **React stays on 19.2 while the suite reads renders from the performance
  buffer.** React 19.3's development build clears each measure as soon as
  it writes it (`performance.clearMeasures`), so `componentRenders` finds
  none, and the suite stops at its start. Moving to 19.3 means reading the
  measures as they are written, with a `PerformanceObserver` set up before
  the page loads.
- **React measures no render whose props are new objects with the same
  data**, nor one from state (a `useSelector` write). That is the redraw
  `MessageList`'s memo prevents: a tab's `columns` rebuilt on every card's
  change redrew every list, and "another window's card redraws … none of its
  messages" passed anyway. So the list also marks each of its own commits
  (`markCommit`, `commit-marks.ts`: a `useEffect` with no dependency list,
  which does not run for an update inside it or a render React threw away),
  in the development build only, and `componentRenders` counts the marks.
  Both are written in passive effects, which can run after the DOM a check
  waits for has changed, so `componentRenders` reads two frames later.

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
  would store older anchors. So with two tabs open, the device slot holds
  whichever changed last: both move their columns as messages arrive.
- **The codec is the edge** (`encodeLayout`, `decodeLayout`), in the house
  shape: a TypeBox schema, then a build step field by field. A layout decodes
  whole or not at all, and `v` rejects an older one: a `v: 2` layout (before
  your tabs were yours, ADR-0030) is dropped once and overwritten by the first
  save; so is a `v: 5` one (before a column named its thread, ADR-0117),
  and the page opens on the sidebar's last root, else the board.
- **A thread you opened is a card** (ADR-0126): its record and card are the
  host's, so a reload or another device has it; the layout keeps only your
  view of it (`CardView`), by its card's id, which must parse as one.
- **`CardView.pending` is never stored**, by either side: restoring it would
  send its message again. A "branch here" column comes back empty.
  `prefill` is stored, blank or content: only `pending` is sent on opening.
  What was typed over it is a card, your message at its thread (Your
  message and notes, below).
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
that scrolls and for one that opens a column. It, `useLanding` and
`useRevealCard` are one hook each over `useWhenDrawn`, which acts on an
element now if it is drawn, else after each render until it is; they differ
only in what they do to it. Focus is not done this way: a box about to
mount claims it (*A card's focus*, below).

- **It tries at once.** Picking a message a column on the tab you are on
  already draws changes no layout state: `show` for the same tab returns the
  same state, so no render follows, and an effect waiting for one never runs
  (S33: the rail's scroll-to did nothing). Otherwise the id waits for the render
  the pick causes, in a layout effect with no dependencies.
- **Unless a fold opens for it.** `open-at` opens the fold a message is in,
  then reveals it. An ask's last word is drawn while its fold is closed, so
  a reveal at once scrolled to it, and the fold's render then pushed it
  down. `App`'s `openFold` port notes that a fold opened, and its `reveal`
  port passes `afterRender`, which waits for that render (`setOpened`) even
  for a message already drawn.
- **It scrolls only a message that is out of view.** A branch opened from its
  fork point is already level with it, and centring it would undo that.
- **It dispatches `PLACED`.** A column scrolled down, from 0 or from a shorter
  path, has not moved up, so it is still following, and the next resize would
  take it to its end (S33, answer 6). Since the Archive preview went, every
  column it scrolls was placed by `App`'s alignment first, so this is
  defensive: no suite check reaches it (ADR-0122).
- **It is declared after the alignment effect in `App`,** so a pick the
  alignment left out of view is scrolled to in the same commit.
- **`useLanding` outlines where leaving a search landed** (the `landed`
  effect, ADR-0101): `data-landed` on the message once it is drawn, waiting
  as a reveal does, removed on `animationend`. The outline and its fade are
  CSS.

## Searching a canvas (`search-bar.tsx`, `match-list.tsx`, ADR-0101)

The search's values are the interface's (`packages/interface/TECHNICAL.md`,
"Search"). `App` holds its state and builds its result; the page draws the
bar, each column's matches, and the rail's marks.

- **The thread stays under its matches** (S126). Everything in a column below
  its header is in `.column-below`, positioned; in it, `.column-under` holds
  the thread, its details, its cards, its work strip and its composer, and
  takes `inert` while searching. `MatchList` lies over it, absolutely, and
  scrolls on its own. Covering changes no box under it: the body keeps its
  `scrollTop`, and no `ResizeObserver` callback fires, so leaving restores
  nothing. `inert` blurs a focused composer, and Tab cannot reach it.
- **`.column-below` is the messages' `offsetParent`**, and the body's.
  `placement` and `placeOnReturn` measure a message's `offsetTop` against the
  body's, and the difference holds (S126). Only `.column-content` must stay
  unpositioned.
- **A covered column marks nothing read** (ADR-0077): the attention effect
  and `leave` skip `read` while `matches` is not null. It follows its end
  under the layer as before. A mention drawn under the layer still counts as
  seen (`useInbox` reads `shown`), since it is drawn in a column of the canvas
  you are on.
- **An empty query is no search.** `Column.matches` is null until the query
  has a word, so the page is as it was while the bar is open and empty.
- **The stage is a column**: the bar while open, then `.stage-row`,
  which holds `.rail-side` (the 🔍 in `.search-lead`, then the rail) and
  `#strip`. A new canvas's rail has no 🔍 and the same width, so `#strip`'s
  left edge does not move across its first send. The bar's own `.search-lead`
  holds the pressed 🔍 over the rail.
- **Focus.** The bar focuses its field as it mounts, and `/` while it is open
  focuses it again (the `search` port, a frame later). Closed from the bar,
  focus goes back to the rail's 🔍; closed by a pick, it stays where the pick
  left it. `searchFocus` tells `keyAct` where search stands: "focused" in the
  bar, a match list, or with nothing focused.
- **The bar slides in only.** It unmounts as it closes, which has no frame to
  slide out in.

## The page's colours (`index.html`, ADR-0081, ADR-0195)

The first `:root` rule in the stylesheet names every colour the page draws,
and only that rule writes a colour literal. `stylesheet.test.ts` fails on a
hex, a colour function or a colour's name anywhere else. It also fails on
a `var()` with no fallback that names a variable nobody defines, which
would draw nothing (S277).

- **Neutrals are two ramps.**
  - Surfaces, darkest first: `--chrome` (the sidebar and the footer),
    `--sunk` (code, a tool's output, the board), `--page` (the paper the
    columns and the root you are on are drawn on), `--panel`, `--raised`
    (a menu, a hover fill, a field) and `--edge` (the lines between
    regions, and the selected item's sides).
  - Lines, from quiet to hovered: `--line`, `--line-strong`, `--line-hover`.
  - Text, brightest first: `--text-bright`, `--text`, `--text-soft`,
    `--text-dim` (the selected item's left edge too), `--text-muted`,
    `--text-faint` and `--text-quiet`.
- **A hue names its role:**
  - `--accent`: what you act on (drops, filters, focus).
  - `--agent`: the agent's own blue.
  - `--queued` and `--pinned`: a card's place.
  - `--action`: a primary button's fill.
  - `--attention`: what needs you.
  - `--caution`: a refusal or a conflict.
  - `--inventory`: your inventory's amber when `--you` is not set.
  - `--highlight`: a search's match.
  - `--command`: a command's name.
  - `--danger` and `--danger-soft`: a stop or a deletion.
  - `--ok` and `--ok-soft`: a success or an addition.
- **A tint is a mix, not a literal.** A blue band, an amber fill or a
  hue's line is `color-mix(in srgb, var(--hue) p%, var(--page))`, so it
  follows both the hue and the page. A colour that only fades is mixed
  with `transparent`.
- **Three colours are the same on any page:** `--white` (text on a filled
  button, the light square of an image's checker), `--ink` (text on a bright
  fill: a badge, an initial, a match) and `--shadow`.
- **A light set would redefine this rule alone.** Each name is a role, not a
  shade, so no rule outside it needs to change. People's colours are not
  here: `presence.tsx` picks them in code.

`--surface` is the colour behind a thing, set by context: `--page` by
default, `--chrome` in `#sidebar` and `#bottom`, the hover fill on a
hovered item, `--page` on the selected one and on a thread card. A ring that
must read as a gap around a dot (`.signal[data-signal="needs-you"]`,
`.signal[data-signal="unsent"]`) is drawn in `--surface`, so it matches
whatever the dot sits on. `--side` is the sidebar's width, which the
footer's own cell shares: 15rem, 11.5rem under 56rem, and 3rem under
`:root[data-list="icons"]` (ADR-0088).

## Sizes (`index.html`, ADR-0195)

The second `:root` rule holds three scales. Every font size, radius,
padding, margin and gap in the stylesheet is drawn from them:
- `--font-2xs` … `--font-3xl`: .65rem to 1.1rem.
- `--radius-xs` … `--radius-xl`: 2px to 8px, and `--radius-pill`.
- `--space-1` … `--space-12`: .1rem to 2rem.

A value left literal is held to another number, or is relative to its
text:
- the column's 1.75rem right gutter, which a message's → sits in;
- the search field's room for its clear button, and an ask's for its files
  button;
- an initial's px size, set by its circle's, and a thread's large mark;
- the rail's radii, half the width they round;
- `50%` for a circle, and `.85em` for a chip in running text.

A value tied to a padding is written from the same step. The board head's
sticky `top`, a renamed title's negative margin and the diff's hanging
indent are each a `calc()` of the padding they match. A menu's ✓ column is
`--menu-check`, which also indents an item without one and a choice's
detail.

## Buttons (`button.tsx`, ADR-0195)

Every button the page draws is a `Button` or an `IconButton`.
`button.test.ts` fails on a `<button>` written anywhere else.

- **A look is a value:** `primary` (filled in `--action`, `--white` text),
  `outline` (a 1px `--line-strong` border, clear, the parent's text colour)
  or `plain` (clear, the parent's text colour). The stylesheet draws it by
  `data-look`. Its base gives every button the same padding, radius, font
  and cursor.
- **The looks lose to every other rule.** Their rules sit under `:where()`,
  with no specificity, so a button's own class rule, or a context's
  (`.tools button`, `.work button`), sets what it needs and wins. A rule
  never undoes a look's fill: one that clears a background clears a
  background some other rule of its own gives it (`.card-grid-cell >
  button.empty`).
- **`type` is `button` unless given,** so no button submits a form by
  accident. A form's submit names `type="submit"`.
- **`IconButton`** shows only a glyph or an icon. Its `label` is the name
  read aloud in the glyph's place.
- **Class names stay as they were.** The browser suite locates buttons by
  them, and `data-look` adds an attribute without taking one away.

## Colour carries the link, not geometry

Each column takes the rail track of its last message (`branchColors`); its
header, its fork dot in the parent column and its rail track share that
colour. There are no connector lines, so sibling branches never cross.

- **A root seeds its colours** (`palette.ts`, ADR-0089, S110). Its
  `RootId`'s hash picks the slot its trunk takes, and track *n* takes
  `(seed + 7n) mod 12`. Which slot is the same in any client; the page's
  colour for a slot is the stylesheet's `--slot-N`, which `slotColor`
  (`colors.ts`) names as `var(--slot-N)`. The seed of the root you are on, or of the root a
  new canvas minted, is `TrackSeed`, a context `App` provides around the
  stage; `useTrackColors()` turns a track into its colour, slot and
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
- **A root's colour is its trunk's** (`trackSlot` of its `rootSeed`, track
  0): the rail's trunk and the first column take it. A folded list's tile
  (ADR-0088) takes its canvas's (`canvasSlot`), seeded the same way by the
  canvas's id.

## Layout: columns scroll independently

Each column scrolls on its own, its composer at its foot. `alignOnOpen` in
`app.tsx` places a column when it first appears: it scrolls the column (or
grows a spacer above its first message) so that message is level with its fork
point in the column showing it. A shared vertical scroll was tried in design
and dropped: forks far apart could not be seen together
(`docs/06-interface.md`).

- **`placement` (web-core's `align.ts`) is the rule, pure;** `place` in `app.tsx`
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

## The strip (`strip.tsx`, ADR-0116)

`Strip` draws a canvas's strip (`canvasStrip`, `StripView`): the canvas column
(`canvas-column.tsx`), then each card on the canvas in its order, then, among
them, your branches not yet sent. Its first column is a `CanvasColumn` by its
type (`Strip = [CanvasColumn, ...CardColumn[]]`), so no strip lacks one.

- **A folded column is a `.folded-column`** (`folded-column.tsx`), never a
  `.column`: a strip with `data-card` and `data-kind` (`thread` or
  `note-column`, as the wide `Column` and `NoteColumn` carry too), which a
  click unfolds. So `.column` counts whole thread columns, and the browser
  suite counts with it. The folded canvas column is a
  `.canvas-column.folded-column`. Both draw one `FoldedStrip`
  (`folded-strip.tsx`): ⇥, the mark `foldedMark` decides, the name on its
  side, the detail.
- **A strip is its header turned on its side** (ADR-0137): a thread's
  mark and its name at the header's size, in its thread's colour
  (`threadTrackOf`, the `threadTrack` its column takes at the same end).
  Every row above the name has a fixed height, and their sums are the
  registered properties `--strip-mark-top` and `--strip-name-top` (with
  `--strip-width` and `--strip-name-max`), one rule per `data-kind` and one
  for `.canvas-column`. The strip is laid out by them, and a fold reads them
  from the wide column before its strip exists: a change to a strip's rows
  that does not change them moves the strip away from where a fold lands
  its name. Registered (`@property`, `<length>`), they compute to px; an
  unregistered `calc()` would read back as its text. The divider is a
  shadow, not a border, so the name centres in the strip's whole width.
- **`data-position` is a column's index among whole thread columns**
  (`drawnAt`), which the suite's `col(n)` selects by; `position`, its index
  on the canvas, is what Alt+arrows move by.
- **A column's ⋯** (`column-menu.tsx`, `columnHeadEnd`'s `menu`) is its
  card's, for everyone: its width, one column or two (`card-width`); a
  thread's adds a section of Copy to this canvas, Copy to your inventory
  and Move to your inventory, and no canvas (ADR-0127); and, for a reader
  who may write, it ends in a `trash` section, Move to trash, on every
  column (ADR-0161). Each item's class is `column-<key>`
  (`.column-width`, `.column-copy`, `.column-copy-inventory`,
  `.column-take`, `.column-trash`). Neither it nor the canvas column makes
  a column: ＋ past the last column does (ADR-0138).
- **Every ＋ is one split button** (`AddButton`, `add-button.tsx`): it
  draws a `StartButton`, its main item and, when it has one, a `Menu` of
  the rest, with no words of its own; each button's class is `add-<key>`.
  The sidebar's and a board column's make a canvas, with no menu; the strip's, in `.canvas-end` while
  the canvas takes a drop there (so never on a read-only canvas), is drawn
  folded, ＋ over its ▾, and makes a column of the canvas
  (`newColumnButton`).
- **A copy's fork row and a parent elsewhere's** (`Origin`, kind `source`)
  follow a `ThreadLink`; one held by someone else is disabled. A column
  whose path above its thread is folded (`ColumnView.above`) draws
  "↑ N earlier messages" under it, which unfolds it for the column's life.
- **The rail draws a canvas's forest** (`canvasRail`), with each stub a button
  at its fork's row (`.rail-stub`).
- **A thread in your inventory** is a `CompactCard` in its slot and a
  `ThreadPreviewView` opened on the bench (`thread-preview.tsx`), whose **put** puts it
  on the canvas you are on. A thread taken into an inventory stops, and its
  holder sees it there read only (ADR-0124): a mention of it opens nowhere
  while someone else holds it (`inbox-menu.tsx`).
- **Every unfolded column's header ends in ⋯ and one button**
  (`.column-menu`, then `.fold` or `.trash-column`, a bin, ADR-0161,
  ADR-0177), a note column's
  too, drawn by one component (`column-menu.tsx`) from one
  `columnHeadEnd` value: ⇤ is the `fold` intent of its card, on a started
  thread or a note column, and × the same `trash` intent as the ⋯'s
  Move to trash, on a thread not yet started. On such a thread both are
  there on purpose: ⋯ is everyone's and reads the same on every column.
  The page draws whichever button it is given, never asking which. A note column's header is a
  `.column-head` with a thread's `.head-row`, so it takes the same button
  reset, row height and top border (its `--track` is grey), and its ▤ sits
  in the square a thread's mark takes: a rule written for `.note-column-*`
  alone would lose to `.column-head button`. A focused column moves with
  Alt+←/→ (`Focus.inColumn`), and is scrolled into view when it moves with
  focus inside it.
- **The canvas column lists its canvas's trash** (`.canvas-trash`, a row per
  column, `.trash-row[data-card]`, its `.trash-restore`; `data-soon` on a
  row whose deletion is close, in the warning colour), under a line saying
  how long a column is kept (`.trash-keep`). `App` passes the keep
  (`TRASH_KEEP_MS`) to `canvasTrash`, whose value carries it with its rows.

## Folding in motion (`use-fold-motion.ts`, `motion.ts`, ADR-0137, S164–S167)

A fold you ask for moves (`layout` effect's `moves`, the `foldColumn`
port): the name turns onto the strip's, the mark moves to the strip's, the
rest fades, and one right edge closes in. What moves where is
`planFoldMotion`'s (`packages/web-core/TECHNICAL.md`, "A fold in
motion"); `use-fold-motion.ts` measures and plays it.

- **A fold animates the live column, then lands; it lets go only once its
  strip is drawn.** Its animations hold their end (`fill: "forwards"`)
  until `whenDrawn` sees the strip, which runs after React's commit and
  before the paint, and are cancelled there. Cancelled before the commit,
  the old layout shows for a frame (S165): the fold is dispatched from an
  animation's end, outside any event, so React renders it in a later canvas.
- **An unfold lands first, then animates** the column its commit draws,
  from where its strip was, before its first paint. Its render (S164: a
  quarter second for 150 messages here) comes before the motion.
- **The clip and every column after it follow one edge** (`FoldFrame`'s
  `inset`). The column after is drawn above the folding one: an edge of
  its own would cover the turning name the clip keeps clear.
- **The names that turn are `[data-fold-name]` line boxes** at
  `line-height: 1.5`: `inline-block`, so their box is a line box, and a
  number, since `normal` reads back as no length. The header's mark and
  the strip's are `[data-fold-mark]` (`ThreadMark`'s `folds`).
- **Everything beside the path from a kept element up to the column
  fades**, and the generated content of what is on it (the name's ▸). A
  column whose header draws no name at its first commit (a thread not yet
  started, whose composer reports its new lane after the mount) unfolds
  without a turn.
- **The folding column is `inert`** while it moves, so nothing in it takes
  a click on its way out.
- **What is moving is the page's animations with id `FOLD_ANIMATION`.**
  `settleFolds()` finishes them, which lands a fold in flight: before every
  fold, and at a drag's press (`use-drag.ts`), so the drag measures columns
  where they end. No module keeps a flag.
- **Reduced motion** (`reducedMotion()`) stops folds, flights and a drag's
  springs alike.

## A column's view (web-core's `viewport.ts`, `use-viewport.ts`, ADR-0058)

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
  falls inside a capsule, sliced as `capsulePick` reads it, at most two and one
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

## Dragging (`use-drag.ts`, ADR-0134, S153)

Every drag that starts in the page is one engine's: a column's header (a
folded strip's, a note column's too), a card frame's header, a slot's card,
a board card, a sidebar row. Each handle carries `dragProps` (`data-drag-card`
or `data-drag-canvas`), and the engine finds its source with
`sourceOfElement`. It decides nothing: interface's `drag.ts` decides what
a drop does (`planDrop` over `putLanding` and `planRootDrop`,
`dropIntents`), and web-core's what is read and drawn (`sourceOfElement`,
`drawPlan`, `hoverOpens`, `sidebarSpot`). It gathers by source (`DragAt`): a canvas's
drag reads only the root zones, a card's the strip, ▦ and the drop
zones. It marks a target with the attribute the plan's mark names, and
rings and opens what the plan's `opens` names, on the element the target
was read from. It reads the source itself only to arm what moves and to
set `data-card-drag`.

- **An image drags as a card or as a stored image** (ADR-0182). An image in
  a media column is a card (its `.media-image-grip`); a stored image a
  message, a tool's row or the pane draws (`BlobImage`, the pane's `<img>`)
  is an `image` source, by its blob. Either lands on a media column's
  images (`data-put-images`, and `data-put-on` on an image, whose edge the
  engine reads from the pointer, `imageEdge`, and draws as
  `data-drop-edge`), and between columns at the strip's gap the pointer is
  in (`spots`, measured at the press, `cardBeforeGap`), as a file dropped
  there lands, unless a media column takes it. A media column's images
  scroll near their top and bottom while an image is over them
  (`edgeScroll`). Only a column's own handle drags its column: a
  card inside it (a dock's card, an image) moves alone.
- **What the first frame needs is armed at the press**, before the 5 px
  threshold (`DRAG_START`): the strip's box, the columns' widths and
  centres, the neighbours' transitions, the ghost (a copy of the column's
  header, `fixedCopy`, at compact's size). S153 found a drag's one long frame is its first; armed
  at `pointerdown` it falls before anything is seen to move. Columns still
  springing back from a cancel are reset before they are measured, or a
  quick second drag reads a column where it was drawn, not where it is.
- **A canvas's landing leaves the dragged item out of the places it
  measures.** Each frame reads the zones' boxes, and the dragged item's
  box carries its translate: its centre follows the pointer, offset by
  where it was pressed, and counted among the others it moved every
  landing past it by one, so a row pressed below its centre could never
  reach the top. Left out, the gap it leaves lands on its home.
- **A dragged column only translates.** No scale, rotation or shadow on
  it: on a slow machine a long column so drawn cost frames (S153). The lift
  is on its header (`--lean`, a shadow), and off the strip the column is
  hidden and its ghost drawn under the pointer (`.drag-ghost`).
- **A style is written only when it changes** (`write`). Writing every
  transform each frame, the same as the last, brought the 95th percentile
  frame to 33 ms at 4× throttling; written on change, it is the
  baseline's. The engine keeps the element it marked and the mark it
  wrote, and writes again only when either changes. When it read the mark
  back from `data-drop-mark` instead, a canvas's mark (`data-root-drop`)
  never matched, and was written every frame.
- **A drag writes to the DOM, never to React state**: a transform,
  `data-dragging` on what moves, `data-reordering` on the strip,
  `data-card-drag` on the body (an empty pinned strip shows, and drop zones
  are outlined), `data-drop-mark` on the target (`move`, `copy`,
  `replace`, `refused`) or `data-root-drop` for a canvas's landing,
  `data-hover-open` on the target's own element (a sidebar row a card is
  onto, ▦) while its ring fills. It reads the intent state from a function each frame, never
  rebuilt for it. The order changes once, on the drop: a reorder's
  `move-column`, a landing's `put`, a canvas's own drop, the intents a key or
  a menu would send.
- **The click a release sends after a drag is swallowed**, so a header's
  buttons start drags too and a press that moves less than 5 px is their
  click. Text fields, selects and an open menu start none (`NOT_A_HANDLE`).
  The browser's own `dragstart` inside a handle is prevented, so a link or
  an image there does not take the pointer.
- **Touch does not drag** (S154 is open): only a mouse or a pen starts one.
- **Escape, `pointercancel`, or a drop where nothing lands** springs
  everything back; with `prefers-reduced-motion` the springs and the ring
  have no duration.
- **Nothing else in the page uses HTML drag and drop** but a file dropped
  from the desktop, which only the browser's drag can bring: `file-drop.ts`
  is its one door (`boundaries.test.ts` keeps it so, as it keeps the
  clipboard in `clipboard.ts`). `fileDropProps` makes an element take
  dropped files: a card's frame, the picture field, a media column (new
  images at its end) and an image in one (a version, ADR-0182). The
  innermost element that takes files takes the drop alone: its handlers
  stop the event. A drag's files are hidden until the drop, so `dragover`
  accepts by `dataTransfer.types`.
  `useFileDropGuard`, mounted once by the page, cancels a file drop nothing
  took, which the browser would otherwise open in the tab.
- **The order is never realigned.** A column moved right keeps its scroll,
  though it now starts after its fork point. A column moved first loses its
  spacer (`column.tsx`).

## Following a column's end (S32)

A column at its end stays there as it grows; once the reader scrolls up, it
holds still. web-core's `follow.ts` is the rule, pure; `useFollow` (`use-follow.ts`) reads
the scroller, calls it, and scrolls. A running tool's output uses the same hook.

- **It follows height, not data.** A ResizeObserver watches the column's
  viewport and `.column-content`, and scrolls to the end in the frame the
  layout changed. A streaming reply, markdown reflowing, a tool row's detail,
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
- **↓ new below survives an unmount** (ADR-0123). A column of a root tab you
  leave is unmounted, and `useFollow` tells it (`seen.leave`) whether ↓ new
  below showed; the column saves that with its tip (`SeenEnd`) in `App`.
  Mounted again, it starts with ↓ new below when `behind` says it moved on
  since. Nothing clears that before `alignOnOpen` places it: its `holding`
  step leaves `unseen` alone, and its first resize comes after the
  placement. The snapshots are never pruned, unlike `aligned`, which must
  forget every column off the tab you are on: a closed column's key is never
  used again, except `first-<root>`, which comes back as its root's only
  column, placed at its end, and that clears ↓ new below. A reload keeps no
  snapshots. `App` keeps them in a `screenMemory` (web-core's `screen-memory.ts`), a
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
- **The floor is at most a third of the view** (`FLOOR_MAX`, ADR-0123).
  `capFloor` applies wherever the floor is set, so a view that gets shorter
  cuts a standing floor too. `held` counts the capped floor, so what the cap
  gave up is not claimed again. Since tool rows never fold on their own,
  what the floor still takes up is a row's detail the reader folds mid-run,
  and columns opened to the left.

## A proposal's card (`proposal-card.tsx`, ADR-0157)

- **`ProposalCard` draws `proposalView`** and nothing else it decides: a
  button's `press` is null exactly when it is disabled. `MessageList` draws
  one for each proposal `Column` found on its path (`columnProposals`),
  after its ask's row, so the list's memo compares them by value
  (`proposals`), with the card's memory (`proposalMemory`) and the
  column's read-only words by identity and value.
- **Its memory outlives an unmount** as a tool row's does
  (`useRememberedProposal`, after `useRemembered`): each change is written
  to `App`'s `ScreenMemory<ProposalMemory>` in the same call that sets the
  state, so a tab shown again draws the edits as they were left.

## Tools and live work (ADR-0107)

- **A tool call is a row under the agent's message** (`ToolRow` in
  `message.tsx`, a `div.tool`), and `rowView` (`@pinetrie/interface`,
  `tool-row.ts`, ADR-0123) decides all it draws but its head, in this
  order:
  - `.tool-head`: `.tool-tag`, the tool's word ("ran", "read", "searched",
    ADR-0114), absent for a call that touched nothing it names, whose word
    is then its command; then `.tool-status`, ✓ or ✗ (`callMark`). A
    running call has no mark: once ringed, it has `.tool-elapsed`, how long
    it has run (below).
  - `.tool-command`, what the call touched (`callSubject`, core), as
    `rowSummary` reads it: a shell command highlighted, and a long one-line
    chain laid out a step a line (`@pinetrie/shell`). A `grep` or `find`
    shows its pattern and the path it searches.
  - `.tool-output`, the live output's text or the result's, or
    `.tool-images`, a result's images in its text's place.
  - `.tool-more`, the toggle, a `<button>` with `aria-expanded`.

  The command is drawn a line at a time, a `div.tool-line` each (`rowView`
  gives `CommandLine`s), and each line in runs (`Runs`), a
  `<span class="sh-<role>">` each, and a plain run as bare text: a
  command's names, options, strings, variables, redirects, keywords and
  operators are coloured apart.
- **A line that begins a top-level statement is set apart**
  (`CommandLine.startsStatement`, `data-starts`, `@pinetrie/shell`'s
  `statementLines`): a margin above it, not a blank line, so it costs none
  of the summary's 5 lines. A line too long for the row wraps with its
  rest hanging 2ch in, so the rest never reads as a statement of its own;
  an empty line keeps its height (`.tool-line:empty`).
- **A row is its summary or its detail** (`RowMemory.open`, `data-open`).
  The summary shows the command's first 5 lines and the output's last 5
  (`headLines`, `tailLines`), as written: the command is cut after its
  layout, so it keeps it. A line over `LINE_LENGTH` (160) characters ends
  in "…". The detail shows both whole; an output over `SHOWN` (20,000)
  characters keeps its end (`wholeOutput`). Neither scrolls inside the row.
  The toggle names what the summary hides (`moreWords`: "+3 lines · +335
  lines of output", "whole lines", "full size"), or says "less"; a row
  that hides nothing has none. Only the toggle toggles, so the command
  and output can be selected.
- **A row's height holds when its result arrives.** Its output is the
  live stream's text until the result's replaces it, in the same
  `.tool-output`, and both show their last 5 lines: pi's result is the
  stream's text with at most a status line after a blank one (S142). Nothing
  opens or folds on its own, so a fast command and a slow one draw the same
  row.
- **The head floats right, first in the row**, so the command's first line
  runs beside it and the rest have the row's width. `LAYOUT_WIDTH`
  (`tool-row.ts`) is 55 characters: the Mac's SF Mono at .8rem (0.6em a
  character) in a 28rem column's 26.5rem row. Headless Chromium's fallback
  monospace is 0.5em wide, so the width is worked out for the Mac's font,
  not measured (S142).
- **A row keeps what it decided across an unmount** (ADR-0123, ADR-0054).
  `revealed` and `open` are one `RowMemory`, which `App` keeps by call id
  in a `screenMemory`, passed down to `ToolRow` as `rows` (an identity prop
  in both props tables, made once). `revealed` is set by a timer once the
  call's output has streamed for `REVEAL_MS` (500ms) while the row is
  drawn, and never unset; it only rings the row. `useRemembered`
  (`message.tsx`) starts from the memory and writes it in the same call
  that sets the state, so a row unmounted at any moment has left its latest
  state. A remembered `revealed` starts no timer: a running command's row
  on a tab shown again is ringed from its first frame. A reload remembers
  nothing.
- **A result's images are drawn in its text's place** (ADR-0051, ADR-0123).
  `toolBody` reads them from the result; `StoredImage` (`blob-image.tsx`)
  draws each in `.tool-images`, its caption and resize note its `title`,
  the call's path (`subject`) its `alt`. In the summary, an image taller
  than `THUMB_HEIGHT` (160px, 10rem) is a thumbnail (`data-thumb`), capped
  through its width, `min(100%, 10rem × --ratio)`, which `StoredImage`
  sets: overriding `width` would drop the box the `width` and `height`
  attributes give before the image loads. Its toggle says "full size".
- **A result is its own entry in the tree**; `projectSpine` pairs it with
  its call on the same path, so it adds no column row and no rail row. A
  message that only called tools shows only its rows.
- **Live work hands over to its entry in one render** (ADR-0044). `App`
  reads the stream records with the index (`readSessionFacts`), and
  `liveWork` (`live.ts`, pure) decides what is drawn. Each reads its own text
  (`readStreamText`), so a delta re-renders only it.
  - A reply is drawn at the column's end (`Reply` in `column.tsx`) while it
    is its lane's current reply (`isCurrentReply`, the host's own rule). Its
    entry moves the lane's tip, so the entry and the stream's end are one
    change.
  - A tool's output is drawn in its own row (`ToolRow`, which reads its
    stream) while the call has a stream and no result. The result replaces
    it in the same `.tool-output`.
- **A stream goes when its entry arrives,** which a fast model can do between
  two renders, so a check that must see one uses a slow scripted model, or
  holds the reply and releases it a delta at a time (`ScriptedModel.hold`).
  A check that must see a run in progress, not its reply, holds the reply
  and releases none of it.
- **Live work is drawn in its committed form's box.** A streaming reply is a
  `.msg.assistant.streaming`, and its mark is a 2px bar in the gutter, drawn
  by a border image outside the box, which takes no width: text wraps as its
  entry will.
- **The dock** (`dock.tsx`, ADR-0113) is the column's foot, after the
  scrolling body: the queue's header (`.queue-head`, sticky), the queued
  cards (`.queue-cards`, each a `QueuedCardEditor` in a `.queued-card`, a
  fact a `.queued-fact`), "+ add to queue" (`.add-to-queue`), the line
  (`.the-line`), the column's notices, then what `Column` puts in it: your
  message (`Composer`). CSS caps it at a third of the
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
    the `hold-queue` act). Its ⋯ (`.queue-menu-trigger`) holds `.resume`,
    `.hold-queue`, `.release-queue` ("unpause") and `.unqueue-all`.
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
  - **The dock draws `queuedCardsDrawn`**, not the whole queue: a card
    with a command that goes now is left out (`@pinetrie/interface`,
    *What happens next is `laneNext`*). ↑ and ↓ move a card among the cards drawn.
  - **"+ add to queue"** is the `queue-new` act with `hold-if-idle`, which
    arms the new card's focus; its box claims it once drawn (*A card's
    focus*).
  - **A queued card revealed** (an undo, a trace) is scrolled to in its
    dock (`revealCard`, `useRevealCard`), apart from the thread's scroll.
- **What the agent is doing shows in three places, none taking layout**
  (ADR-0054). `running` (`lane.running`, Stop's fact) is computed once in
  `Column`.
  - The mark before the thread's name (`.thread-mark`: the `✦`, or the
    thread's icon over it) pulses while it is true, titled by `workingWords`,
    which names the running ask (`askWords`, ADR-0106). The square pulses,
    not the star, which an icon hides.
  - A live row the work opened carries `data-revealed`, and
    `.tool.live[data-revealed]::after` draws a ring around it. A call
    shorter than `REVEAL_MS` is never revealed, so it shows none: the ring
    is drawn only on a live row, so once the call ends none can show. The
    browser suite reads that state at a held call's first frame, as its
    row is added. The ring
    is a positioned pseudo-element 4px outside the row, taking no layout.
    The row itself reaches 1rem into the column's right gutter (1.75rem,
    against .75rem on the left: `.tool`'s negative right margin), so the
    row, its contents and its ring sit centred in the column. The browser
    suite measures the row's box and the pseudo-element's resolved insets.
  - The same row shows how long it has run in its head (`Elapsed` in
    `message.tsx`, `.tool-elapsed`): `runningFor` (`tool-row.ts`) counts
    from its stream's start, the time in the stream id's uuidv7, minted on
    the host's clock (`streamStart`, core), so a reload or a tab shown
    again counts from the same start. A browser whose clock is behind the
    host's shows 0s until it gets the latest. `Elapsed` redraws itself, not its
    row, at each whole second the call has run, by a timeout to the next
    one (`runningFor`'s `next`). Unlike the ring it takes room, in the
    floated head, so it can wrap the command's first line; its figures are
    tabular, so a tick keeps its width until it gains a digit.
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
  create a lane and you have unfinished work bookmarks, a line left of the button
  (`StartLine`, `.start-line`) says what it starts from, in `startWords`'
  words ("starts from accepted work ▾", "starts from your unfinished work:
  wip/x ▾"), and opens `baseChoices` (`send.ts`): accepted work, then each
  unfinished work with how far it is behind accepted work. With no unfinished work there is no
  choice, and no line; a fork from a conflicted commit says so there
  (`forkWords`, ADR-0072). The base is each editor's state until sent, and is sent
  with the chat. Every thread's agent works in a lane of its own: there is
  no place to choose. The words are `.start-words`: `Menu` passes no
  attributes to its trigger, so they sit on a span inside it.
- **A column's header** (ADR-0040) names who works in it (`✦ amber-fox`,
  `✦ new agent`, or nothing in a chat), then, in a second row, where
  it forks. It shows no commit and nothing of where the lane works.
- **The work strip** (`WorkStripView`, a row of the column's header,
  ADR-0113) is the lane's
  proposed changes for its own copy (ADR-0105): `workStripWords`' line, which opens the
  review while the proposed changes are open and hold files (ADR-0047, below), the
  bookmark apart, which a press copies to find it in jj or jjui, its
  buttons, and a `⋯` menu for the rest
  ("get the latest from accepted work", "rewrite description"). What the lane runs
  now (`laneActivity`: a turn, a resolution, or a split, from its latest
  prompt's role) comes first: while it runs, accepted work counts files so far
  and offers nothing. A lane with no copy of its own has no strip.
- **Getting the latest and splitting are a card queued at once** (ADR-0108,
  ADR-0061, ADR-0080): the button is the `queue-new` act, which makes a card
  in the queue with the command and no text, in one `queue-card` request:
  it is never drawn as a note. A split waits while the thread works, and a
  queued one makes the strip's split button quiet (`workStripView`'s
  `queued`); only getting the latest makes the proposed changes busy. The card carries its
  command from its first write, so the drain the queueing starts pops it
  with it. Your message in the composer is not touched. A card that carries a command anyway (one unqueued) says above its box what
  sending it does first (`commandNote`), its placeholder says its text is
  optional, and its button names the command (`commandSendWords`: "catch
  up", "get the latest and send", "split"), its queue place in the title. The card is
  then queued like any other (`planSend`, which carries the command), and
  the host carries the command out when it pops it.
- **One-line messages** (`isLineRole`, core) show as one line each: `land`,
  `update`, `stack`, `carry-on`, `incoming`, and the host's facts, `fact`
  (what a command on the proposed changes did, ADR-0080; a stop, a member gone, a
  allowance used up, a canvas change) and `behind` (the base's new work). The
  host wrote them all, so each one's speaker is pine·trie (`speakerWords`,
  `@pinetrie/interface`). The speaker label says who wrote a line, as it
  does for a person or the agent, and never what happened: the line's own
  words say that. Each row carries `.host` beside its role, so its style
  follows `isLineRole` rather than a list of roles in the stylesheet. Each
  line is its rule's words function (`updateLine`,
  `factLine`, `canvasFactLine`, `behindLine`, `@pinetrie/rules`); the
  update's names what it merged by `latestSourceName`.
- **A fact waiting for a run's end** is drawn above the line as a quiet row
  (`.queued-fact`, worded by `factLine`), with no controls: nobody moves it
  (ADR-0080).
- **"Needs you" comes from the tree** (ADR-0080): the strip's `needs-you`
  is the thread's newest `ask_about_conflict` (`conflictAskTime`) when it is
  newer than the proposed changes' record.
- **Open proposed changes in your repo** ("changes ready to accept") are your inbox's
  rows for the threads you follow, each leading with the thread's name and
  opening it, and a thread card's ⇡ for everyone (ADR-0091). Move to Done
  in an item's `⋯` names the threads whose proposed changes it withdraws (`openProposedByCanvas`,
  `dropsWords`). All read `openProposed`, which keeps only `proposedChangesStatus`'s
  `open` (ADR-0067): one accepted work already holds (`held`) has nothing to
  add, so it is neither counted nor named, as the strip says.
- **Selectors in the browser suite:** a column's work strip is
  `.work.work-strip`, with
  `data-state` (`ready`, `conflicts`, `stack`, and the rest of
  `workStripView`'s states); its line is `.work-line` (a button when the proposed changes
  can be reviewed; its caret is CSS, so its text is the words alone), its
  bookmark `.work-bookmark`, and each button `.work-<button>`, the add
  button being `.work-accept`. The review is `.review`, with `.review-list` (rows
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

## The review (`review.ts`, `review-pane.tsx`, `use-fetched.ts`, ADR-0047)

The work strip's line opens a review in the column's pane (`{ kind:
"strip" }`, "A column's pane", below). So does an ask's file count (ADR-0106): every review is of spans
(`DiffSpan`), proposed changes' revisions or an ask's range from its prompt's
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
- **A 404 for a commit the proposed changes have just left is brief:** the record arrives
  with the new commits, and the review asks for their URLs.
- **A file shown as a file draws no diff** (`review-media.tsx`): an image
  row's two sides side by side, each an `<img>` of the review's `fileUrl`,
  which the host serves as an image only when its bytes are one; any
  other media row each side's size and a link to open it. A move with no
  lines says so in place of its diff. Neither fetches a diff.

## A column's pane (`pane.ts`, `pane.tsx`, ADR-0078)

Beside the thread, a column has one pane, holding one thing at a time: the
proposed changes' review, an ask's, a folder lane's conflicts
(`conflicts-pane.tsx`, opened by the work strip's "choose versions"), a
table from a message, or a stored image. The conflicts pane draws each
side as a review's section for its path (`ReviewFile`, near the view at
once), and each choice is the `resolve` command; its refusal, while the
thread runs, is said in the pane.

- **A subject is a name, never data** (`PaneSubject`): the proposed changes,
  board (drawn while the column has a thread end), an ask by
  its entry, a table or an image of a message's text by its block's
  address (ADR-0126), an image that is no block (a tool's result, a reply
  still streaming) by its hash.
  `paneKey` names it as a string; `samePane` compares keys, and the pane is
  keyed by it, so another subject mounts afresh and comes into view.
- **`paneView` decides what a subject draws, and null closes the pane.**
  The proposed changes' review goes with the strip's, an ask's with its span, a table
  or an image with its message leaving the column (`ColumnView.nodes`).
  `Column` resets its one state in render when the view is null, so no
  frame draws a pane that is gone, and the next proposed changes do not open it
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
  varies. The strip comes and goes with what the stage shows, so the
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
  message's images and shares (`blobLookup`), and `finish` gives a `/blob/`
  image it finds there
  its stored `width` and `height`, `loading="lazy"` and `decoding="async"`.
  The box has its final shape before the image loads, so `alignOnOpen`
  measures stable offsets and following sees one size, not two. The CSS caps
  it at the column's width with `height: auto`, which keeps the ratio the
  attributes give. A blob image the message does not hold (a
  streaming one's) is drawn unsized. A click on a blob image
  (`.blob-image`) opens it in the column's pane, and a Cmd- or Ctrl-click
  in a new tab (`imageClick`).
- **A shared image too large to fit draws its fitted copy** (ADR-0151):
  `finish` swaps the image's `src` for its share's `shown` and names the
  original in `data-original`, which the pane's image opens.
- **A link to a shared file is a chip** (`markShare`, ADR-0151): its name,
  format and size and its location warning (`shareChip`), `data-share`, and
  `download` named for the file. `ShareLink` opens an image or text in the
  pane (`share` subject; text is fetched and drawn as text, `TextPane`);
  an opaque file downloads. A link to a blob the message does not share
  stays a link.
- **Every block is numbered once** (ADR-0126): each table, code block,
  image and paragraph, the `n`th of its kind in document order, nested ones
  included, by `@pinetrie/rules`' walk over mdast (`markBlocks`), run as a
  remark step, which `remark-rehype` carries onto each element as
  `data-block` (`table-0`). `textBlocks` gives each block's source range
  from the same walk, so the table drawn and the table an address names
  cannot be counted differently (`findBlockElement`, `tableHeads` for a table's
  title). `drawTree` draws a tree; in a message, `<table>` is
  `MessageTable`, with its bar (⤢ opens it; Cmd+C with focus there copies
  the table, its wrap carrying its block),
  and `<img>` `BlobImage`.
- **A link to an address is a chip** (`/a/<address>`, ADR-0126): a
  relative URL, so `safeUrl` keeps it, marked `data-address` and
  `.address-link`; the page's click opens a past one at its entry.
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
  `cardMove` (an unqueue's target is `notesTarget`, the thread's nearest notes),
  from the cards as drawn, and the session sends it.
- **Refusals are worded in `@pinetrie/interface`** (`noticeWords`), from
  the session's `CardNotice`: an unqueue the pop beat says "already sent",
  a move someone made first names them. A column draws its own, and the panel the
  inventory's.

- **Where the column's cards are.** `Column`'s anchor is its thread's end
  (`threadEnd`), where a reply goes, and it finds your message there with
  `yourCard` (`composing` only); before its thread starts, by its thread
  (ADR-0126). So a tab switch, a
  reload or another device finds the same card: it belongs to the thread,
  not to the mounted column. Nobody else's message is drawn.
- **A column publishes its composer** (`ComposerSpot`: its place and your
  message there) for `planPut`: a put on the column makes a note in the
  note column nearest its thread, a drop on
  the composer (`data-put-composer`) your message, swapping out one with
  text (`App`'s `filled` says which hold text).
- **The notes are in note columns** (`note-column.tsx`, `NoteColumn`,
  ADR-0116), drawn in `#strip` at their card's rank on the canvas
  (`strip.tsx`), a `.note-column` with its id as `data-column` and
  `data-card`: its title
  (`.note-column-title`, a button that opens `TitleField`
  (`title-field.tsx`), the sidebar's rename field, and sends `rename` with a `MarkTarget`), its notes one under
  another, each a `NoteCardEditor` (`among` its column's notes, so ↑ and ↓
  and Alt+↑/↓ reorder it), folded to one line until it holds the focus, as
  a queued card in the dock is, and under them the box a new note is
  written in (`NewCardBox`, `.new-card`). The whole column is a drop target
  (`data-put-notes`). A note's acts are sent as a `column` intent keyed by
  the note column's card, so its refusals are said there.
- **A list column's header is one component** (`list-column-head.tsx`,
  `ListColumnHead`): a note column's and a media column's, its kind's icon,
  its title (renamed through `TitleField` with a `card` `MarkTarget`), its
  count (`countWords`), its ⋯ and its fold, and the drag handle.
- **A media column** (`media-column.tsx`, `MediaColumn`, ADR-0182) draws
  its images at its width, two to a row when two wide, each its newest
  version's fitted copy at its stored size, linking to its original. Each
  image has its title, a stepper through its versions (local to the tab), ◀
  and ▶ (a `reorder` act among the column's images) and its grip, a drag
  handle (onto another image of its column it moves before it, onto another
  media column to its end), a bin, and its margin
  (`Margin` with `beside="image"`; a comment records the version it was
  written on, and says so under a newer one, `commentVersionWords`). Files
  dropped on the column are uploaded (`image-upload.ts` over the session's
  `upload`), the images the host kept (web-core's `keptImages`), and put at
  its end (`put-images`); one dropped on an image
  is a version (`add-version`), or at its edge a new image before or after it
  (`fileDropAtProps` hands the point, and its `onOver` the point while a
  file is over, which draws the edge). It, and the strip, say how many files a drop
  left out (`leftOutWords`). The pane's put is a split button
  (`putOnCanvasButton`): a new column after the thread, or one of the
  canvas's media columns from its ▾.
- **A new note or pinned card is written in one box, as your message is**
  (`NewCardBox`, `card-editor.tsx`, over `useCardBox`): local until it holds
  something worth keeping, then the same element bound to the card it
  makes (`new-card`), so no keystroke falls between and focus never moves.
  It holds that card until focus leaves it (`release`), and its list leaves
  the card out meanwhile (`onShows`): drawn there too, it would be two boxes
  on one text. Its tone and words follow from its list (`newCardBox`), and
  its keys are `newCardKeys`': a move (Alt+↑/↓) hands the card to the
  list, armed to take focus there. Its frame never has a card, so no ⋯ is
  offered on a card still being written: a click there would take focus
  from the box and close the pin box under it. It takes no pasted image,
  as no card that exists does. The note column's list is as tall as its
  notes (`.note-column-notes`), so the box follows the last note and stays
  in view once they scroll.
- **`CardGrid`** (`card-grid.tsx`) draws your inventory's `GridView` as
  compact cards, each cell a button (the drop target, `dropProps`, and the
  card's drag) holding its `CompactCard`, and no × (ADR-0177): × only
  closes. Its keys are `gridKeyAct`'s, on the grid, Escape aside (the
  page's); Enter and a click on the selected cell ask the caller to open
  the card on the bench, and Delete or Backspace to trash it, when the
  cell `trashes`. A compact's owner is an
  `Initial`, not an `Avatar`: the suites count people by `.avatar`. A
  cell's text comes from `useCardTexts`.
- **One editor for every card: `card-editor.tsx`, in one frame:
  `card-frame.tsx`** (ADR-0111). `CardEditor` is your composer's alone; a
  new note or pinned card is written in a `NewCardBox`, and every card that
  exists is a `BoundCardEditor`, a note named in
  its header with who else wrote in it. The frame's header is the card's drag handle (`draggable`,
  `data-card`, so Ctrl+Shift+I finds the card from it and `NOT_A_HANDLE`
  keeps a column's drag off it); a press on its ⋯ or × starts no drag. Its
  ⋯ is a `Menu` of the card's Move to ▸ items, then History. Its × trashes,
  except on a card given a close (the inventory's open card), where it
  closes.
  Its footer holds ↑ and ↓ and the editor's own primary button. What it
  shows is `cardFrame` (`packages/interface/TECHNICAL.md`, *Card frames*).
- **Nothing in the header wraps** (ADR-0179). Every item is `nowrap`;
  `.card-by` takes only the room left (`flex: 1 1 0`), so a narrow column
  cuts who first, then `.card-state`, each to "…", with its words in its
  title. The "·" between them is CSS (`::before`), so a header's
  `textContent` holds none.
- **A command's chip is the body's first child**, before the box. It is
  drawn or not in its own slot, so the box keeps its place among the body's
  children and is never mounted again. The frame carries `data-command`
  and a bound card's box `data-empty`; a queued card in the dock with both
  hides its box until the frame holds the focus.
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
  and names its acts in order (`create`, `attach`, `detach`); `useCardBox`
  (`card-box.ts`) carries them out in turn, for your message's box and a
  new card's alike, and is where this rule lives: the binding, the found
  and gone rules, and the `readOnly` Kyneta's detach puts back. A new card
  is `create` then `attach`: bound first, the binding would write into a
  card that does not exist yet, and the first run of typing would be lost.
- **A card's focus is armed by a plan and claimed by its box** (`FocusKey`,
  `claimFocus`, `@pinetrie/interface`): a new comment, "+ add to queue" and
  a new card handed to its list arm the card; `BoundCardEditor` claims it
  in the effect that binds its text, right after binding, and puts the
  caret at the end. Claimed before the binding, the caret would land at the
  end of an empty box. A column's composer and the board's search claim
  their own keys the same way, as they mount. Who may claim is a context,
  `FocusClaim` (`focus-claim.ts`), which `App` provides as one function of
  fixed identity: a new one each render would draw every claimer again on
  every `App` render. One key is armed at a time, so the newest arm wins.
  The "+ pin" box is the one box that focuses itself as it mounts: a click
  in its column opens it, not a plan.
- **Every write the editor makes itself goes through the element**: a command
  chosen, an update's intent, a shared file (`insertSnippet` decides the text).
  Each is `setRangeText` and a dispatched `input` event, so it is typing:
  local, it may create the card; bound, the binding writes it.
- **The editor's own text** (for the button's words, `sendable` and the rows)
  is set from the `input` event and, while bound, from a subscription to the
  card's document, which catches others' edits. No hook depends on whether a
  card exists.
- **Who a message is for** is decided as the host will (`planSend`): the
  column's thread's lane gives its mode, and a mention picks the addressee
  (ADR-0021), another thread's agent among them (ADR-0128). The box
  completes the commands the host's pi loaded (ADR-0036), and the handles a
  mention may name (ADR-0128), by the caret, which it tracks only while
  focused: a blur closes the list.
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
- **The bin on an unstarted thread's column trashes it, asking nothing**
  (ADR-0134, ADR-0177): one move (`planTrash`), its thread's card to the trash with
  your message on it, undone by the undo key.

## Pinned cards (ADR-0048 step 5)

A thread's pinned cards are drawn in a strip under its column's header,
outside the scrolling body (`pinned-strip.tsx`), so the thread's direction
stays in view; the strip scrolls past 30vh.

- **`Column` finds them with `pinnedCardsAtEnd(threadEnd, …)`.** An unstarted
  thread's column, or one with no thread end, has no strip: a card is
  pinned at a thread's end, and an unstarted thread has none until its first
  send.
- **Each is a `PinnedCardEditor`** (`card-editor.tsx`), a `BoundCardEditor`
  with its size (`textTokens`, four characters a token, as pi estimates) and
  its status in its header. It has no send: Enter is a new line. Its ⋯
  moves it to the notes, to the queue or into your inventory; your
  message's, a note's and a queued card's ⋯ pin it. Pin and unpin are moves
  (`planPin`, `planUnpin`, `card-intents.ts`), so the host records them and
  the undo key outside a box reverses them; `revealEffects` shows a pinned place
  as a note, at its thread's end.
- **A card's status is `pinnedStatus`** (`column-view.ts`): the card's
  entry in `pinnedDiff(pinnedInView(index, end), …)`, the walk and the
  comparison the host plans a run's entry from, so the strip and the run
  agree on what the agent read. A card with no text yet has none.
- **"+ pin" opens a box at the strip's end** that makes a pinned card. It
  is a `NewCardBox` whose list is the thread's pinned cards (`pinTargetKey`):
  the composer's create-on-first-keystroke rule, and the same element goes
  on editing the card, so nothing typed between the create and the binding
  is lost, which a hand-over to a `PinnedCardEditor` would. It never sends:
  Enter is a new line, it offers no commands, and Escape or blur closes
  it; Alt+↑/↓ hands the card to the strip, focused there. While it is open,
  the strip leaves out the card it shows, as the column does for the
  composer's. `newPinPlace` puts "+ pin" in the header
  while the thread has no pinned card, in the strip after, and nowhere while
  the box is open.
- **The empty strip shows only while a card is dragged.** The drag engine
  (`use-drag.ts`) sets `data-card-drag` on the body from a card drag's
  start past the threshold to its drop or cancel, and the CSS shows
  `.pinned-strip[data-empty]` then. An empty strip
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
  `.card-history-item`; its bin `.trash-card`, and on the bench its ×
  `.close-card`. A note column is
  `.note-column`, its notes `.card-editor.note` with their
  `textarea[data-card]`. `openNote` (`apps/pinetrie/e2e/browser/page.ts`)
  focuses a note's box, which unfolds it.

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
  `endTraces` keeps yours whose place resolves to this end (`placeEnd`, as a
  card there would), `traceGroups` makes one line per person and verb
  (`changeVerb`), and `traceWords` words it ("Bea queued this", "3 cards moved
  by Bea"). Only a column that can be written draws them: an archived
  root's is a glance.
- **A click is `open-trace`** (`planOpenTrace`, `card-intents.ts`): the card's
  place now, as an undo's answer shows it (`revealEffects`); a sent card's
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
  over ▦ for `ITEM_HOVER_MS` opens the board (the drag plan's `opens`).
- **The open states reach a card's ⋯ through a context** (`ThreadStates`,
  `thread-states.ts`), which `App` provides from the workflow: the
  composer's and a note's editors read it for their Move to a new thread.
- **A root the directory stops naming is pruned** as at settle (`App`): a
  thread lifted back into its card loses its columns, and a page on it
  moves to the sidebar's last root.

## The sidebar, the board and the footer (ADR-0122)

- **The sidebar is yours** (`sidebar.tsx`): × closes a root for you alone,
  while its ⋯'s Rename titles the root for everyone, as its mark (ADR-0045),
  and Move to ▸ the archive archives it for everyone (ADR-0029).
- **The board's search and "mine" filter every state in place**
  (ADR-0109), and sit in the footer's strip while the board is open; ▦
  carries ⌕ while a filter is on and the board is closed, so a kept filter
  is not missed (ADR-0115, `board.tsx`).
- **A board column's head stays in view as its cards scroll.** It is
  `position: sticky` in `.board-states`, which is a one-row grid so that
  every column is as tall as the tallest and a short column's head holds
  too. As a flex row with `align-items: stretch`, the columns would stretch
  only to the board's visible height, and the heads would leave with them.
  Chromium sticks a head inside the scroller's padding, where scrolled
  cards would show above it, so the head reaches up over that padding
  (`index.html`).
- **The publish button** (`footer.tsx`) says set up before accepted work
  exists, then publish while there is something to publish (ADR-0090).
  Whether a publish catches your files up or moves `main` alone is the
  host's `offers.getLatest` (ADR-0099, which amends ADR-0076).

## Threads' icons (`thread-icon-image.tsx`, `public/noun-icons/`, ADR-0143)

- **One image draws every icon**: `ThreadIconImage` sets `src`, an empty
  `alt` and `data-kind` from a `ThreadIcon` (`@pinetrie/interface`), for
  the mark (`ThreadMark`), the folded list's `.open-sprite` and a slot's
  `.compact-mark`. The CSS in `index.html` draws by `data-kind`.
- **Only a banner is blended.** A banner is drawn on black, which
  `mix-blend-mode: lighten` takes out; a built-in icon has a transparent
  ground, and lighten would take out its dark outline too. The rules are
  `[data-kind="banner"]`'s.
- **A built-in icon is pixelated only where magnified**: in the details,
  7rem is ×7 its 32 pixels at 2× DPR. In the header (1.5rem, 48 device
  pixels), the strip, a card and the folded list it is shrunk or scaled
  under ×2, where nearest-neighbour would drop or double pixels unevenly, so
  it is smoothed.
- **The 256 icons are files named by noun**, `public/noun-icons/<noun>.png`,
  which Vite serves at the page's root, behind the host's admission like
  every other asset (`routes.ts`' `other`). Named by noun, not by index, so
  reordering `NOUNS` cannot mismatch them. `noun-icons.test.ts` holds the
  folder to exactly `builtInIconUrl` of every noun. They were cut from the
  sheet in `docs/findings/S188-noun-icons/` (`noun-icons.png`, its order
  `prompts.json`), where each noun's 64 candidates were chosen from.

## Renderings (`renderings.tsx`, ADR-0126, ADR-0171)

Every kind of card is drawn at three sizes, compact, normal and full, each
a box of its own size: the stylesheet's `--compact-w` and `--compact-h`
(half a column's inside, a header row and two lines) and `--column`. A
surface lays out in these and sets no card's size of its own: the
inventory's grid columns are `--compact-w`, its frame two `--column`s.

- **Compact is one component for every kind** (`CompactCard`), drawing
  `cardCompact`'s value (`packages/interface/TECHNICAL.md`, *Card grids*):
  a header row, then the lead and the second line as one flow that
  `-webkit-line-clamp: 2` cuts, `overflow-wrap: anywhere` breaking a URL
  (S241). A reference's lead is its quote once `useQuote` has it. No kind
  draws a compact of its own.
- **Normal and full are one row per kind**: `RENDERINGS` has one row per
  drawn kind with its `Normal` and `Full` and its icon (`KIND_ICON`),
  declared with `satisfies { [K in DrawnKind]: Renderings<K> }`: a kind
  added to `CardRecord` does not compile until it draws both
  (`renderings.test.ts` proves it with `@ts-expect-error`). `DrawCard`
  picks the row by the card's kind, in a switch that is total too. A
  canvas's card is no `DrawnCard`: the board draws it (`boardView`), and an
  inventory never holds one (`heldBy`).
- **The rows wrap what exists.** A text card normal is its text through
  `MessageText`, read only and bounded at a column's height
  (`.card-normal`); full, its editor in its frame (`BoundCardEditor`, with
  its put), whose × trashes it, on the bench as anywhere. A thread normal
  is its first and last messages, full `ThreadPreviewView`. A note column
  normal is its title and first notes, full all of them.
- **A reference's quote is fetched once per page** (`useQuote`), and kept
  by its blob for a copy to read (`fetchedQuote`): a quote never changes.
- **A row's components take their card and width alone**; what a surface
  gives them beyond that (the session, the reader, a thread's preview, the
  note columns, where a put lands) is `RenderingContext`, given by
  `RenderingProvider`. The inventory panel gives it.
- **On a canvas, full is the column**: `Strip`'s switch over
  `CardColumn` draws each kind's column, total in the same way, and a
  folded one its strip (`FoldedColumn`), which is no size. The rows' `Full`
  is a card opened off a canvas: the bench's open card.

## Your inventory's panel (`inventory-panel.tsx`, ADR-0171)

- **It is always in the page**, hidden while closed (`display: none`), so
  it grows from its toggle and shrinks back into it (`scale` and
  `opacity`, `transition-behavior: allow-discrete` on `display`,
  `@starting-style` for the first frame; S243). Its presence is no open
  state: read `data-shown`. Its origin is the toggle's centre in its
  laid-out box (`offsetLeft`, which no transform moves), set before the
  first frame is painted.
- **It is centre-docked by `left`, not a transform**, and it scales with
  the `scale` property, which a dock's drag (`translate`) composes with.
  A flight into a slot measures it by layout (`layoutBox`), so a
  `translateX(-50%)` on the panel would land every ghost half a panel off.
- **A flight into it is a ghost on the page** (`use-flight.ts`'s
  `flyGhost`, `fixedCopy`): flown inside the growing panel, a card starts
  hundreds of pixels from where it was (S243). The slot is hidden until
  the ghost lands, cancelled or not.
- **A click on the bench opens its card only when it ends no text
  selection** (S242): a drag across the normal card's text fires `click`
  too, and opening would lose the selection.
- **A bin trashes, × closes** (ADR-0177). The bin is drawn
  (`TrashIcon`, `icons.tsx`): U+1F5D1 is missing from common fonts. A card
  open on the bench gets `RenderingContext.onClose`, which its frame draws
  as × (`CardFrame`'s `onClose`, a reference's `NormalFrame` too) in place
  of its bin: the bench's bar (`.bench-bar`: `PutButton`, then
  `.trash-selected`) holds its put and its trash, always drawn, disabled
  on an empty slot, so the bench keeps its height.
- **Opened on the bench, its card takes focus**: its text box, else its
  first enabled button (a reference's Edit as text, a thread's put), else
  the bench. Folded by Escape, focus goes back to the selected slot, where
  the grid's keys are; a card that leaves the bench (put, dropped,
  trashed) moves no focus, or a key pressed after would land in the
  panel (Ctrl+Z undoing a swap, not the move), and the bench folds, so a
  card put in that slot later is not opened.
- **Its size is the viewport's alone**: the bag and the bench are each a
  `--column`, its body's height follows its rows (`--rows`), the status
  line is one line always. Its top is 30vh, or higher where that would put
  its foot under the footer. Below 58rem of viewport it is one column, the
  bench taking the bag's place while its card is open (`data-bench`).

## Selectors in the browser suite

- **A message's own text is `.msg > .text`.**
- **`:text-is` matches the smallest element holding the text**, which in
  markdown is the paragraph, not `.text`. The suite finds a plain message by
  `.text > p:only-child:text-is(…)`.
- **Waiting on a selector** is in `apps/pinetrie/e2e/TECHNICAL.md`: a wait
  for an element CSS hides never ends early.
- **A search** (ADR-0101): `.search-bar`, `.search-toggle[aria-pressed]`
  (in `#stage .rail-side` while closed, in the bar while open),
  `.search-field`, `.search-clear`, `.search-done`, `.search-line`; a
  column's `.match-list`, `.match-row[data-entry]`, `.match-gap`,
  `.match-none` and its header's `.match-count`; the rail's
  `.rail[data-searching]` and each item's `[data-match]`; and
  `.msg[data-landed]` where leaving landed.
- **A proposal's card** (ADR-0157): `.proposal[data-proposal]` in its
  column, after its ask's work and outside `.ask-work`; its rows
  `.proposal-row` (`data-dropped`), each a `.proposal-title` button and
  `.proposal-line` or, opened, `.proposal-brief`; `.proposal-drop`;
  `.proposal-start`, `.proposal-open` (absent while the run runs or the
  column is read only), `.proposal-send` (disabled while a press would be
  refused) and `.proposal-state`.

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
  sends the PNG to `POST /blob` (the session's `upload`), then asks for the
  `picture` command. A drop reaches it through `fileDropProps`.
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
- **Presence is ephemeral, written by each client for its open columns**
  (ADR-0024), each naming the root it is in (ADR-0063, `use-presence.ts`).
- **Presence is per seat** (`presence-seat.ts`, `@pinetrie/session`), so
  your tabs never overwrite or clear each other's; `presence.ts` (`@pinetrie/interface`) shows
  each person once, and never you.
- **The host is found by principal** (`@pinetrie/session`): its seat is
  Kyneta's to issue.

## Pages (`page.tsx`, `use-page.ts`, ADR-0098)

A page covers the stage: the profile, the setup page
(`setup-page.tsx`, ADR-0146), which draws `setupView` from the account
menu's **Setup**, and a folder project's history (`history-page.tsx`,
ADR-0165), which draws `historyView` from the footer's **history** link.
An entry's review opens in place (a `ReviewPane`), fetched only then; a
restore opens its preview, which says the folder holds the version when
its review is empty, and offers no restore then. Which pages there are, and
their words, are interface's `page.ts`; a page's hash, and how leaving
treats the history, web-core's `page-url.ts`. The composer's "See Setup" link is a
plain `#setup` anchor: `usePage` hears the hash change.

- **The page is in the URL's hash** (`#profile`). `usePage` reads it with
  `useSyncExternalStore`, hearing `popstate` (Back and Forward) and
  `hashchange` (a typed URL). `showPage` is the `page` port: opening pushes an
  entry carrying `PAGE_STATE`; leaving goes `history.back()` over an entry
  this tab pushed, else replaces the page's entry with the bare URL
  (`planLeave`), since Back from a page loaded by its URL would leave
  pine·trie. `pushState` and `replaceState` fire no event, so `showPage` tells
  the subscribers itself.
- **A sideways scroll never goes Back.** `index.html` sets
  `overscroll-behavior-x: none` on `html` and `body`: a strip or diff
  scrolled past its edge chains to the root, where Chrome's trackpad
  swipe would navigate. No prompt guards Back instead: a page cannot
  draw its own, and `beforeunload`'s would also stop every reload.
- **The page is a sibling of `#stage` in its grid cell**, after it in
  the document and at the board's `z-index` (3), so it covers the board
  too; the footer's menus open over it, in the top layer.
- **The stage stays mounted, laid out and `inert`** (with
  `aria-hidden`). Remounted, its columns would lose their scroll (the
  browser suite's Back check, and its mutation keying `#stage` by the
  page). With `display: none`, `useStripNarrow` would measure the strip at
  0 and turn an open pane into a modal dialog over the page.
- **Showing anything in the stage leaves the page**: `planIntent` puts
  `{ kind: "page", to: null }` first when a plan shows a root, a new canvas or
  the board (`showsStage`). The keys that act on cards or undo do
  nothing while a page shows (`keyAct`'s `page`).
- **A narrow pane is a modal dialog in the top layer.** Back or Forward onto
  a page while one is open leaves the dialog over the page, and the page
  inert under it. Opening a page from the menu cannot happen then: the
  dialog makes the footer inert.
- **The heading takes focus** when a page mounts (`tabIndex={-1}`): the
  menu item that opened it is gone.

## The clipboard (`clipboard.ts`, `focus.ts`, ADR-0132)

`clipboard.ts` is the one file that touches the clipboard
(`boundaries.test.ts` keeps it so): the page's `copy`, `cut` and
`paste` events, a paste's files (`eventPastedFiles`, which the card boxes
call, and `pastedImages`, the picture field's), and a button's copy
(`writeTextByButton`, `useCopy`'s). Each handler gathers where focus is
(`focusFacts`, `focus.ts`, the one gather the keys read too) and what was
pasted, asks the planners (interface's `clipOfFocus` and
`targetOfFocus`, web-core's `planCopy` and `readPaste`), and carries out
what they say.
What S151 measured, and these handlers rest on:

- **`setData` counts only inside the event**, synchronously: a copy cannot
  wait for anything, so a reference's quote is written only if this page
  has already fetched it (`useQuote` keeps each, `fetchedQuote`), else its link.
- **The events fire away from a text box**, on a focused element with
  nothing selected, in Chromium, Firefox, WebKit and Safari, with no
  workaround. So a card's header (`.card-head`), the clipboard cell and a
  table's bar take focus, and a copy there writes the card, the cell's copy
  or the table.
- **`text/html` is the carrier that survives**: another origin, another
  browser, the system clipboard. WebKit writes it again in its own form
  (`data-pinetrie="{&quot;…}"`), so it is parsed (`DOMParser`), never
  matched. `application/x-pinetrie` survives only within one browser, and
  WebKit keeps it to one origin.
- **A rich text box in Firefox carries `data-pinetrie` back** on text
  someone changed: the carrier names its text, and counts only when the
  pasted text is it.
- **Nothing reads the clipboard before a paste** without a prompt or a
  refusal, so the clipboard cell shows this tab's last copy, and a paste
  that brings something else replaces it.
- **The keydown comes before its paste**, so Shift held for Cmd+Shift+V is
  known by then; WebKitGTK fires no paste for Ctrl+Shift+V at all.
- **A pasted file is the box's own**: the card boxes and the picture
  field handle it on the element, first, and prevent the default; the
  document's handler leaves an event already handled alone.
- **Every writable card box shares files** (`useShareFiles`, ADR-0151): the
  composer, a bound card's box and the new note box. Its frame takes a
  drop and draws "share a file" and the share's status (`CardFrame`'s
  `share`); a read-only box passes no target, so it has none. A box bound
  to a card anchors where a share goes as two positions in the card's text
  (S212): the start after anything typed at it meanwhile, the end before,
  so a share never replaces text it was not put over. An unbound box holds
  only its sender's typing, so its offsets stand.

## Gotchas

- **A fold reaches the layout about 200 ms after its click**, once its
  column has moved into its strip: a check that reads the layout after a
  fold waits for `.folded-column`, and one that folds twice waits between.
  An unfold lands at once and moves for 200 ms after: a check that measures
  columns waits for no animation with id `fold` to be left.
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
  field is open, `.open-root[data-canvas]` is gone. Enter, Escape and blur all
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
- **A thread not yet started has × and no ⇤** (`columnHeadEnd`): only
  it closes from its head (a branch not yet sent, a new tab's, a copy
  before its first send), and every other card column folds by ⇤
  (`.fold`). A browser check that folds must fold a started column.
- **A popover opens above its trigger in the window's lower half, and from
  its left edge in the left half** (`placeBox`, web-core's `popover-place.ts`). A
  composer's `▾`, and the footer, are at the window's foot, so a list below
  would be out of sight; the sidebar's `⋯` and your avatar are at its left,
  so a box anchored by its right edge would open past it. Its `maxHeight`
  is the room on the side it opens to, less `EDGE`, so a long list scrolls
  inside it rather than past the window.
- **A popover's box is in the top layer** (`popover="manual"`, shown with
  `showPopover()` in `Popover`'s layout effect). A stacking context on
  anything holding the box trapped it: `.column-head` isolates for its
  banner's blend, so a column's ⋯ opened under the column's messages,
  which are positioned and come later. The top layer is above every
  stacking context and clipping container, the narrow pane's modal dialog
  too when the box opens inside it, and the box stays where it is in the
  DOM, so `contains`, events and inherited styles work as before.
  `manual` leaves light dismiss and Escape to `Popover`.
  - `.popover` undoes the browser's own `[popover]` rules (`margin`,
    `inset`, `color`, `overflow`) and sets no position: the browser makes
    a popover `position: fixed`, and the placement is inline.
  - The stylesheet's `.popover { display: flex }` beats the browser's
    `[popover]:not(:popover-open) { display: none }`, so a box not yet
    shown is drawn in its stacking context. `showPopover()` runs in a
    layout effect, before paint, so none is seen that way.
  - StrictMode runs the effect twice, and `showPopover()` throws on a box
    already shown, so it is guarded with `:popover-open`.
  - The browser check "a column's ⋯ opens over the column's messages"
    fails without the top layer only while `.column-head` isolates. If
    that isolation goes, its mutation goes uncaught, and the check needs
    another trap.
- **A popover closes on a resize or a scroll of an element holding its
  trigger**, since its box, placed from the trigger's rect when opened,
  would drift from it. Not on any scroll outside the box: a column
  following its end scrolls whenever an entry arrives, which closed every
  open menu without the person doing anything.
- **Playwright clicks what a person cannot see.** It scrolls a clipped element
  into view before clicking, so a check that a popup can be clicked does not
  show it is visible. Check what `elementFromPoint` finds at its centre: the
  browser suite's `chooseFromMenu` does, for every menu. It clicks no
  disabled item: it returns false, so the check expecting the item fails and
  the suite goes on.

- **Selectors for the sidebar and the board:** a canvas in the sidebar is
  `#sidebar .open-root[data-canvas="…"]` (ADR-0116); the one you are on has
  `aria-current="true"` and its wrap `data-selected`, its × is the
  `.open-close` after it, its `⋯` (`.open-menu`) holds `.rename-root`,
  `.retitle-root` and `.move-to` (`.closes` for
  the archive), a root being renamed is `.open-title-input`, and ＋'s
  button is `.add-canvas`, with no menu (ADR-0158); past the last column,
  `#strip > .canvas-end`'s are `.add-agent`, `.add-menu`, `.add-chat` and
  `.add-note-column`. A new canvas is a canvas's `.open-root` (ADR-0126). Folded, an item's `.open-root` holds
  `.open-icon` (`.open-sprite` or `.open-initials`), its
  menu ends in `.open-close-item`, its tooltip is `.open-tip` and its
  rename field sits in `.open-rename`; the fold control is `.list-fold`, and
  the inventory's toggle is the account menu's `.account-inventory`. The board is `#board`: a `.board-column[data-state]`
  per open state and `.board-archive` for the archive, each item a
  `.thread-card[data-canvas][data-entry]` with `.board-open`, `.board-label`,
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
  unmount, a check opens a new canvas and closes its column again, which
  trashes its canvas (`stepAway`, `stepBack`).
- **`.column` must stay `#strip`'s direct child**: `use-drag.ts` and
  `focus.ts` query `#strip > [data-card]`. A column's `.column-body` is inside
  `.column-thread`.
- **A button's copy needs a secure context.** An invite link over plain
  http has no `navigator.clipboard`, which only a button's copy uses
  (`writeTextByButton`, `clipboard.ts`): Cmd+C, Cmd+X and Cmd+V are the
  clipboard events, which work over plain http too. There, or when the
  clipboard refuses, `useCopy` (`copy.ts`) selects an element for the
  reader to copy: the
  bookmark its own text, a message its drawn text and tool rows. It tests for
  `navigator.clipboard?.writeText`, not `isSecureContext`: the browser
  suite hides the clipboard to check that path (S68), and can't make its
  page insecure. In the suite's Chromium, a context without the clipboard
  permissions refuses every write, so only a page given them (the main page,
  and the tool images' page) can check what was copied.
- **`.column-content` must stay unpositioned.** A positioned wrapper becomes
  the messages' offsetParent, and `alignOnOpen` measures `offsetTop` against
  the body's.
- **The copy fallback selects what a row draws**: a row in its summary
  gives its summary's lines, not the whole command and output, which only
  the copied text (`copyText`) holds. `.tool-more` is `user-select: none`,
  so the toggle's words are never in it.
- **A tool row is not a `<details>`**: its summary must show the command
  and output, and a `<summary>` would make them one click target, which
  cannot be selected, and its `toggle` fires for React's own `open` too.

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
