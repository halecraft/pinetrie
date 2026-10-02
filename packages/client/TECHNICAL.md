# `@pineta/client` — technical notes

The browser interface: a tab per root, each a rail beside a strip of columns
(`docs/06-interface.md`, ADR-0029). Everything drawn is a read of the session
document through `@pineta/reads` and `projection.ts`; the only state kept here
is the layout (which tab you are on, and each root's columns), kept per
browser tab. What is typed is a card (ADR-0048): a document of its own,
written by this client, and kept on its thread.

## Reads go through one index

`readTreeIndex(doc)` (`@pineta/reads`) builds `indexTree` once per change of
the document's entries, and returns the same index until one changes. The
columns, the rail and the agent's path all read that one index
(`packages/core/tree.ts`). `App` reads it through `readSessionFacts`
(`projection.ts`), together with the entry count, the agent's activity, the
streams to draw (`liveWork`, over the stream records alone), the lanes, the
outbox, the participants, the archive and the work facts, so they
are always from the same moment. `resolveLayout` takes the index, the lanes
and the archive together.

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
  | `reading` | `SeenBy` (a column's header), `LiveRail` (rings, and which rail items stay), `People` (`header.tsx`), `Readers` (`tabs.tsx`) |

  Each read keeps its array while the field's entries are the same, so the
  refresh's render reuses the memos below it. `App` still writes your
  presence (the reported columns, the refresh, `typing`); writing reads
  nothing.

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
  its target and line by value, since `columnView` builds them anew, and its
  `onClose` is `useStable`'s. A file section (up to 5,000 lines) compares its
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
  props' diff (`componentRenders` in `apps/pineta/e2e/browser.ts`). A
  production build records none, and every count would pass, so the suite
  stops at its start unless the page has recorded some. A render whose props
  are the same (a state change, a `useSelector` write) is not recorded. An
  entry is named by the function that rendered: a message's is
  `MessageView`, the function `memo` wraps, and a list's
  `MessageListView`, so a check counting `Message` counts nothing.

## Views decide, intents act

The page works as the host's shell does: gather, plan purely, then carry
the plan out (`apps/pineta/host/TECHNICAL.md`). A rule kept in a component
can only be proven in a browser, minutes per check; a rule in a pure
function is proven by a unit test in a second.

- **A component draws a view.** It branches only on a view's `kind` or its
  flags, and draws the view's strings. It compares no document fact, builds
  no label, and chooses nothing that is offered. The views are `appView`
  (`app-view.ts`), `tabsView`, `columnView`, `messageTools`, `railItems`,
  `toolBody` and `callStatus`, `editorState` and `startText`. What stays in
  components and `use-*.ts` is what needs a browser: measuring, focus and
  the caret, scrolling, observers, subscriptions.
- **A click is an `Intent`** (`intent.ts`). A column's acts are nested
  under its position (`{ kind: "column", position, act }`), as
  `LayoutAction` nests `ColumnAction` under a root, and a message's
  `MessageAct`s are among them. `Column` takes one `onIntent`, which `App`
  makes once with `useStable`, so it never redraws a list.
- **`planIntent` turns an intent into `Effect`s**, from the layout, the
  index and the archive of the render it was made in. It owns what a click
  does: which root a column act belongs to, that × closes a tab and writes
  nothing, that a column you open takes focus (`armFocus`). Fresh column
  keys come from the shell as an argument, as `columnsReducer` takes them.
  `afterRestore` plans a restore's answer, and `nameEffects` the settle's
  name step (`reconcileName`).
- **`perform` carries the effects out** (`perform.ts`), one port call each,
  through `AppPorts`: the reducer's `dispatch`, the session's writes,
  `reveal`, the Archive tab's pick, focus, the identity store and
  `reload`.
- **`appView` decides; it does not project.** The projections
  (`projectColumns`, `pathIds`, `branchColors`, `cardMarks`) stay in `App`'s
  own `useMemo`s, and their results come in. One tree rebuilt each render
  would give every memoised child new props (S54, S59). `appView` gives the
  workspace (`connecting`, `archive`, a root's or a new tab's columns as
  `ColumnSlot`s), the read-only words, and the header's open offers. A slot
  is new each render; `Column` is not memoised, so this costs nothing, and
  a slot must never reach a memoised component by identity.
- **`main.tsx` boots the page:** it builds the device's stores, asks who you
  are, connects, and mounts `App({ session, stores })`. `app.tsx` touches no
  browser global as it loads.

## Root tabs and the layout (`layout.ts`, ADR-0029, ADR-0030)

The layout is `{ active, open, roots, newTabs }`, and `layoutReducer` is pure.
A root tab's key is its root entry's id: a thread started at the root is
rooted at its first message (S30). `open` is your tabs: the roots you opened,
in that order. `tabBar(layout)` is Archive, `open`, then new tabs.
`summarizeRoots` and `rootWork` (`packages/core/roots.ts`)
give the roots and each tab's signals.

- **A root's label is `rootLabels`'s** (`root-label.ts`, ADR-0045): its
  mark's title, else its first line (`firstLines`). `App` builds both maps
  once per change, and every place that names a root looks one up: the tabs,
  the header, the inbox, and the Archive tab, whose search reads labels, so
  it finds a title without knowing about marks. The first lines are also
  the rename field's placeholder: what clearing a title brings back.
- **Renaming is `TabBar`'s state, never the layout's.** `planTitle` is the
  field's submit, over `parseTitle`, the rule the codec decides by too, and
  `renameKey` what Enter and Escape do.
- **What the bar shows and offers is `tabsView`'s** (`tabs-view.ts`), over
  `tabBar`'s order: each tab's label, pip, ⋯ items and the intents it
  sends. `TabBar` draws it; the `Readers` on each tab read presence
  themselves (S59).

- **Only you put a root in `open`.** `show` of a root opens it, so every way of
  opening goes through `show`: `planOpen`, the Archive tab's Open and Restore,
  the header. `sync` adds only the root of a new tab whose first message is
  written. A root someone else starts opens no tab.
- **`closeRoot` takes a root out of `open` and keeps its columns**, so opening
  it again brings them back. So `roots` keeps the columns of every root you
  have opened, bounded by the roots you visit. Closing the tab you are on
  shows `afterClosing`'s choice: its right neighbour, else its left, else
  Archive; closing an unsent new tab does the same.
- **`resolveLayout` takes archived roots out of `open`, except the one you are
  on.** It runs every render, so an archived root you are on leaves when you
  do. Removing it, not hiding it,
  means a restore opens it again only for whoever restores it.
- **`active` is null only before the first `prune`.** A browser tab with
  nothing stored has not chosen a tab, and the document has not arrived.
  `App` draws "connecting…" meanwhile. `prune`, once after `whenSettled`,
  drops roots the document lacks, takes archived roots out of `open`, and
  replaces a null, gone or archived active tab with your last open tab, else
  Archive. With nothing stored, that is Archive: nothing opens a tab by
  itself. No action sets `active` back to null.
- **A landed new tab moves left of any unsent ones**: its root joins `open` at
  the end, and new tabs are drawn after `open`.
- **An archived active root stays active** until you switch or reload, and
  keeps its place in the bar (`resolveLayout` keeps it). Its columns are drawn with `readOnly`: the
  composer stays mounted, disabled, so what was typed survives; Restore brings
  it back in place.
- **`tabOfColumn` is the one lookup from a column's key to its tab**: a new
  tab's, or a root's whether or not that root is open. The card marks place a
  fresh card with it.
- **`columnsOf` is the one place a root gets its first column**
  (`first-<root>`, anchored at the root). `columnsReducer` may leave a root
  with none; the layout then deletes the entry.
- **Column keys hold no `:`.** A presence key is
  `${writer}:${seat}:${columnKey}`, and `readReading` takes the writer from
  before the first colon (ADR-0037). A writer holds none (`normalizeEmail`
  refuses one) and a seat is hex; a colon in a column key would still break
  the rule that a key's parts are its colons.
- **New tabs** are fresh columns at the root (`anchor: null`), local until
  their first send. `sync` moves one whose message is written to
  `roots[rootOf(anchor)]`, keeping its key, and keeps it active.
- **`sync` runs on every root's columns**, not only the active one's: an anchor
  left behind can later follow a newer branch below it (ADR-0027).
- **The layout drawn is `resolveLayout(stored, facts)`, computed in render**
  (ADR-0044): `sync`, then the archived roots leave `open`. An effect stores
  it with `resolve`, the same function, so an action reduces from it: React
  runs pending effects before it handles the next event. `App` draws
  `layout`, never `stored`.
- **No effect dispatches from document facts,** except `prune`, once at
  settle. An effect runs a render after the facts it reads. When the layout
  was synced that way, a slow render painted new entries under the old
  anchor: a `⑂ 0 messages` chip and a row stuck at `…` (S35).
- **`planOpen` is the deduplication `App` used to do**, pure: scroll to an
  entry a column of its root already shows, open a column beside the deepest
  sharer (`openBeside`), or preview an archived root in the Archive tab. The
  rail and fork dots go through it, as an `openAt`
  intent: `planIntent` turns its plan into effects, and `perform` carries
  them out.
- **Columns of other tabs are unmounted.** Alignment forgets their keys, so a
  tab shown again aligns its columns as if opened, left to right, the first
  at its end (Layout, below). Each keeps what it knew of its end
  (`SeenEnd`, Following a column's end), and each tool row what it decided
  (`RowMemory`, Tools and live work).
- **The Archive tab** is `archive.tsx` over `archiveIndex`
  (`archive-rows.ts`, a client-only read like `projection.ts`). Its filter,
  search, selection and preview anchor are component state, never stored. The
  preview is a `Rail` and one `Column` with `readOnly`: Restore for an
  archived root, Open for an open one.

## The column model (`columns.ts`)

A column is `{ key, anchor, lane?, reserved?, asksAgent?, fresh? }`, and `columnsReducer`
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
  (a compelled branch at a lane's tip, until its prompt commits).
- **A column that reserved its lane binds to it by id** (ADR-0057), as a
  fresh column finds its message by `sendId`: as soon as that lane has a tip,
  before the other rules, whatever else ends there. A lane created at the
  root has no tip until its prompt, so a new tab waits for it. `reserved` is
  kept as the column follows a conversation, and dropped as it binds. A copy
  of the column in another browser tab binds too, and a copied new tab moves
  into the new root, as the sender's does.
- **`reserve` returns the same list when no column takes it.** A root with
  no stored columns would otherwise store its `first-<root>` column, and a
  new tab moving into that root would land beside it, as a second column. A bound or
  fresh column is `pinned` in `projectColumns`: its path ends at its anchor.
- **A null anchor** belongs only to a fresh column at the root: a new tab's.
- **A fresh column** (`openFresh`: `→`, or "branch here" after a conflict; or
  a new tab) has nothing of its own yet. Its first send mints the
  command's id (`sent`), which the host stores with the message (`sendId`), and
  `sync` anchors the column at the entry that send wrote (`TreeIndex.bySend`).
  A fresh column can carry a `Prefill`, which its composer starts with. A
  blank one means nothing sent alone: a branch from agent work's `@agent `
  (`branchPrefill`), which `sendable` (`send.ts`) will not send by itself.
  Anything else is content: an edit's text, which sent unchanged is a retry.
  A new tab can carry one too (an edit of a root's first message). Both are
  stored with the layout (v4), since only `pending` is sent on opening.
- **A column you open takes focus, once.** `→`, "Branch here" and ＋ open
  their column with a fresh key that `planIntent` arms (`armFocus`), and its
  composer focuses its box when it mounts (`takeFocus`, which `claimFocus`
  decides: the armed key focuses once, and nothing else does); `onFocus`
  puts the caret after the prefill. The key lives in a ref, never in the
  layout: a column restored on reload,
  or mounted again when its tab is shown, leaves focus where it is. The focus
  runs in an effect, after the strip's alignment, and scrolls a column opened
  past the strip's edge into view.
  Exact: no other message at the same point, the lane's own next append
  included, can be mistaken for it. "branch here" opens one holding the text
  (`pending`), and that column's composer sends it, so a refusal shows where
  the message is, like any other send.
- **`→` at a column's end only in agent work.** Below a conversation's last
  message, a branch would be the same as replying. At an agent thread's end
  it is "open a branch here", as on every message; its `@agent ` deleted, it
  steps back down to a conversation (ADR-0021).
- **`asksAgent`** is a new tab from **＋ agent** (ADR-0021's Start Agent): a
  message with no mention asks the agent, as if `@agent` were written, until
  the thread has a lane of its own. Only the composer reads it; the header
  shows what the composer will do (`onCreatesLane`, below).
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

- **People:** `peopleHere` (`here.ts`) groups `readingAt` by
  person, in `writerOrder`. "Never you" is `readingAt`'s rule, not
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
  visible; the box is `position: fixed` from the trigger's rect. Escape, a
  scroll of an element holding the trigger, a resize or a click elsewhere
  closes it. Escape is one document listener while open, taken with focus in
  the trigger or the box, or on nothing: live data can remove the item that
  held focus. `role` is `menu` or `dialog`: a dialog's box takes the role,
  and a menu's list does.
- **A clicked blob image is shown over the page** (`BlobImage` in
  `blob-image.tsx`, for markdown and tool rows alike). It is a modal
  `<dialog>`, which the browser draws in the top layer, so no column clips
  it; Escape closes it and gives focus back (S66). A click does not close a
  modal dialog, so any click in it, on the backdrop or the image, does. It is
  portalled to `body`: a pasted image sits in a `<p>`, which cannot hold a
  `<dialog>`. React events still bubble through the React tree, so the
  viewer's clicks and pointerdowns reach the image's ancestors, among them
  `#strip`'s `onPointerDown`, which ignores anything off a column's head. A
  handler added above an image sees them too. A Cmd- or Ctrl-click opens
  the image in a new tab instead (`imageClick`, `image-click.ts`).
- **A trigger from live data is `gone`, not unmounted.** Unmounting a
  `Popover` takes its open box with it, so a change in the session would
  close a menu you opened. The header keeps its agent and offers menus
  mounted with `gone` when there is nothing to list (no trigger drawn unless
  open), and keeps a person who leaves while their menu is open
  (`withOpenMenus`, told by `onToggle`) until you close it.
- **`Menu`** (`menu.tsx`) is a `Popover` whose box is a `role="menu"` list:
  the header's people, agent, offers and `@`, the tab's `⋯`, the add tab's
  menu and the composer's where chip. Items can carry `data-*` attributes
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

The stores are built in `main.tsx`, the one module that touches
`sessionStorage`, `localStorage` and `window` as it loads, and `App` is
given them (`AppStores`).

`deviceState` keeps a value in the device's slot only, shared by the device's
tabs: the inbox's seen state (`pineta-inbox:<session>`), where each thread
was left (`pineta-left:<session>`, ADR-0056), and who you are
(`pineta-identity`, below), which `reconcileName`'s `store` also saves, with
the same email, so it reloads no tab. Each save reads what is stored and merges into it
(`mergeInbox`; the identity's merge takes the new value), so two tabs marking
at once both keep theirs. `subscribe` hears another tab's save through the
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
  save, and the page opens on the Archive tab. A lane that is not a lane name
  is left off; `sync` binds the column again.
- **`reserved` is stored** (ADR-0057), and decoded only in the shape the host
  accepts (`parseNewLane`), so a reload keeps the thread's name. The device
  slot copies it into a new browser tab, where the column binds to the lane
  once either copy sends.
- **`fresh.pending` is never stored**, by either side: restoring it would send
  its message again. A "branch here" column comes back empty. `fresh.prefill`
  is stored, blank or content: only `pending` is sent on opening. What was
  typed over it is a card, kept by the column's key (Drafting cards, below).
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

## Rail stretches (ADR-0031, ADR-0056)

The rail draws `compactRail(index, projectRail(...), keep, { asks, revisions })`:
a dot per landmark, and a capsule per stretch of three or more uneventful
messages. `projectRail` still returns a row per message, and everything
else reads those rows (tab summaries, archive search, `branchColors`).

- **`railLandmarks` (core) is the rule, and the columns read it too:**
  `railKeep` (`rail-view.ts`) is the view's part, rings, running tips,
  every open column's end, and every thread end holding a card of yours,
  whose dot carries its mark. A column's end is kept because a pinned column
  can end mid-stretch: inside one, half of it would be on the column's path,
  and where the column ends would not show. So a stretch is all on an open
  path or all off it, and `data-open` on its first message speaks for it.
  The columns fold around `columnLandmarks`, the same set but for the
  rings: a ring is a thread end, which on a column's path is its own end,
  and leaving presence out keeps a presence write from redrawing every
  column (S59).
- **A long ask is a dot and a capsule of its own** (ADR-0056): the prompt of
  an ask whose run holds `MIN_STRETCH` agent messages is a landmark, and a
  stretch never crosses its work's edge. Short exchanges merge as before.
  The stretch carries its ask (`RailStretch.ask`), and its tooltip is
  `stretchWords`: `askWords`, `workWords`, then the ask's digest.
- **Every item has `slot`, `span` and `ids`;** a dot is an item with one id and
  a span of 1. An edge leaves its parent item's last slot, so the renderer
  never asks which kind an item is, only how to draw it.
- **A click picks by where it lands** (`pickAt`, pure): a fraction of the way
  down the capsule is that fraction through the stretch. A click from the
  keyboard has `detail` 0 and no point, and picks the first message. A
  browser check clicks at a point with `mouse.click`; `page.click` clicks
  the centre, which is the stretch's middle message. A pick into an ask's
  work opens its fold first (`openFold`, below).
- **Selectors:** `.rail-stretch[data-entry]` is a stretch's first message,
  with `data-count`, `data-span`, `data-fill` (`agent`, `people` or
  `mixed`) and, for a long ask's work, `data-ask`. The browser suite's
  `railCount` counts messages, as dots plus each stretch's `data-count`; a
  check counting `.rail-dot` alone misses every message inside one.
- **A new tab's rail is `EmptyRail`:** a `.rail-start`, not a `.rail-dot`, so
  `railCount` never counts it. The rail's `min-width` is wider than one
  track, in both, so the columns keep their place; the browser suite checks `#strip`'s left edge
  across that send. `.rail-tree` is `fit-content` and centred, and the SVG is
  `PAD` wide on both sides of its outer tracks.
- **A capsule's background depends on its fill** (the panel's colour, the
  track's, or the two blended half and half), so a colour check reads a `.rail-dot`. Signals (`.pulse`, `[data-here]`, a `.card-pip`) are always on dots.

## Asks, densities and folds (ADR-0056)

An ask is a message that started a run, with that run (`indexAsks`, core,
kept per index). `readSessionFacts` reads it with the index, so the rail and
the columns read one. `segmentPath` (core) decides what a column folds;
`columnRows` (`ask-view.ts`) groups each ask's segments, and `AskWork`
(`ask-work.tsx`) draws one ask's work.

- **`AskWork` is `ToolRow`'s twin.** `foldOpen` (`ask-fold.ts`) is the
  rule, as `rowSize` is; the reader's choice is kept in a `FoldMemory` by
  the ask's prompt, made once in `App`, as tool rows' are. Each `AskWork`
  reads its own key with `useSyncExternalStore`, so opening one redraws it
  alone and `MessageList` gets no new prop. Its messages are drawn only
  while open: a closed fold creates none of their elements (S59).
- **Nothing is written when a run ends.** `foldOpen` reads
  `endedWhileAway`: the run's last entry is past `releasedTip`, the
  column's tip when its reader left its end (`follow.ts`). Following, there
  is none, so an ended ask folds, above the view; scrolled away, it stays
  open under the reader. An effect writing a "settled" flag when a run ends
  would be an effect dispatching from document facts (S35).
- **Density is the column's** (`Column.density`, absent is story), set by a
  `density` column act and stored with the layout as an optional field,
  with no new `v`: a layout stored before it decodes. A change dispatches
  `PLACED`, so a column at its end stays there and no floor holds the
  change.
- **What `askView` decides:** the digest line (`workWords` over
  `askStats`), the outcome's words, the live line while it runs, the last
  word (hidden in outline), the summary, and the span its files open in a
  review (`askSpan`). `askWords` says an ask the same everywhere: the bar,
  the working mark's title, the rail's tooltip, outline.
- **`openFold`:** `planIntent`'s `openAt` puts it before the reveal when
  the entry is in an ask's work. `perform` sets the fold's memory and
  renders `App` once, so `useReveal`'s wait finds the message drawn.
  Forks, branch starts and people's messages are never in a fold.
- **The ask bar is laid over the content**, in a sticky zero-height slot
  before `.column-content`, as `.jump-slot` is: the follow rule reads the
  content's own height and `alignOnOpen` its offsets, and a sticky header
  among the messages would move both. `useAskBar` measures each
  `.ask-work[data-ask-of]` and its message once a frame at most; `askAtTop`
  decides.
- **Since you were here** (`left.ts`): `pineta-left:<session>` on the
  device, per lane, the column's tip when its reader left it at its end.
  `seen.leave` writes it, on unmount, page hide and `pagehide`, in the same
  call that saves `SeenEnd`; nothing is written while you watch, since each
  write is a `storage` event in every other tab. A column reads it as it
  mounts and when the page shows again, and `.left-line` takes no height.
- **Selectors:** `.column[data-density]`, `.density-choice[data-density]`
  (`aria-pressed`), `.ask-work[data-ask-of]`, `.ask-fold` (`aria-expanded`,
  `data-first`), `.ask-files`, `.ask-line` (`.running`), `.ask-digest`,
  `.ask-outcome`, `.ask-bar` (`data-ask`, `data-where`), `.left-line`.
  The browser suite reads finished work raw (`readRaw`).

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

## A message's tools (`message-tools.ts`, ADR-0043)

`messageTools` decides which tools a message offers, and `Message` draws
them in one row: *copy*, *edit* or *new tab*, `→`.

- **Copy is the message as markdown** (`copyText`, `copy-text.ts`): its
  text as stored, not as drawn (mentions, a `/command` and
  `![name](/blob/…)` as written), then each tool call, its whole label in
  code and its whole result fenced, past the 20,000 characters a row shows.
  A fence or code span is longer than any run of backticks inside it. A
  result's images, a `write`'s content and an `edit`'s change are not in
  the view, so they are not copied. It only reads, so a column that can't
  be written offers it too, alone.
- **The copied text is built on a press**, not by `messageTools`: every
  build of a column's list would otherwise join every call's output, and
  `sameMessageProps` would compare it. `MessageTools.copy` only says
  whether there is something to copy.

- **Edit is a branch at the message's parent**, holding its text as sent: a
  sibling, since entries are immutable. The parent comes from the index, not
  the column: a branch column's first message has its parent in another
  column. A root's first message has none, so its edit is a new tab.
- **An edit asks the agent exactly when the original did.** A branch asks only
  through a mention (`agentByDefault`), so a message its thread's default
  compelled gets `@agent ` in front. The unit test checks this through
  `address`, not the rule's own wording.
- **Only people's messages** (role `chat`) offer edit: an agent's reply edited
  by a person would be a reply the agent never gave (ADR-0018).
- **`→` is hidden at a conversation's last message**, where a branch would be
  the same as replying. At agent work's end it is a thread of its own.

## What a column shows (`column-view.ts`, ADR-0040)

`Column` gathers the facts (`ColumnFacts`), `columnView` decides, and
`Column` draws what it returns: who works in the column (`identity`), where
it forks (`origin`), where lanes start on its path (`joins`), and what
became of its files (`strip`).

- **`lanesAlong` is the one model of which lane worked where.** It walks the
  column's whole path, root first, and starts a stretch at each asked message
  whose lane differs from the one before. The header's start, the dividers
  and the origin's speaker are all read from its stretches.
- **An asked message's lane is its revision record's, which the host writes
  when the turn ends** (`turnDone`). A message with no record yet is the
  column's lane's running prompt, so it falls back to the column's lane.
  With no revisions at all (a host without a project), every asked message
  falls back, and the whole path reads as the column's lane.
- **`offerView` (`@pineta/marginalia`) decides an offer; `offerWords`
  words it**: its line and each button's label, by state. The bookmark is a
  fact of its own, drawn apart (`.offer-bookmark`), never in the line.
- **The header's clicks are `openAt` intents** (`planOpen`), which reveal
  the entry in whichever column shows it. A column's lane may have
  started in a column to its left.
- **The banner (ADR-0050, ADR-0053) is the thread's at the column's end**
  (`banner`): the lane's `pineta.banner`, none for a conversation. It takes
  the star's place before the name (`ThreadMark`): a fixed 1.5rem square,
  the head row's height, holding the star, with the image laid over it
  absolutely, so its arrival moves nothing. The star stays in the text
  (`✦ name`), hidden under an image. A new one fades in once loaded, the
  star fading out; the one there as the column mounts shows at once, or
  every tab switch would fade it in again: `Column` keeps the banner's URL
  as it mounted (`bannerUrl`), and `columnView` decides `fade` from it.
  `isolation: isolate` makes the
  header's own background what `mix-blend-mode: lighten` blends with: the
  sprite's black ground becomes the header's colour. The header has no `overflow: hidden`: on a flex item that
  removes its minimum height, and a tall column squeezed the header.
- **`onCreatesLane`:** the composer tells the column, in an effect, whether its
  next send would create a lane, so the header can say `✦ new agent`. It is a
  boolean, not the text lifted up: `Column` redraws only when it flips, not
  on every keystroke.
- **The thread to come is named before the send** (ADR-0057). `headLane` is
  the lane the header names and draws the banner of: the thread's, or the
  column's reserved one while `createsLane`. `columnView` decides the
  `reserve` step: `mint` a lane id (`newLaneName`, `ids.ts`) for a column
  with none, `ask` the host to name it, else `none`. `Column` carries it out
  in an effect keyed on the step. Asking again (a remount, StrictMode) is
  harmless: the host does nothing for an id it has named.
  - **Only where the thread has no lane.** `createsLane` is the composer's
    report, a render behind: a column that has just bound still carries it
    for that render. Its effect runs before `App`'s stores the layout, so a
    `mint` then would act on a root whose columns are not stored yet.

## Words come from values

A label is decided as a value and worded in one function: `offerView` and
`offerWords`, `queuePlace` and `queueWords`, `planSend` and `sendButton`. A
change of wording then touches the words function, its one test, and
`docs/06-interface.md`.

- **Tests check the value.** A test about who a message is for checks
  `SendPlan.to`, not the label. One table per words function (`test.each`, as
  `describe("offerWords")` and `describe("sendButton")` are) pins the words.
- **Suites compare with the words function**, never a literal: the browser
  suite builds its labels from `recipientWords`, `queueWords` and `UPLOADING`
  (`@pineta/client/send`), as it does tool labels from `toolLabel`. A check
  that is about the words themselves (a run's tooltip, a refusal's reason)
  keeps its literal.
- **Docs quote labels in `docs/06-interface.md` only.** An ADR states the rule
  ("the button says what the send does, and to whom"), and this file names the
  function.

## Colour carries the link, not geometry

Each column takes the rail track of its last message (`branchColors`); its
header, its fork dot in the parent column and its rail track share that
colour. There are no connector lines, so sibling branches never cross.

- **One inline `--track` per element** (`trackStyle`, `rail.tsx`): the
  header's border, name and origin dot, and the fork dot, read
  `var(--track)` in CSS.
- **Hover linking is CSS.** Headers and fork dots carry `data-color`, the track
  modulo the palette; `:has()` rules in `index.html` outline one in
  `var(--track)` when the other is hovered. No component state. The rules are
  eight pairs: CSS cannot match two elements' attribute values.
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
  origin row are buttons. The header is `user-select: none`; the offer's
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
- **A release keeps the tip it left at** (`releasedTip`, ADR-0056): set by
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

## Threads, lanes and the composer (ADR-0020)

- **The agent can reply in several threads at once**: `readAgentActivity`
  returns every running lane. The rail pulses at each tip, and each column
  streams the runs whose tip is on its path.
- **The composer decides before sending, as the host will.** `threadOf` finds
  the thread (the column's bound lane, or its end), over `readLanes` and
  `readParticipants`, the reads the host decides from. `planSend` (`send.ts`)
  decides the rest: who the message is for is `addressChat`
  (`@pineta/marginalia`), the function `planChat` runs on the host, so the
  button cannot promise a reply the host will not start. `SendPlan.to` is
  `addressChat`'s `Address`, unchanged. A fresh column sends `branch`; a
  send that asks the agent while its lane is busy (`isBusy`) queues.
  `sendButton` words the plan (labels: `docs/06-interface.md`), and
  `placeholderWords` gives the box's placeholder: the composer holds only its
  state and draws.
- **Every send from a column carries its `ColumnHow`**: its bound lane,
  whether it is a Start Agent column, and its reserved lane, built once by
  `Column` for its composer and for everyone else's cards at its end, since
  sending any of them here creates this column's lane.
- **The queue names the last message waiting,** not who the agent is
  answering: the host takes held items in the order sent, whatever their kind,
  so a new one waits behind the newest (`LaneView.lastWaiting`). `queuePlace`
  tells yours from someone else's by the column's `session.writer`;
  `queueWords` says it, with a `title` counting the queue when more than one
  waits ("3 waiting ahead").
- **Conflict.** A compelled `reply` that lost a race comes back `conflict`, and
  the card keeps its text and the editor offers the queue button, in the lane's
  current words (`queueWords`), or **branch here**. The line above them is
  `raceWords`, through `settleSend`: the host sends the writer, not a name, so
  the client names it and can tell it is you (the host falls back to the
  lane's `askedBy`, which is you when your own run is going): "You already
  asked the agent here".
  On one host the page sees another writer's run start almost at once and
  chooses `queue` itself, so a true conflict needs two sends to cross in flight.
  Its outcome is checked in e2e; the prompt's rendering is not exercised in the
  browser suite, because no honest browser action can force the crossing.
- **Failed.** A command the host threw on comes back `failed` with the
  error's message. The card keeps its text (`spends` is false), as for a
  refusal, but `failedWords` never says "not sent": the host may have written
  the message before it failed. The profile form words a failed rename with
  the same function.
- **Waiting messages** from `pineta.outbox` show dimmed in their column, in the
  order they will be taken. They are not in the tree yet.

## Pasting an image (`paste.ts`, ADR-0042)

- **A paste with image files is an upload.** `pastedFiles` keeps the
  `image/*` files; with none, the paste is the browser's own. With some, the
  composer prevents the default, records the selection, and `POST`s each
  file to `/blob` (`uploadImage`, same origin, so the key cookie goes too).
  When all are answered, `insertAt` puts every accepted one's
  `![name](/blob/<sha256>)` (`imageMarkdown`) in place of that selection, on
  lines of their own, at once. A refused one is left out, and the host's
  reason shown in the status line.
- **Sending waits for uploads.** `sendable` is null while one is out, and
  `sendButton` disables the button and labels it `UPLOADING`: a message sent
  then would lack the image's markdown.
- **The host decides what a message shows.** The composer shows markdown,
  not thumbnails. On send, the host reads the `/blob/` images from the text,
  and refuses the send if one is no longer stored (`image_missing`), which
  `settleSend` returns to the box.

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
  a `<details>`, cut at 20,000 characters for display. A label shows a command's first line, at
  most 120 characters. A cut label is shown uncut in its place while the row
  is open (`.tool-label-whole`, from `wholeToolLabel`): CSS on `[open]`
  swaps the two, so the command is never drawn twice and no state is kept.
  The live row is the committed row, so a running command, once its row
  opens, shows it whole.
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
- **Stop** shows above the composer while the thread's lane runs, and sends
  `stop`. It is the column's, not a card's. The host records who sent it
  under the ask (`pineta.stop`, ADR-0056).
- **What the agent is doing shows in three places, none taking layout**
  (ADR-0054). `running` (`lane.running`, Stop's fact) is computed once in
  `Column`.
  - The mark before the thread's name (`.thread-mark`: the `✦`, or the
    banner over it) pulses while it is true, titled by `workingWords`, which
    names the running ask (`askWords`, ADR-0056). The square pulses, not
    the star, which a banner hides.
  - A live row the work opened carries `data-revealed`, and
    `.tool.live[data-revealed]::after` draws a ring around it. A call
    shorter than `REVEAL_MS` is never revealed, so it shows none. The ring
    is a positioned pseudo-element, not an `outline`, so it can reach 1rem
    into the column's right gutter (1.75rem, against .75rem on the left)
    and sit centred in the column. The browser suite measures it from the
    row's box and the pseudo-element's resolved insets.
  - `.working-line` is drawn at the content's end for the whole run, before
    the waiting messages; in outline the running ask's own line pulses, and
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
- **Where a new thread's agent works** (ADR-0032). When a send would create a
  lane (it asks the agent where no lane is, or it is a branch), a chip left of
  the button says where, in `whereWords`'s words: "on a copy ▾", "in your
  working copy ▾" or "in <dir> ▾". It opens a menu of `whereChoices` (`send.ts`):
  a copy, your working copy, directories other lanes used, and "in another
  directory…", each row the chip's words and what the choice means for your
  files ("· you take its changes", "· edits your files"). A copy is disabled,
  with the project's reason, where the project cannot have one. The choice is
  the composer's state until sent, as `asksAgent` is; its default is
  `workFor`, the host's own decision. The chip's words are `.where-words`,
  with `data-work` (`own` or `direct`): `Menu` passes no attributes to its
  trigger, so they sit on a span inside it.
- **A column's header** (ADR-0040) names who works in it (`✦ amber-fox`,
  `✦ new agent`, or nothing in a conversation), then, in a second row, where
  it forks. It shows no commit and nothing of where the lane works.
- **The work strip** (`WorkStripView`, above the composer) is the lane's
  offer for its own copy (ADR-0038): `offerWords`' line, which opens the
  review while the offer is open and holds files (ADR-0047, below), the
  bookmark apart, which a press copies to find it in jj or jjui, its
  buttons, and a `⋯` menu for the rest
  ("update from my work", "rewrite description"). What the lane runs now
  (`activityOf`: a turn, a resolution, or a split, from its latest prompt's
  role) comes first: while it runs, the line counts files so far and offers
  nothing. A lane that works directly says where its changes land, and names
  other lanes running in the same directory now.
- **An update's prefill** goes into that column's composer, unsent: `update`
  answers `updated` with the text, and the column hands it to the composer
  as `insert` with a fresh key, which lands once after whatever is typed.
- **Land, update and stack messages** show as one line each, roles `land`
  ("resolving your work"), `update` ("your work") and `stack`.
- **The page header counts offers open** in your repo, as it counts
  mentions, and the agent's running threads; each row leads with the
  thread's name and opens its thread.
- **Selectors in the browser suite:** a column's offer is `.work.offer`, with
  `data-state` (`ready`, `conflicts`, `stack`, and the rest of
  `offerView`'s states); its line is `.offer-line` (a button when the offer
  can be reviewed; its caret is CSS, so its text is the words alone), its
  bookmark `.offer-bookmark`, and each button `.offer-<action>`, Take being
  `.offer-take`. The review is `.review`, with `.review-list` (rows
  `.review-list-file`, titled with the display path) and `.review-diffs`;
  each file is `.review-file[data-key][data-letter][data-state]`, its head
  `.review-file-head`, its diff `.review-diff` of `[data-kind]` lines. The
  28rem check measures `.column-thread`. A direct lane's strip is `.work[data-state="direct"]`, with
  `.work-warning`. The header's `.agent-name` holds the thread's name in
  `data-thread` (`.agent-name.pending` before it has one); its origin row
  is `.origin`. A lane's divider is `.lane-join`, with `data-thread`. The
  header's mark is `.thread-mark` (`.pulse` while its lane runs), the line
  `.working-line`, and a row the work opened `.tool[data-revealed]`.
- **The invite key** needs no client code: the host's redirect sets a cookie
  that same-origin requests and upgrades carry. `connectSession({ key })` is
  for Node clients.

## Reviewing an offer (`review.ts`, `review-pane.tsx`, `use-fetched.ts`, ADR-0047)

The offer's line opens a review, and the column widens to hold it. So does
an ask's file count (ADR-0056): every review is of spans (`DiffSpan`), an
offer's revisions or an ask's range from its prompt's commit to its last
turn's, and `ReviewTarget.title` heads a range, which has no description.
One review is open at a time.

- **A column is `.column` > `.column-thread` + `.review`.** `.column` stays
  `#strip`'s direct child with its key, position and track, so dragging,
  alignment and revealing find it as before; the thread, 28rem, holds the
  header, body, others' cards, strip and composer. `reviewing` is `Column`'s state,
  never stored, and is reset during render when the strip's `review` goes
  (a take, a withdrawal), so no frame draws a review that is gone. Hiding
  it instead would let the next offer open it unasked.
- **Every URL names its commits** (`reviewUrl`, `diffUrl`, `@pineta/marginalia`),
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
- **A 404 for a commit the offer has just left is brief:** the record arrives
  with the new commits, and the review asks for their URLs.

## Message text is markdown (S27)

`messageTree` (`markdown.ts`) turns a message's text into the tree
`MessageText` draws: remark-parse, remark-gfm and remark-rehype, as
react-markdown runs them, then Pineta's own pass over the tree. Owning the
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
  (`.blob-image`) shows it over the page ("A clicked blob image is shown
  over the page", beside `Popover`).
- **Streaming text goes through remend**, which closes an unfinished `**`,
  fence or link, with `singleTilde` and `comparisonOperators` off: those
  escape mid-text, and the message would change when it commits. Committed
  text never goes through it.
- **One `white-space: pre-line` on `.text`** shows soft breaks as people type
  them. The pass drops the newlines to-hast puts between blocks and after a
  `<br>` (text with no position), which would otherwise show as blank lines.
  Chrome then ends a paragraph at a shown newline, so a triple-click there
  selects a line.

## Presence (ADR-0024)

- **Every column of the tab you are on is reported** (ADR-0029), since there
  is no focused column: `App` writes each column's thread end when it changes,
  deletes the key of a column no longer reported (`planReading`,
  `presence-report.ts`, decides both), and refreshes all of them
  every 10 s while `document.visibilityState` is `visible` (a
  `visibilitychange` listener refreshes on return). Switching tabs therefore
  clears the last tab's keys, through that same deletion. The Archive tab
  reports nothing. Typing is written at most once a second (`typingDue`).
- **A tab's avatars** are `readersByRoot(peopleHere(…))` (`here.ts`): the
  header's people turned around, each tab's `Readers` taking its root's.
- **`core/presence.ts` decides everything shown**, from one field's read
  (`readReading` and `readTyping` in `@pineta/reads`) and the
  tree: rings (`readingAt`), a header's avatars (`seenBy`, others whose
  thread end lies on one path with this column's), and who is typing
  (`whoIsAt`). Each leaves you out, and shows a person once however
  many seats report them (ADR-0037). Which component reads which field is
  under Renders.
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

## Drafting cards (ADR-0048)

What you type is a card: a record in the cards document (`session.cards`,
read with `readCards`) and a `TextDoc` of its own (`session.cardText`). This
client writes both; the host only spends a card when it is sent, and sweeps
empty ones when it starts (S58).

- **Where the column's cards are.** `Column` resolves its thread's end with
  `threadOf`, as a reply would go, and finds your card there with `yourCard`
  and everyone else's with `draftingAt`. A fresh column's card is found by
  its key (`CardPlace` `fresh`). So a tab switch, a reload or another device
  finds the same card: it belongs to the thread, not to the mounted column.
- **One editor for every card: `card-editor.tsx`.** Your composer is one, and
  everyone else's cards above it are others, with a heading (`cardHeading`)
  and no where-menu. `Composer` is the column's foot: typing presence and your
  card's editor, in the `form.composer` the suites select by.
- **One uncontrolled textarea for the editor's whole life.** While there is no
  card, it holds what is typed and nothing else does. The `input` that makes
  `needsCard` true (anything `sendable` would send) creates the card from
  `element.value` and binds the same element to the card's text with
  Kyneta's `attach`, in that one handler: no keystroke falls between them,
  and focus and the caret stay where they are. A card that already exists is
  attached on mount. `editorState` (`card-state.ts`, pure) decides every step
  and names its acts in order (`create`, `attach`, `detach`, `redo`); the
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
- **Undo** is the tab's Kyneta stack (`session.undo`, `createUndoStack`), in
  memory, over the cards document and every `card:` document. A box undoes
  only its own card (ADR-0052): `attach` sends Cmd+Z, Cmd+Shift+Z and Ctrl+Y
  to `session.undoFor(card)`, which passes Kyneta the card's text document
  (`undo({ docs })`), so it takes that card's newest step even under newer
  steps in other cards. `SessionClient` exposes only `undoFor`: the stack's
  own `undo()` takes its top step, which can be anywhere.
  Creating a card is one step with its first text, so undoing past it removes
  the record. Typing is grouped by word.
- **An emptied box can redo its card.** When a bound card goes without a send
  from this box (your undo past its creation, or someone else's send),
  `editorState` keeps it as `local.last`; a redo there (`isRedo`: the keys,
  and a `beforeinput` of `historyRedo`, which takes a native listener)
  redoes through `undoFor(last)`, and the record coming back binds the box
  (`found`). Whether the key is the editor's is the step's `claims`: every
  emptied box claims it, with a card to redo or not, and a bound box never
  does, since Kyneta's binding takes the undo keys. Another card's creation leaves that redo alone: Kyneta
  conflicts steps by the record keys and texts they write, not by document
  (S64, addendum 3).
- **A card the host spent is destroyed on every client holding it** (S64),
  so no step on it stands, and a redo in an emptied box cannot write into it.
  The host's `dismiss` leaves a receiver's copy, so `connectSession`
  watches each card document `cardText` opens, the client's one opener of
  them: `hostLetGo` says the host left it while connected, and `spentCards`
  destroys the copy once the record is gone too. The two arrive in either
  order, and a copy whose record is live is never destroyed: a render could
  still read its text and make a new, empty copy.
- **The editor's unmount clears its binding's handle** as well as detaching:
  StrictMode mounts twice, and a stale handle leaves the second mount
  unbound.
- **Who wrote in a card** is `writersOf(textClients(cardText), seats)`: its
  Yjs `clientID`s, through the host's seat records (`readSessionFacts`
  reads them). Provisional (ADR-0048): undo does not remove a `clientID`, so
  someone who undid everything they wrote is still named. Step 6 replaces it
  with a projection of the card's history; marks do not use it.
- **Closing a fresh column that holds text** asks in its header; discard
  deletes the record outside the undo stack, since no column could show it
  again.

## Marks for your cards (ADR-0048, step 2)

A pip in your colour (`CardPip`, `.card-pip`, the one selector the suites
use) marks where an unsent card of yours holds text: its root's tab or its
new tab, the rail dot at a drafting card's thread end, and, for a root with no
tab in your bar, the root's row in the Archive tab. The Archive tab itself is
marked only for a root whose tab you closed: an archived root's work is done,
so it never lights the tab (`elsewhere`).

- **`cardMarks` (`card-marks.ts`) decides, purely,** from your cards, the
  ones holding text, the layout, the lanes and the index. A drafting card is
  placed by `cardEnd` and `rootOf`; a fresh card by `tabOfColumn`, so one
  typed in another browser tab or device, whose layout this one lacks, marks
  nothing until the drawer (step 4) collects it.
- **The marks read text, not records:** a record outlives its text (an
  emptied card stays until sent or swept). `holdsText` is `needsCard` with
  the one blank prefill, `AGENT_PREFILL`, so a bare `@agent ` is nothing,
  in any card.
- **`useFilledCards` reads the texts**, through `cardText` (`get`, never
  Kyneta's `open`: the browser keeps no store, so a card typed elsewhere
  would never open). It is a subscription of its own, an exception to
  "every subscription is `useSelector`": `useTracked` compares no values,
  and would render `App` on every keystroke. Each change goes through
  `withFilled`, which returns the same set unless a card flips between empty
  and not, and React skips a render for the same state.
- **A thread's mark is on the rail, never on its column.** On screen, the
  column's composer shows the text; scrolled away or closed, the column
  cannot show a mark, and the rail shows every thread. `railKeep` keeps the
  marked ends out of runs, so a mark is always on a dot.
- **Only your own cards count.** Cards you contributed to wait for step 6,
  where who contributed is a projection of the card's history and follows
  undo.

## Selectors in the browser suite

- **A message's own text is `.msg > .text`.**
- **`:text-is` matches the smallest element holding the text**, which in
  markdown is the paragraph, not `.text`. The suite finds a plain message by
  `.text > p:only-child:text-is(…)`.
- **Waiting on a selector** is in `apps/pineta/e2e/TECHNICAL.md`: a wait
  for an element CSS hides never ends early.

## Who you are (ADR-0037)

A person is their email: the principal every Exchange of theirs names, and so
their writer, `w-<email>`. Kyneta issues each tab its own peer id, a seat, so
the email is the only thing Pineta chooses.

- **Asked once per browser, before anything connects.** `main.tsx` reads
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
  effect in `App` performs it (`nameEffects`), keyed on `settled` and your
  session name: before
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
  `core/presence.ts` shows each person once, and never you.
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
- **A renamed root's tab is an `<input class="tab-title-input">`, not a
  `.tab`**: an input inside a button is invalid HTML, so while the field is
  open, `.tab[data-root]` is gone. Enter, Escape and blur all go through one
  `finish` that acts once: removing a focused field can fire a blur after
  Enter or Escape, which would save again, or save a cancel. Only Enter and
  Escape give the tab focus back; a blur leaves focus where the person put
  it.
- **A root tab's `⋯` is always rendered, hidden with `visibility`** except on
  the tab you are on, while hovered or focused, or while its menu is open
  (`Menu`'s wrapper, `.tab-more`, gains `open`). The menu is its child, so
  hiding the `⋯` would hide an open menu too.
- **A column's × (`.close`) is `closable`** (`ColumnSlot`, `appView`):
  hidden on a root tab's only column (`columnsOf` would give it back) and in
  the Archive tab's preview.
- **A popover opens above its trigger in the window's lower half.** A
  composer's `▾` is at the window's foot, so a list below it would be out of
  sight; and since `.popover` sets a `top` in the stylesheet, the upward box
  sets `top: auto` too, or `top` wins over `bottom`.
- **Anything that pops out of the tab bar is `position: fixed`.** `.tab-list`
  scrolls sideways, and `overflow-x: auto` makes its vertical overflow `auto`
  too, so a menu positioned inside it is clipped below the bar. `Popover`
  places its box from its trigger's rect when opened, and closes on a
  resize or a scroll of an element holding the trigger, since a fixed box
  would drift from its trigger. Not on any scroll outside the box: a column
  following its end scrolls whenever an entry arrives, which closed every
  open menu (the header's @ among them) without the person doing anything.
- **Playwright clicks what a person cannot see.** It scrolls a clipped element
  into view before clicking, so a check that a popup can be clicked does not
  show it is visible. Check what `elementFromPoint` finds at its centre: the
  browser suite's `chooseFromMenu` does, for every menu. It clicks no
  disabled item: it returns false, so the check expecting the item fails and
  the suite goes on.

- **Selectors for root tabs:** a root's tab is `#tabs .tab[data-root="…"]`,
  the one you are on has `aria-selected="true"`, its × is the `.tab-close`
  after it, its `⋯` holds `.rename-root` and `.archive-root`, a root being
  renamed is `.tab-title-input`, Archive is `.tab-archive`, new tabs are
  `.tab-new`, and the add tab's buttons are `.add-agent`, `.add-menu` and
  `.add-conversation`. In the header: `#top .here-person .here-trigger` per
  person, `.here-agent`, and `.inbox-trigger` with
  `.inbox-count[data-unseen]`; menu rows are `.here-thread` and `.inbox-row`,
  each with `data-entry`. You are
  `#top .me-trigger` (its `title` your name), opening `#profile`, with
  `input[name="name"]`, `.name-handle`, `.name-problem[data-problem]`,
  `.profile-email` and `.not-you`. The identification screen's email problem
  is `.identity-problem`.
- **A page with nothing stored opens on the Archive tab**, so a browser check
  that opens a second page opens its thread from there, or from a person in
  the header. The rail is `.rail`, not `#rail`: the
  Archive tab's preview draws a second one.
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
