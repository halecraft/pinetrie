# `@pineta/client` — technical notes

The browser interface: a tab per root, each a rail beside a strip of columns
(`docs/06-interface.md`, ADR-0029). Everything drawn is a read of the session
document through `@pineta/reads` and `projection.ts`; the only state kept here
is the layout (which tab you are on, and each root's columns), kept per
browser tab, and the text being typed.

## Reads go through one index

`readTreeIndex(doc)` (`@pineta/reads`) builds `indexTree` once per document
change. The columns, the rail and the agent's path all read that one index
(`packages/core/tree.ts`). `App` reads it inside a single `useTracked`, together
with the agent's activity, the lanes, the outbox and the participants, so they
are always from the same moment; `sync` takes the index and the lanes together.

## Root tabs and the layout (`layout.ts`, ADR-0029, ADR-0030)

The layout is `{ active, open, roots, newTabs }`, and `layoutReducer` is pure.
A root tab's key is its root entry's id: a thread started at the root is
rooted at its first message (S30). `open` is your tabs: the roots you opened,
in that order. `tabBar(layout)` is Archive, `open`, then new tabs.
`summarizeRoots` and `rootWork` (`packages/core/roots.ts`)
give labels and each tab's signals.

- **Only you put a root in `open`.** `show` of a root opens it, so every way of
  opening goes through `show`: `planOpen`, the Archive tab's Open and Restore,
  the header. `sync` adds only the root of a new tab whose first message is
  written. A root someone else starts opens no tab.
- **`closeRoot` takes a root out of `open` and keeps its columns**, so opening
  it again brings them back. So `roots` keeps the columns of every root you
  have opened, bounded by the roots you visit. Closing the tab you are on
  shows `afterClosing`'s choice: its right neighbour, else its left, else
  Archive; closing an unsent new tab does the same.
- **`forgetArchived` takes archived roots out of `open`, except the one you are
  on.** `App` dispatches it when the archive or the active tab changes, so an
  archived root you are on leaves when you do. Removing it, not hiding it,
  means a restore opens it again only for whoever restores it.
- **`active` is null only before the first `prune`.** A browser tab with
  nothing stored has not chosen a tab, and the document has not arrived.
  `App` draws "connecting…" meanwhile. `prune`, once after `whenSettled`,
  drops roots the document lacks, applies `forgetArchived`'s rule, and
  replaces a null, gone or archived active tab with your last open tab, else
  Archive. With nothing stored, that is Archive: nothing opens a tab by
  itself. No action sets `active` back to null.
- **A landed new tab moves left of any unsent ones**: its root joins `open` at
  the end, and new tabs are drawn after `open`.
- **An archived active root stays active** until you switch or reload, and
  keeps its place in the bar (`forgetArchived` keeps it). Its columns are drawn with `readOnly`: the
  composer stays mounted, disabled, so what was typed survives; Restore brings
  it back in place.
- **`columnsOf` is the one place a root gets its first column**
  (`first-<root>`, anchored at the root). `columnsReducer` may leave a root
  with none; the layout then deletes the entry.
- **Column keys hold no `:`.** A presence key is
  `${writer}:${seat}:${columnKey}`, and `readPresence` takes the writer from
  before the first colon (ADR-0037). A writer holds none (`normalizeEmail`
  refuses one) and a seat is hex; a colon in a column key would still break
  the rule that a key's parts are its colons.
- **New tabs** are fresh columns at the root (`anchor: null`), local until
  their first send. `sync` moves one whose message is written to
  `roots[rootOf(anchor)]`, keeping its key, and keeps it active.
- **`sync` runs on every root's columns**, not only the active one's: an anchor
  left behind can later follow a newer branch below it (ADR-0027).
- **`planOpen` is the deduplication `App` used to do**, pure: scroll to an
  entry a column of its root already shows, open a column beside the deepest
  sharer (`openBeside`), or preview an archived root in the Archive tab. The
  rail, fork dots, references and the notes index all go through it; `App`
  carries the plan out.
- **Columns of other tabs are unmounted.** Alignment forgets their keys, so a
  tab shown again aligns its columns as if opened.
- **The Archive tab** is `archive.tsx` over `archiveIndex`
  (`archive-rows.ts`, a client-only read like `projection.ts`). Its filter,
  search, selection and preview anchor are component state, never stored. The
  preview is a `Rail` and one `Column` with `readOnly`: Restore for an
  archived root, Open for an open one.

## The column model (`columns.ts`)

A column is `{ key, anchor, lane?, asksAgent?, fresh? }`, and `columnsReducer`
is pure: keys come from the shell in the action, so the reducer has no hidden
counter.

- **A column follows its own tip.** `sync` runs on every change and advances
  each anchor to `followTip(anchor)`. A reply below a column's last message
  moves it on; a branch off an earlier message, however new, never does.
  Following from a fixed anchor instead would jump to any newer branch below
  it. Leaves, because a conversation has no lane at all.
- **Until it is agent work.** When a column's tip is exactly one lane's tip,
  `sync` binds it (`lane`), and from then on its anchor is the lane's tip and
  its sends name the lane. A conversation stepped down at the lane's tip is
  newer, so following leaves would slide the agent's column into it, and send
  the agent's next message there. Binding waits while two lanes share the tip
  (a compelled branch at a lane's tip, until its prompt commits). A bound or
  fresh column is `pinned` in `projectColumns`: its path ends at its anchor.
- **A null anchor** belongs only to a fresh column at the root: a new tab's.
- **A fresh column** (`openFresh`: `→`, or "Branch here" after a conflict; or
  a new tab) has nothing of its own yet. Its first send mints the
  command's id (`sent`), which the host stores with the message (`sendId`), and
  `sync` anchors the column at the entry that send wrote (`TreeIndex.bySend`).
  A branch from agent work carries `prefill` (`branchPrefill`: `@agent `),
  which its composer starts with; `sendable` (`send.ts`) sends nothing while
  the text is only that.
  Exact: no other message at the same point, the lane's own next append
  included, can be mistaken for it. "Branch here" opens one holding the text
  (`pending`), and that column's composer sends it, so a refusal shows where
  the message is, like any other send.
- **`→` at a column's end only in agent work.** Below a conversation's last
  message, a branch would be the same as replying. At an agent thread's end
  it is "open a branch here", as on every message; its `@agent ` deleted, it
  steps back down to a conversation (ADR-0021).
- **`asksAgent`** is a new tab from **＋ agent** (ADR-0021's Start Agent): a
  message with no mention asks the agent, as if `@agent` were written, until
  the thread has a lane of its own.
- **Deduplication is `planOpen`'s** (`layout.ts`, above). Two anchors can
  resolve to one path, which `columnsReducer` cannot see.
- **Open columns are never written to the document.** Which paths a person
  reads is theirs. They are kept in the browser (below).

`projectColumns` shows each column only past the deepest message it shares
with ANY column to its left, so a shared stretch of paths is drawn once, in the
leftmost column that shows it. Anything looking for a message on screen (the
rail's scroll-to, the alignment) must search every column.

## Who is here, and your inbox (ADR-0030)

The header (`header.tsx`) is the rest of the session, from live data; nothing
in it opens a tab until you choose.

- **People:** `peopleHere` (`here.ts`) groups `presenceView`'s `readingAt` by
  person, in `writerOrder`. "Never you" is `presenceView`'s rule, not
  repeated here. Each avatar (`Avatar`, the same circle the tabs and columns
  draw) is a `Menu` of the threads that person is in.
- **You** are the last thing in the header: your profile (`profile.tsx`,
  below, under Who you are).
- **The agent:** `activity` (`readAgentActivity`) is its running lanes; the
  header adds nothing of its own, and finds each run's root with `rootOf`.
- **The inbox** (`inbox.ts`, pure): `mentionsOf` is every chat whose mentions
  `address` resolves to your display name, never your own; `InboxItem` is one
  (core's `Mention` is a mention parsed from text). What you have seen is
  `{ since, seen }`: every mention at or before `since`, and the ids above it
  in `seen`. Marking compacts: `since` moves past a run of seen mentions, so
  `seen` holds only those above an unseen one.
- **`useInbox`** is its shell. With nothing stored, it starts at
  `startInbox(index)` (the newest entry) only after `whenSettled`: from a
  partial index, old mentions would count as new (S29). A mention on the
  paths of the tab you are on is seen (`seenOnScreen`), and the effect writes
  nothing when there is none.
- **"You" is your email** (ADR-0037). Your other tabs and devices are you, so
  they share your mentions; a mention resolves to your display name, so
  renaming yourself still changes which mentions are yours.
- **`Popover`** (`popover.tsx`) is a trigger and the box it opens. It wraps
  both in a span that gains `open` while open, which keeps `.tab-more.open`
  visible; the box is `position: fixed` from the trigger's rect, and Escape,
  a scroll, a resize or a click elsewhere closes it. `role` is `menu` or
  `dialog`: a dialog's box takes the role, and a menu's list does.
- **`Menu`** (`menu.tsx`) is a `Popover` whose box is a `role="menu"` list:
  the header's people, agent, offers and `@`, the tab's `⋯`, the add tab's
  menu and the composer's `▾`. Items can carry `data-*` attributes
  (`MenuItem.data`). A heading is drawn above the list, not in it, since a
  menu holds only menu items; the list is named by it (`aria-labelledby`).
- **`.initial` is the circle; `.avatar` is a person shown here.** The browser
  suite counts people by `.avatar`, and proves you are never among them by
  it. So your profile's trigger (`.me`), the agent's mark (`.agent-mark`)
  and the "+n" of `Avatars` (`.more`) are `.initial` and never `.avatar`.
  The circle's shape is `.initial`'s rule; `.avatar` has none.

## Kept per tab (`tab-state.ts`, ADR-0027)

`tabState` keeps a value under one key in two slots: the tab's
(`sessionStorage`), read first, which survives a reload; and the device's
(`localStorage`), which a new tab starts from. It knows nothing of Pineta; a
value's stored form is its codec's. The layout is its one use, under the key
`pineta-columns:<session>`, which predates root tabs.

`deviceState` keeps a value in the device's slot only, shared by the device's
tabs: the inbox's seen state (`pineta-inbox:<session>`), and who you are
(`pineta-identity`, below), which `reconcileName`'s `store` also saves, with
the same email, so it reloads no tab. Each save reads what is stored and merges into it
(`mergeInbox`; the identity's merge takes the new value), so two tabs marking
at once both keep theirs. `subscribe` hears another tab's save through the
`storage` event, which fires only in the other tabs, and hears a `clear()`
as `undefined`. Both write through `writeSlot`, which drops a full quota's
error.

- **Every change is saved, `sync`'s too.** Saving only what a person does
  would store older anchors, and `followTip` from an older anchor can land on
  a newer branch below it. So with two tabs open, the device slot holds
  whichever changed last: both move their columns as messages arrive.
- **The codec is the edge** (`encodeLayout`, `decodeLayout`), in the house
  shape: a TypeBox schema, then a build step field by field. A layout decodes
  whole or not at all, and `v` rejects an older one: a `v: 2` layout (before
  your tabs were yours, ADR-0030) is dropped once and overwritten by the first
  save, and the page opens on the Archive tab. A lane that is not a lane name
  is left off; `sync` binds the column again.
- **`fresh.pending` is never stored**, by either side: restoring it would send
  its message again. A "Branch here" column comes back empty. `fresh.prefill`
  is stored: it sends nothing by itself. What was typed over it is not kept:
  the composer's text is its own state, so a reload, or switching root tabs
  (which unmounts the column), starts it from the prefill again.
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

## Rail runs (ADR-0031)

The rail draws `compactRail(index, projectRail(...), keep)`: a dot per
landmark, and a capsule per run of three or more uneventful messages.
`projectRail` still returns a row per message, and everything else reads
those rows (tab summaries, archive search, `branchColors`).

- **`compactRail` (core) is the rule; `railKeep` (`rail-view.ts`) is the
  view's part of it:** notes, rings, running tips and every open column's end.
  A column's end is kept because a pinned column can end mid-stretch: inside a
  run, half of it would be on the column's path, and where the column ends
  would not show. So a run is all on an open path or all off it, and
  `data-open` on its first message speaks for it.
- **Every item has `slot`, `span` and `ids`;** a dot is an item with one id and
  a span of 1. An edge leaves its parent item's last slot, so the renderer
  never asks which kind an item is, only how to draw it.
- **A click picks by where it lands** (`pickAt`, pure): a fraction of the way
  down the capsule is that fraction through the run. A click from the keyboard
  has `detail` 0 and no point, and picks the first message. A browser check
  clicks at a point with `mouse.click`; `page.click` clicks the centre, which
  is the run's middle message.
- **Selectors:** `.rail-run[data-entry]` is a run's first message, with
  `data-count`, `data-span` and `data-fill` (`agent`, `people` or `mixed`).
  The browser suite's `railCount`
  counts messages, as dots plus each run's `data-count`; a check counting
  `.rail-dot` alone misses every message inside a run.
- **A new tab's rail is `EmptyRail`:** a `.rail-start`, not a `.rail-dot`, so
  `railCount` never counts it, and a disabled `notes (0)` toggle, which sets
  the rail's width. The first message's rail has the same toggle, so the
  columns keep their place; the browser suite checks `#strip`'s left edge
  across that send. `.rail-tree` is `fit-content` and centred, and the SVG is
  `PAD` wide on both sides of its outer tracks.
- **A capsule's background depends on its fill** (the panel's colour, the
  track's, or the two blended half and half), so a colour check reads a `.rail-dot`. Signals (`.pulse`, `[data-here]`, `.noted`) are always on dots.

## Revealing a picked message (`use-reveal.ts`, S33)

`useReveal(container)` returns `reveal(id)`, which `openAt` calls for a pick
that scrolls and for one that opens a column, and the Archive preview for its
picks.

- **It tries at once.** Picking a message a column on the tab you are on
  already draws changes no layout state: `show` for the same tab returns the
  same state, so no render follows, and an effect waiting for one never runs
  (S33: the rail's scroll-to did nothing). Otherwise the id waits for the render
  the pick causes, in a layout effect with no dependencies.
- **It scrolls only a message that is out of view.** A branch opened from its
  fork point is already level with it, and centring it would undo that.
- **It dispatches `PLACED`.** A column scrolled down, from 0 or from a shorter
  path, has not moved up, so it is still following, and the next resize would
  take it to its end (S33, answer 6). The Archive preview shows it: the pick
  changes its path, and the new content resizes it.
- **It is declared after the alignment effect in `App`,** so a pick the
  alignment left out of view is scrolled to in the same commit.

## Colour carries the link, not geometry

Each column takes the rail track of its last message (`branchColors`); its
header, its fork dot in the parent column and its rail track share that
colour. There are no connector lines, so sibling branches never cross.

- **Hover linking is CSS.** Headers and fork dots carry `data-color`, the track
  modulo the palette; `:has()` rules in `index.html` outline one when the other
  is hovered. No component state.
- **The palette is eight colours**, so tracks eight apart share one. Two open
  columns can share a colour when their branches share a track slot; the rail
  shows them the same way.

## Layout: columns scroll independently

Each column scrolls on its own, its composer at its foot. `alignOnOpen` in
`app.tsx` places a column when it first appears: it scrolls the column (or
grows a spacer above its first message) so that message is level with its fork
point in the column showing it. A shared vertical scroll was tried in design
and dropped: forks far apart could not be seen together
(`docs/06-interface.md`).

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
- **A press on a control, `.where` or `.offer` starts no drag**
  (`NOT_A_HANDLE`): those two stay selectable, to copy. The rest of the header
  is `user-select: none`. A press is a drag only once it has moved 5 px, so
  clicks still reach the header.
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
  a note card, an image, the composer growing: each is a change of size.
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
  released with content grown since.
- **`alignOnOpen` settles it:** it dispatches `PLACED` on the body, and the
  column follows only if it was placed at its end. Without it, a column
  aligned short of its end would jump there on its first ResizeObserver
  callback. `useReveal` dispatches it too (below).

## Threads, lanes and the composer (ADR-0020)

- **The agent can reply in several threads at once**: `readAgentActivity`
  returns every running lane. The rail pulses at each tip, and each column
  streams the runs whose tip is on its path.
- **The composer decides before sending, as the host will.** `threadOf` finds
  the thread (the column's bound lane, or its end) and `address` who the
  message is for, over `readLanes` and `readParticipants`: the same reads and
  functions the host decides from. The button says the result: "send", "send ·
  to Ada", "send · agent will reply", or "queue · agent replies after Bea"
  (`queue` when the lane runs or has messages waiting). A fresh column sends
  `branch`.
- **Conflict.** A compelled `reply` another writer raced comes back `conflict`,
  and the composer keeps the text and offers **Queue after** or **Branch here**.
  On one host the page sees another writer's run start almost at once and
  chooses `queue` itself, so a true conflict needs two sends to cross in flight.
  Its outcome is checked in e2e; the prompt's rendering is not exercised in the
  browser suite, because no honest browser action can force the crossing.
- **Waiting messages** from `pineta.outbox` show dimmed in their column, in the
  order they will be taken. They are not in the tree yet.

## Commands in the composer (ADR-0036)

- **Completion** (`commands.ts`, `matchCommands`): while the text is a `/`
  and a first word, the commands whose name has every typed part in some
  part of it are offered. Those whose own name starts with what was typed
  come first. The list is `pineta.commands`, read with `readCommands`.
- **Keys:** arrows move, Tab or Enter chooses (inserting the full name and a
  space), Escape hides the list for that text. Enter sends only when the
  list is closed.
- **A command is for the agent:** the send button says so, as the host
  decides.
- **A sent command** shows its name as a label beside its speaker (`node.command`).

## Tools and live work (ADR-0022)

- **A tool call is a row under the agent's message** (`ToolRow` in
  `message.tsx`): its label (`toolLabel`), ✓, ✗ or …, and its result folded in
  a `<details>`, capped for display. A result is its own entry in the tree;
  `projectSpine` pairs it with its call on the same path, so it adds no column
  row and no rail row. A message that only called tools shows only its rows.
- **Live work is one component** (`Streams` in `column.tsx`), reading
  `readStreams` for the lanes running on the column's path: the reply as it is
  written, and each running tool's output, following its end as a column
  does. A reply's
  stream closes when its message ends, which a fast model can do between two
  renders, so a check that must see one uses a slow scripted model.
- **Stop** shows in the composer while the thread's lane runs, and sends
  `stop`.
- **Where a new thread's agent works** (ADR-0032). When a send would create a
  lane (it asks the agent where no lane is, or it is a branch), the button
  says where: "send · agent will reply · in its own copy". Its `▾` menu offers
  its own copy, your working copy, directories other lanes used, and
  "directly in…". The choice is the composer's state until sent, as
  `asksAgent` is; its default is `workFor`, the host's own decision.
- **A lane's column header** says where it works ("own copy · <commit>", or
  "in <dir> · shared"), and, for its own copy, its offer (ADR-0038).
- **The offer line** is `offerView`'s (`@pineta/marginalia`), drawn by
  `OfferLine`: a line naming the offer's bookmark, so you can find it in jj
  or jjui, its buttons, and a `⋯` menu for the rest ("update from my work",
  "rewrite description"). What the lane runs now (`activityOf`: a turn, a
  resolution, or a split, from its latest prompt's role) comes first: while
  it runs, the line says so and offers nothing.
- **An update's prefill** goes into that column's composer, unsent: `update`
  answers `updated` with the text, and the column hands it to the composer
  as `prefill` with a fresh key, which lands once after whatever is typed.
- **Land, update and stack messages** show as one line each, roles `land`
  ("resolving your work"), `update` ("your work") and `stack`.
- **The page header counts offers open** in your repo, as it counts
  mentions; each row opens its thread.
- **Selectors in the browser suite:** a column's offer is
  `.column-head .offer`, with `data-state` (`ready`, `conflicts`, `stack`,
  and the rest of `offerView`'s states); its line is `.offer-line`, and each
  button `.offer-<action>`, Take being `.offer-take`.
- **The invite key** needs no client code: the host's redirect sets a cookie
  that same-origin requests and upgrades carry. `connectSession({ key })` is
  for Node clients.

## Message text is markdown (S27)

`messageTree` (`markdown.ts`) turns a message's text into the tree
`MessageText` draws: remark-parse, remark-gfm and remark-rehype, as
react-markdown runs them, then Pineta's own pass over the tree. Owning the
pipeline keeps the tree a pure function, testable without a DOM.

- **Nothing in it is HTML.** Raw HTML becomes text. A link or image URL keeps
  only http, https, mailto, relative and `#` targets (`safeUrl`, react-markdown's
  `defaultUrlTransform`; micromark's `sanitizeUri` HTML-encodes `&`, which a
  React prop would carry literally).
- **Committed text is wrapped in runs:** each text node becomes
  `span[data-s][data-e]`, the source range it came from (`data-code` in code).
  `align` maps a run's characters to the tokens that produced them (a literal,
  a backslash escape, a character reference), skipping what produces nothing
  (indentation, `>` markers). In code, only literals: backslashes and `&` are
  text there. Code text has no position of its own; it takes its element's,
  past the fence line or the opening backticks.
- **Citing is gather, plan, execute.** `selectionBoundaries` (DOM) reports
  each end of the selection as inside a run, between two runs, or outside the
  text; a point at a run's edge is between it and its neighbour. `citeTarget`
  (pure) snaps a start forward and an end back, and cites the whole entry when
  no source is covered. The cite button reads `:scope > .text`: a note's card
  has text of its own.
- **Streaming text goes through remend**, which closes an unfinished `**`,
  fence or link, with `singleTilde` and `comparisonOperators` off: those
  escape mid-text, and the message would change when it commits. Streaming text
  gets no runs: it is not citable, and its positions point into remend's output.
- **One `white-space: pre-line` on `.text`** shows soft breaks as people type
  them. `dropBlockWhitespace` removes the newlines to-hast puts between blocks
  and after a `<br>`, which would otherwise show as blank lines. Chrome then
  ends a paragraph at a shown newline, so a triple-click there selects a line.
- **Known gaps:** a footnote's backlink adds a space to the text before it,
  and inline code spanning a line break has its newline turned into a space.
  Neither run aligns, so a selection there cites the whole entry.

## Presence (ADR-0024)

- **Every column of the tab you are on is reported** (ADR-0029), since there
  is no focused column: `App` writes each column's thread end when it changes,
  deletes the key of a column no longer reported, and refreshes all of them
  every 10 s while `document.visibilityState` is `visible` (a
  `visibilitychange` listener refreshes on return). Switching tabs therefore
  clears the last tab's keys, through that same deletion. The Archive tab
  reports nothing. Typing is written at most once a second.
- **A tab's avatars** are `readersByRoot(people)` (`here.ts`): the header's
  people turned around, so each thread end is resolved to its root once.
- **`presenceView` (core) decides everything shown**, from `readPresence`
  (`@pineta/reads`) and the tree: rings (`readingAt`), a header's avatars
  (`seenBy`, others whose thread end lies on one path with this column's),
  typing (`typingAt`) and a note's editors (`editingAt`). It always leaves you
  out, and shows a person once however many seats report them (ADR-0037).
- **A person's colour** (`presenceColors`): the first three people, in the
  order they first wrote (`writerOrder`, the same in every window), get
  magenta, white and yellow, far from each other and from the tracks; anyone
  later, a hue from their writer id at a saturation the tracks don't use. A
  ring on the rail has a dark gap between it and the dot, so it reads against
  any track.
  Names go through `displayName`, the fallback to an email's part before the
  `@` included.
- **`Initial` is the circle** (`presence.tsx`): a writer's initial in their
  colour, class `initial`. `Avatar` is an `Initial` with class `avatar`,
  which means a person shown here (Gotchas).

## Notes (ADR-0025)

- **A note's card (`note.tsx`) binds its textarea with `useText`** to the note's
  Yjs text, which `session.noteText(id)` gets from the one Exchange. The
  textarea is uncontrolled: `useText` applies remote edits in place and keeps
  the cursor, so the card never re-renders per keystroke; `useValue` reads the
  text where it is shown (a done note, the index's first lines).
- **A message with a note draws its card in place of its text**, the sent
  draft's included; a message without one offers *edit* among its tools. A
  done note's text is markdown, through `MessageText`.
- **A thread's draft** sits above its column's composer (`draftFor` over the
  column's end). Its opener and its writers see the card; anyone else sees
  "Ada is drafting the next message · join". *Compose together* sends the
  column's `at` and bound lane, as a reply would.
- **Presence `editing`** is set on focus and while typing (at most once a
  second), and set to null on blur, and when the editor goes with no blur (the
  draft sent, the note done). A done note shows no editors.
- **The sticky bar** follows the note this window last focused, through an
  `IntersectionObserver` on the column's body.
- **The notes index** is `notesIndex` (`@pineta/reads`) over the records of
  the tab's root, drawn from the rail's top; each row reads its note's first
  line on its own.
- **Selectors in the browser suite:** a card replaces `.msg > .text`, so a
  message with a note is found by `.note-text` or by `data-entry`.
- **`:text-is` matches the smallest element holding the text**, which in
  markdown is a run's `span`, not `.text`. The suite finds a plain message by
  `.text > p:only-child > span:only-child:text-is(…)`.

## Who you are (ADR-0037)

A person is their email: the principal every Exchange of theirs names, and so
their writer, `w-<email>`. Kyneta issues each tab its own peer id, a seat, so
the email is the only thing Pineta chooses.

- **Asked once per browser, before anything connects.** `app.tsx` reads
  `pineta-identity` (a `deviceState`, `identity.ts`), or draws the form
  (`identity-form.tsx`: **email:** and **name:**) and waits for it. The form's
  rule is `parseIdentity`, over the host's own `normalizeEmail` and
  `normalizeName`, so it accepts exactly what the host would; the browser's
  own validation is off (`noValidate`).
- **The stored name follows the session's.** `reconcileName` (`identity.ts`,
  pure) is one decision with two steps: `send` the stored name to a session
  that has none for you, or `store` the session's name when it differs from
  the stored one, whichever device set it. So a session that has no name for
  you learns the one you go by now, not the one typed on a first visit. One
  effect in `App` runs it, keyed on `settled` and your session name: before
  the document settles, a missing name means not yet arrived, as for
  `prune`. It does nothing when nothing is stored for your email, which is a
  tab about to reload. Under `StrictMode` a `send` can run twice on a first
  join; the same name written twice is the same value.
- **Your profile** (`profile.tsx`) is your avatar at the header's right, a
  `Popover` with `role="dialog"`, not a `Menu`: a `role="menu"` holds only
  menu items, and this holds a text field. Its submit is `planRename`
  (pure): refuse, unchanged, or send. A rename is sent on Enter or save, and
  Escape or a click elsewhere discards it; saving on blur would race the
  popover unmounting the field. The trigger's `title` is your name as shown
  (`nameFor`), the one mentions resolve against.
- **One name field** (`name-input.tsx`) serves the identification screen and
  the profile: the rule is `normalizeName`, and the hint is `nameHint`, the
  handle the typed name gives. The client's words for the rule are its own;
  the protocol's refusal (`INVALID_NAME`) words it differently, and the
  profile shows it, under its code, only for a rule the client does not know.
- **Not you? Sign in as someone else**, in the profile, clears the stored
  identity and reloads. Every tab subscribes to it, and reloads when another
  clears it or stores another email, so no tab goes on as the old person.
- **Presence is per seat** (`seatKey(writer, exchange.peerId)`, as `mine` in
  `session-view.ts`), so your tabs never overwrite or clear each other's;
  `presenceView` shows each person once, and never you.
- **The host is found by principal** (`HOST_PRINCIPAL`, `whenPeer`), since
  its seat is Kyneta's to issue: a Line is addressed by seat.

## Names

A message keeps the name its writer had when they sent it: that is what the
agent read, and rewriting it would change history the agent has seen, and the
provider's prompt cache. The screen shows the writer's current name, with the
name the message was sent under in parentheses when they differ
(`speakerLabel`, `names.ts`): "Duane (duane)". Someone who set no name is
shown by their email's part before the `@`. Each rendered chat carries its
`writer` for the lookup.

## Gotchas

- **A root tab's `⋯` is always rendered, hidden with `visibility`** except on
  the tab you are on, while hovered or focused, or while its menu is open
  (`Menu`'s wrapper, `.tab-more`, gains `open`). The menu is its child, so
  hiding the `⋯` would hide an open menu too.
- **"close" is `closable`:** hidden on a root tab's only column (`columnsOf`
  would give it back) and in the Archive tab's preview.
- **A popover opens above its trigger in the window's lower half.** A
  composer's `▾` is at the window's foot, so a list below it would be out of
  sight; and since `.popover` sets a `top` in the stylesheet, the upward box
  sets `top: auto` too, or `top` wins over `bottom`.
- **Anything that pops out of the tab bar is `position: fixed`.** `.tab-list`
  scrolls sideways, and `overflow-x: auto` makes its vertical overflow `auto`
  too, so a menu positioned inside it is clipped below the bar. `Popover`
  places its box from its trigger's rect when opened, and closes on any
  scroll outside the box or a resize, since a fixed box would drift from its
  trigger.
- **Playwright clicks what a person cannot see.** It scrolls a clipped element
  into view before clicking, so a check that a popup can be clicked does not
  show it is visible. Check what `elementFromPoint` finds at its centre: the
  browser suite's `chooseFromMenu` does, for every menu.

- **Selectors for root tabs:** a root's tab is `#tabs .tab[data-root="…"]`,
  the one you are on has `aria-selected="true"`, its × is the `.tab-close`
  after it, Archive is `.tab-archive`, new tabs are `.tab-new`, and the add
  tab's buttons are `.add-agent`, `.add-menu` and `.add-conversation`. In the
  header: `#top .here-person .here-trigger` per person, `.here-agent`, and
  `.inbox-trigger` with `.inbox-count[data-unseen]`; menu rows are
  `.here-thread` and `.inbox-row`, each with `data-entry`. You are
  `#top .me-trigger` (its `title` your name), opening `#profile`, with
  `input[name="name"]`, `.name-handle`, `.name-problem[data-problem]`,
  `.profile-email` and `.not-you`. The identification screen's email problem
  is `.identity-problem`.
- **A page with nothing stored opens on the Archive tab**, so a browser check
  that opens a second page opens its thread from there, or from a person in
  the header. The rail is `.rail`, not `#rail`: the
  Archive tab's preview draws a second one.
- **`.column-content` must stay unpositioned.** A positioned wrapper becomes
  the messages' offsetParent, and `alignOnOpen` measures `offsetTop` against
  the body's.
- **A ResizeObserver sees an inline element as 0 × 0.** `LiveOutput`'s
  `<code>` is `display: block` for it.
- **Every scroll `useFollow` makes is instant.** A smooth one passes through
  positions short of the end, and the rule reads each as the reader leaving.

- **Message tools are hidden until hover or focus**, the margin `→` too. A
  browser test must hover a message before clicking its `.tools` buttons or
  its `.branch`.
- **Stop aborts a running command only once the command has started.** With a
  slow model, the tool call itself streams first; a check waits for the live
  tool row before clicking Stop, as a person would.
- **`:last-of-type` matches element type, not class.** The "agent
  joined" marker and the stream are `div`s too; find a column's last message by querying `.msg`.
- **The agent's stream renders only in a column containing its tip.** When no
  open column does, the rail's pulse and, in another root, the tab's pulse are
  the only signs, and clicking the rail's pulse opens
  that thread.
