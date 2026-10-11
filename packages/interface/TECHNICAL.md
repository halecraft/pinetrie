# `@pinetrie/interface` — technical notes

What a person sees and can do, decided, for any client (ADR-0093): your
list, the root you are on as a rail and columns, the board, the cards and
your inventory, what needs you, and the words for all of it. The page,
`@pinetrie/web` (`packages/web/TECHNICAL.md`), draws it with React; a TTY
would draw the same values in a terminal. Everything here is pure: it reads
what the session and the documents hold (`@pinetrie/session`,
`@pinetrie/reads`) and returns values. Everything shown is a read of the
session document through `@pinetrie/reads` and `projection.ts`, and of your
own documents through the session; the only state a client keeps of its own
is the layout (which task you are on, your view of each task's columns,
whether the board is open), which the page keeps per browser tab. What is typed is a
card (ADR-0048): a document of its own, written by its client, and kept on
its thread.

## What is here, and what is the page's

The rule (ADR-0093, S115): **the page holds its `.tsx` components, its
`use-*` hooks, and the modules that touch the DOM or React, exist only for
`React.memo`, or deal in HTML's tree (`markdown.ts`, `pane.ts`). Every other
module is here.** A module that held both halves split: a value, its rules
and its codec are here (`identity.ts`, `list-width.ts`, `inventory-dock.ts`,
`codec.ts`, `same-data.ts`, `palette.ts`); where the browser keeps it is the
page's (`storage-keys.ts`, `tab-state.ts`, `same-props.ts`, `colors.ts`).

- **No DOM, no React.** `packages/interface/tsconfig.json` type-checks this
  package with `lib: ["ESNext"]`, run by `pnpm run typecheck` beside the
  root's config, which includes the DOM. A `window`, a `document` or a DOM
  member here fails; a mere mention of the `HTMLElement` type does not, since
  React's types declare it. `workspace.test.ts` pins the dependencies (core,
  protocol, reads, rules, schema, session, shell and TypeBox), and only the
  page and the app may depend on this package. The host takes `callLabel`
  from here for a revision titled by its first call.
- **`index.ts` exports by name only what another package imports**, as
  `@pinetrie/rules`' does; a name only this package and its tests use is
  imported from its module. The tests' fixtures are `fixtures.ts`, which the
  page's tests take as `@pinetrie/interface/fixtures`; production code never
  imports it.
- **Where `session` ends.** `@pinetrie/session` is one client's connection,
  its own documents and what it has in flight, and decides nothing about
  what is shown. This package depends on it.
- **An input's whole chain is here:** an `Intent` (`intent.ts`) is planned
  by `planIntent` into `Effect`s (`effects.ts`, with `IntentState`, `show`
  and `planOpenAt`, which the card intents and the reveal plan with too),
  and `perform` (`perform.ts`) carries each out through `AppPorts`. A client
  implements the ports. An effect a client has no use for, such as `fly` in
  a terminal, is a port that does nothing.
- **The columns, the rail and the folds came from core** (ADR-0093):
  `column-paths.ts` (`projectColumns`, `branchColors`), `rail.ts`
  (`compactRail`, its placing, `railLandmarks`), `work-stats.ts`, and
  `ask-segments.ts` (`segmentPath`, `askStats`); `presence.ts` reads who
  else is here. Core keeps what its own exports use: `projectRail`, since
  `summarizeRoots` counts a root's messages by its rows, `projectSpine`,
  `threadEnd` and the tree's reads. A capsule's span is the client's
  (`compactRail`'s `spanOf`, the page's `stretchSpan`); a long ask is core's
  (`LONG_ASK`), since the host digests it.
- **The projections stay separate functions** (`projectColumns`, `pathIds`,
  `branchColors`, `unsentSignals`): the page memoises each on its own inputs. A
  single function projecting the whole screen would hand every memoised
  component of the page new props each render (S54, S59).

## The roots a tab holds (ADR-0063)

- **A tab holds the roots it shows** (`planHeldRoots`, `held-roots.ts`): the
  roots of the sidebar, and the one you are on, archived or not, and of each
  thread in your inventory (`inventoryThreads`), whose slot and preview read
  it (ADR-0124). `SessionClient.holdRoots` opens what is new and `destroy`s what
  is not, which leaves the host's copy (S86). A root this client starts is
  held from its first send until the page asks for it, and after that only
  while the page does. What opens and goes, and why every other root is
  declined, is the session's (`planHold`, `root-hold.ts`, and `rootDocs`,
  `packages/session/TECHNICAL.md`).
- **Every cross-root fact comes from the directory** (`readRoots`): each
  task's summary and label (`summariesOf`, `labelsOf`), the board's items,
  `prune`'s known roots, the inbox's mentions, ▦'s count (`messageCount`:
  the held roots' messages, of every root's), the participants
  (`participantsIn`), and the root entries of offers (`laneRootsOf`). A
  card drafted in a root not held marks its thread's task, from the task
  index alone (`unsentSignals`).
  The board's search covers labels: a search of every message would hold
  every root.
- **A record's read keeps its map while its namespace is unchanged**
  (`readRecords`, ADR-0095), so a directory write wakes no read of names.
  `readParticipantNames` also keeps its map while the names are the same,
  since every message compares it by identity (the browser suite's "a
  message in another thread redraws none of this tab's messages").
- **The held roots read as one tree** (`readHeldIndex`), so every projection
  below works as it did over one document, for the roots held. A root's
  columns sync only while it is held; `prune` waits for the stored tabs'
  roots to settle, and drops only what the directory lacks.
- **What the footer and the board open may be in a root not held**
  (`openLink`): one held opens as `openAt`; any other root is shown, archived
  or not, which holds it, and `openWhenHeld` shows the entry once the index
  has it.
- **A link to a thread is a `ThreadLink`** (`thread-link.ts`, ADR-0117,
  ADR-0124), which only `threadLink(thread, cards, me)` makes (a brand): `open`
  in a task, `mine` in your inventory (its preview opens: `openSelected`),
  `held` in someone else's, `gone` with no card. The inbox's rows, a
  mention, a reader's thread, a copy's or a parent elsewhere's fork row and
  a rail stub all follow one through the `openLink` intent
  (`planOpenLink`); `linkWords` words it, "Bea has it" (`heldWords`).
  `openAt` serves only what is drawn: an entry whose thread is in no task
  gets no plan from `planOpen`.
- **A write names its root**: `chat` and `mark` find it from the held
  document with the entry (`rootOf`), and a send at the root mints one
  (`newRootId`) and its task (`newTaskId`). A card's place at a thread
  names its thread and no root (ADR-0116): the thread's record names the
  root, which the host reads as it pops a queued card into a chat.

## Reads go through one index

`readTreeIndex(doc)` (`@pinetrie/reads`) builds `indexTree` once per change of
the document's entries, and returns the same index until one changes. The
columns, the rail and the agent's path all read that one index
(`packages/core/tree.ts`). `App` reads it through `readSessionFacts`
(`projection.ts`), together with the entry count, the agent's activity, the
streams to draw (`liveWork`, over the stream records alone), the
participants, the archive and the work facts, so they are always from the
same moment. The lanes are read from two documents, the session and the
cards (`readLanes(doc, index, cards)`), by a `useSelector` over the session
whose selector changes with the cards. `resolveLayout` takes the index, the
lanes and the archive together.

**Ids arrive branded.** Every entry id the client holds came from the reads
as an `EntryId`, and every lane as a `ThreadId` (`packages/reads/TECHNICAL.md`),
so the client never mints one but where an id comes back in from elsewhere:
its stored form (`layout.ts`'s `decodeLayout`), your attention document
(`readAttention`, in `@pinetrie/schema`), and ids read back from the page (`use-ask-bar.ts`, from `data-ask-of`; `root-target.ts`, from a root's drag and its drop marks).
`biome.json` refuses an `entryId` or `runId` import anywhere else in the
client; tests build entries and trees through `fixtures.ts`, which mints.

## Views decide, intents act

The page works as the host's shell does: gather, plan purely, then carry
the plan out (`apps/pinetrie/host/TECHNICAL.md`). A rule kept in a component
can only be proven in a browser, minutes per check; a rule in a pure
function is proven by a unit test in a second.

- **A component draws a view.** It branches only on a view's `kind` or its
  flags, and draws the view's strings. It compares no document fact, builds
  no label, and chooses nothing that is offered. The views are `appView`
  (`app-view.ts`), `sidebarView`, `boardView`, `columnView`, `messageTools`, `railItems`,
  `rowSummary` and `rowView`, `callStatus`, `editorState` and `startText`,
  and a search's `columnMatches` and `searchLine`. What stays in
  components and `use-*.ts` is what needs a browser: measuring, focus and
  the caret, scrolling, observers, subscriptions.
- **A click is an `Intent`** (`intent.ts`). A column's acts are nested
  under its key (`{ kind: "column", column, act }`), a `ColumnKey` by kind
  (a card's column, the task column), and a message's `MessageAct`s are
  among them. What one kind alone does is an intent of its own naming a key
  of that kind: `moveColumn` a card's (`CardKey`), so moving the task
  column does not compile; `closeUnstarted` and `sentFirst` name an
  unstarted thread's card (ADR-0126). `Column` takes one `onIntent`, which `App`
  makes once with `useStable`, so it never redraws a list.
- **`planIntent` turns an intent into `Effect`s**, from the layout, the
  index and the archive of the render it was made in. It owns what a click
  does: which task a column act belongs to, that × closes a tab and writes
  nothing, that a column you open takes focus (`armFocus`). Ids come from
  the shell as an argument (`Minted`): a key, a new tab's root and task, the
  thread a column opens, a note column's id.
  `afterRootMove` plans a move on the board's answer, and `nameEffects` the settle's
  name step (`reconcileName`).
- **`perform` carries the effects out** (`perform.ts`), one port call each,
  through `AppPorts`: the reducer's `dispatch`, the session's writes,
  `reveal`, the sidebar (`openThreads`), focus, the identity store and
  `reload`. A request the session does not track is one `request` effect
  carrying the `HostRequest` itself, so a new kind of request adds no effect
  and no case. What the session tracks keeps a method of its own: a chat
  and a move (`moves`), an offer action and a line action (`acting`), and a
  mark, whose root it finds. Whether a move animates is the plan's too
  (`moveCard`'s `fly`).
- **`appView` decides; it does not project.** The projections
  (`projectColumns`, `pathIds`, `branchColors`, `unsentSignals`) stay in `App`'s
  own `useMemo`s, and their results come in. One tree rebuilt each render
  would give every memoised child new props (S54, S59). `appView` gives the
  stage (`connecting`, nothing, or a task's columns as `ColumnSlot`s), the read-only words, and the open offers your inbox and the board read. A slot
  is new each render; `Column` is not memoised, so this costs nothing, and
  a slot must never reach a memoised component by identity.
- **A page over the stage is a value too** (`page.ts`, ADR-0098): the
  `page` intent and effect open or leave it through the `page` port, and
  `planIntent` leaves it first whenever a plan shows something in the
  stage (`showsStage`, `layout.ts`). Which hash names a page and
  how leaving treats the browser's history (`planLeave`) are decided here;
  `use-page.ts` carries them out (`packages/web/TECHNICAL.md`, "Pages").
- **`main.tsx` boots the page:** it builds the device's stores, asks who you
  are, connects, and mounts `App({ session, stores })`. `app.tsx` touches no
  browser global as it loads.

## The sidebar and the layout (`layout.ts`, ADR-0029, ADR-0030, ADR-0122)

The stored layout is `{ v: 9, active, tasks, board }`, and
`layoutReducer` is pure; an older version restores nothing. `active` is a
`Here`: a task (ADR-0116), or nothing. A new tab is a task of its own from
the moment it opens (ADR-0126). A task's columns are its
canvas's, in its order, the same for everyone (*The canvas*, below); the
layout keeps only your view of each task (`TaskView`), by its `TaskId`.
The sidebar is
not the layout's: it is your own document (`openThreads`,
`@pinetrie/session`), keyed by `TaskId`, which `App` passes in as
`LayoutFacts.list`. `tasksOf` (`tasks.ts`) is the page's `Tasks`: the
rules' `TaskIndex`, and each task's threads and roots (`byId`).
`entriesOf(tasks, directory)` is each task's first root's root entry: what
the sidebar's `data-root` and the board's `data-entry` carry, which the
browser suite selects by. The rail draws one tree for each root of the
task's threads (`hereRail`). A task's signals are its threads', whatever roots they are in
(*Attention*, below).

- **`Layout.open` is drawn, never stored** (`drawnList`): the sidebar, less
  the archived roots but the one you are on, and the root you are on
  wherever the list lacks it. Another device's repair may have taken it
  out of your document; the screen you are on does not lose it.
- **Who writes the sidebar.** `show` of a root ensures it in your document
  (`intent.ts`'s `show`, a `list` effect), so every way of opening goes
  through it: the board, your inbox, `openAt`. A root you
  start joins it in the session, as its send is answered (`startsRoot`). ×
  is a `list` close and a `closeRoot`, which moves you on only if you were
  on it: `afterClosing`'s choice, the sidebar's next item below, else above,
  else nothing. `moveInList` places a root before another, or at the end.
  The session's repair deletes archived roots but the one the page reports
  it is on (`openThreads.here`), so a restore brings a root back only for
  whoever restores it.
- **A task's label is `labelsOf`'s** (`root-label.ts`, ADR-0045, ADR-0074,
  ADR-0116): its title (its `MARK`); else, from its first root,
  `CHAT_LABEL` for a root no lane works in, read from the session's lane
  records, so a root only people wrote in needs no field of its own; else
  its first line, from its directory record (ADR-0063). `summariesOf(tasks,
  directory)` is each task with a message: its first root's first line,
  every one of its roots' writers, and its newest message. `App` builds
  both maps once per change, and every place that names a task looks one
  up: the sidebar, the board, the activity menu, the inbox. The first line
  is also the rename field's placeholder: what clearing a title brings
  back.
- **Renaming is `Sidebar`'s state, never the layout's.** `planTitle` is the
  field's submit, over `parseTitle`, the rule the codec decides by too, and
  `renameKey` what Enter and Escape do.
- **What the sidebar shows and offers is `sidebarView`'s**
  (`sidebar-view.ts`), over `listOf`'s order: each item's label, pip,
  `⋯` items (Not needed, Rename, Auto-update title, Move to ▸ each other
  state) and the intents they send. `Sidebar`
  (`sidebar.tsx`) draws it; each item's `Readers` read presence
  themselves (S59, `root-signals.tsx`). `selected` is the item you are on,
  decided there once: `App` titles the window from it (`pageTitle`) and
  `Sidebar` scrolls it into view, keyed by `listKey`.
- **The chrome is the sidebar, then the footer** (ADR-0122): the body is a
  grid, `--side` wide on the left, the stage beside it, and `#bottom`
  under both. `#sidebar` holds `.sidebar-item` wraps, each around its
  `.open-root` (or `.open-new`) button, ⋯ and ×; the selected wrap carries
  `data-selected`, set from `ItemView.selected`, and is filled with
  `--page`, the list `--chrome`. The footer (`footer.tsx`) holds
  `.footer-you` (your avatar and name, then your inbox and inventory as
  icons; folded, your avatar alone, ADR-0098), the board's strip
  (`BoardStrip`), then `.footer-right` (sync note, publish).
- **The sidebar folds to icons** (ADR-0088). The width is a value
  (`ListWidth`, `list-width.ts`): your choice in this tab, else icons on a
  small window (`shownWidth`, `useSmallWindow`). Folding is an intent,
  `foldList`, from the control at the list's foot or Ctrl+Shift+L
  (`keyAct`); `planIntent` asks for the width not shown, and `perform`'s
  `listWidth` port sets it and saves it. `App` writes it as `data-list` on
  the root element, and the CSS sets `--side` from that, so the body's
  grid, the footer's corner and the board follow. Folded, `Sidebar` draws
  each item as `FoldedItem`: `sidebarView` decides its `ItemIcon` (a
  sprite from `taskSprites`, the banner of the task's earliest thread with
  one, else `initialsOf` its label on a slot seeded
  by its `TaskId` (`taskSlot`), which `Sidebar` draws in `slotColor`). The icon is the trigger of a `Menu` opened
  by `contextmenu` (`Popover`'s `opensOn`), whose click shows the root;
  the tooltip and the rename field are fixed to the window beside it, since
  the list clips. The footer's corner then draws only `AccountMenu`, whose
  menu holds the inbox and the inventory (`accountView`, ADR-0098).
- **`resolveLayout` keeps an archived task you are on** in the sidebar as
  drawn, read-only, until you leave it. `prune`, once after `whenSettled`,
  drops the views of tasks the session lacks, and replaces a gone or
  archived task you were on
  with the sidebar's last, else nothing; with nothing, the board opens:
  nothing opens a task by itself. No action sets `active` back to null.
  Storing drops the view of a card no longer on its canvas
  (`storedLayout`).
- **Choosing a task closes the board** (`show`): it lay over what you
  chose. A new tab shows its task.
- **A click outside the board closes it** only when it was pressed outside
  too (`clickClosesBoard`): a selection dragged out of the board keeps it,
  and a drag from the sidebar fires no click, so it can still drop there. The
  strip counts as the board's own, so what is in it acts alone: ▦ toggles,
  and while the board is open, the search field, its × and "mine" (which
  stand in the state buttons' place then, ADR-0115) keep it open.
- **Moving a root on the board** is a `moveRoot` effect: the host's
  `move-root`, and, into the archive, the effects that close it for you
  (`moved`), which `afterRootMove` runs only once the host answers
  `moved-root`, as `afterKeep` does for a keep.
- **Column keys hold no `:`.** A presence key is
  `${writer}:${seat}:${columnKey}`, and `readReading` takes the writer from
  before the first colon (ADR-0037). A writer holds none (`normalizeEmail`
  refuses one) and a seat is hex; a colon in a column key would still break
  the rule that a key's parts are its colons.
- **A new tab is a task opened with its thread** (ADR-0126): ＋ mints a
  root, a task and a thread (`planIntent`'s `Minted`), asks the host to open
  them (`open-thread`, a new root's first thread, in the workflow state of
  the board column it was opened from, if any), shows the task (in the
  sidebar from then), and unfolds the thread's card with what it starts
  with (`opened`: a prefill, Start Agent). Its column appears as the host
  writes its card; its first send starts its root (`ChatHow.root`, the
  record's root, `UnstartedMode.root`).
- **The layout drawn is `resolveLayout(stored, facts)`, computed in render**
  (ADR-0044): the sidebar drawn. An effect stores it with
  `resolve`, the same function, so an action reduces from it: React runs
  pending effects before it handles the next event. `App` draws `layout`,
  never `stored`.
- **No effect dispatches from document facts,** except `prune`, once at
  settle. An effect runs a render after the facts it reads. When the layout
  was synced that way, a slow render painted new entries under the old
  anchor: a `⑂ 0 messages` chip and a row stuck at `…` (S35).
- **`planOpen` is the deduplication `App` used to do**, pure: scroll to an
  entry an unfolded column of its task already shows (the leftmost, as
  `projectColumns` lays the paths out over the unfolded columns), else
  unfold its thread's card (`unfold`). An archived task opens as any
  other; its columns are read-only (`appView`). The rail and fork dots go
  through it, as an `openAt` intent: `planIntent` turns its plan into
  effects, and `perform` carries them out.
- **Columns of other tasks are unmounted.** Alignment forgets their keys, so a
  task shown again places its columns as if opened, left to right: each at
  the spot it was left (A column's view, `packages/web/TECHNICAL.md`), else aligned, the first at
  its end (Layout: columns scroll independently, `packages/web/TECHNICAL.md`). Each keeps what it
  knew of its end (`SeenEnd`, Following a column's end, `packages/web/TECHNICAL.md`), and each tool row what it decided
  (`RowMemory`, Tools and live work).

## The board (`board-view.ts`, `board.tsx`, ADR-0122)

- **A task is a card on the board** (ADR-0126): `boardView` reads the
  cards (`BoardViewInput.cards`), the board's task cards among them, and
  draws each task with a message (`summaries`), so a new tab's task joins
  it with its first send. A move's answer is a card move's: `moved`, then
  what follows it (`afterTaskMove`); `unmoved` is said on the board
  (`AT_BOARD`, drawn above its states), naming who moved it first, and
  goes with your next move there. The
  archive (`archivedOf`) is `App`'s, from the cards and their histories,
  kept while it reads the same (`useSameData`). The undo key on no task
  undoes a move on the board; one that crossed the archive's edge is
  refused `archived`, worded "not undone: restore or archive it on the
  board", and an undo that puts a task's card back on the board opens it
  (`revealOf`).
- **What the board shows is `boardView`'s**, over `boardOf` (`@pinetrie/rules`):
  the strip (each state's name, count, `markOf` and signals), each open state
  as a column of the cards the search keeps, the archive's
  `closedRows`, and `shown`, what the whole board shows (`BoardShown`: all,
  or filtered with the search, kept and total). A card's
  `moves` are its `⋯`'s Move to ▸, one per other state, with the busy reason
  into the archive; `up` and `down` its Move up and Move down within
  its state, among the cards shown (`stepsIn`, given a predicate, so the
  shown cards are always cut from the state's order), so the keyboard
  reaches every move a drag makes. Its words are worded beside it, one
  function each (`removeWords`, `rootsWords`, `keptWords`, `searchWords`,
  `stateWords`, `filterWords`, `filterTitle`).
- **One search filters every state in place** (ADR-0109, ADR-0115). What
  was typed and "mine" are parsed once (`parseSearch`) into a
  `BoardSearch`, or null for none: the one place an empty search is
  decided, which the filter, `closedRows`' cap, `shown` and Escape all
  read. `boardFilter` keeps every word in the label, "mine" being the roots
  `RootSummary.writers` holds you in. A state's roots are listed with their
  entries, filtered, and only the kept ones become cards, steps and all, so
  no card exists with placeholder moves. A state's head reads its `Count`
  (all, or kept of total) and its `signals`; the archive's
  `closedRows` are its kept cards newest first, and with no words (none, or
  "mine" alone) its `CLOSED_RECENT` newest.
- **A state's signals are counted by one function**, `stateSignals`
  (`StateSignals`: ◌, ⇡, and the roots whose readers show), over every root
  for the strip and over the shown roots for a column's head. The mark is
  `markOf` over every root in both, and Remove counts every root: a filter
  hides no warning and empties no state.
- **One landing rule for a root's drag** (`root-target.ts`), as
  `put-target.ts` is for a card's: `rootDropProps` marks a column, an item
  or the sidebar (`data-root-state`, `data-root-before`, `data-list-before`),
  `rootTargetOfElement` reads it, and `planRootDrop` gives the same intent
  the keyboard's moves send. A root's drag carries `ROOT_MIME`, never a
  card's; `App`'s card handlers ignore it, and `useRootDrag`'s ignore
  `CARD_MIME`.
- **A drag shows where it lands** (`use-root-drag.ts`). A board column,
  the archive and the sidebar are each a group of places
  (`rootGroupProps`), and anywhere in a group lands by the pointer's height
  alone (`landingIn`): before the first item whose centre is below it, or
  at the group's end. Landing by the element under the pointer instead
  made the gaps between items the column's end, and the line flickered
  between there and the gap as the pointer moved down a column. The place
  carries `data-root-drop`, drawn as a line in the gap; the item dragged
  carries `data-root-dragging`, set a tick after `dragstart` so the drag's
  image is not dimmed. The place just after the item dragged is its `home`
  (`placeAfter`), where a drop moves nothing (`planRootDrop`), so over the
  item itself no line is drawn. The archive is one target: its rows are a search, newest
  activity first, so no row is a place to drop before, and the panel is
  outlined instead. One drag start, `startRootDrag`, serves the board and
  the sidebar; its image is the whole item, held where the pointer took it
  (`setDragImage`). All of it is DOM attributes, never React state, as a
  column's drag is.
- **`markOf` is the one rule for a mark over several roots** (`attention.ts`):
  a board column's head, a strip state's and ▦'s (the roots not in the
  sidebar, `unlisted`).
- **Readers' avatars read presence themselves** (`root-signals.tsx`):
  `Readers` for the sidebar's items, the strip's states and each open
  column's head (`StateSignalMarks`, `board.tsx`), `ReaderMenus` (a
  menu of each reader's threads there, `peopleIn`) for a thread card, so a
  presence write redraws them and not `App` (S59).
- **The board is `#board`, absolutely placed in `#stage`** from its
  foot: it covers the columns and moves none of them.
- **A root is a thread card** (ADR-0111): `threadCardHeads` builds each
  root's header once in `App` (label, status, ⇡, your pip, its state and
  its Move to ▸ moves, with the busy reason and the offers a close
  withdraws), and `boardView` and `sidebarView` both read it from `heads`.
  A board card spreads its head and keeps it whole as `head`, adding Move
  up and Move down, its writers, and its body (`bodyOf`: its first line
  under a title that says something else); a sidebar item keeps it as
  `head`, adding Rename, Auto-update title and Not needed. A root whose
  directory record has not arrived has a head with no id and no moves.
- **A card dropped on a state, or in the sidebar, becomes a thread**
  (`spin-off.ts`): `PutTarget`'s `state` and `sidebar`, marked by
  `data-put-state` and `data-put-sidebar` beside the root's own marks, are
  planned by `planSpinOff`: the new root's, thread's and task's ids are
  `planIntent`'s `Minted`, and the card's move goes to your trash
  (ADR-0126), in the history of the new task (sidebar) or of the card's
  own task, else the task you are on.
  `afterSpinOff` places and shows a sidebar drop's root once the host has
  written its first message. A note's and your message's ⋯ offer the same
  per open state (`CardMoveTo`'s `thread`, the `spinOff` act).

## The canvas (`canvas-columns.ts`, ADR-0116)

- **Every card on a task's canvas is a column, in its order**
  (`canvasColumns`), the same for everyone: a thread's card a thread
  column, a note column a note column. A thread whose root this tab does
  not hold yet is left out until it is.
- **Your view of a task is `TaskView`**: each card's `CardView`
  (unfolded, density, details, and for a thread you opened what it starts
  with: `pending`, `prefill`, Start Agent), and the task column's fold. Maps and a flag, so the layout
  has nowhere to keep an order of its own. A task with no view is drawn
  with its first card alone unfolded (`defaultView`); a view action
  carries the canvas's first card to start one (`first`).
- **The strip is `[TaskColumn, ...CardColumn[]]`** (`stripOf`,
  `taskStrip`): the task column first by type, with no card's id, so no
  move, reorder or width can name it.
- **A branch is a card from the moment it opens** (ADR-0126): `→` asks the
  host to open its thread (`open-thread`, `planOpenBranch`), whose card
  lands just after the thread its fork is in (`branchAfter`,
  `@pinetrie/rules`), and unfolds it with what it starts with (`opened`).
  Its column appears as the card arrives.
- **Folded, a column is its card's face** (`foldedView`, ADR-0126): the
  same `Face` a grid's cell draws for that card (`faceOf`), worded for a
  strip by `foldedWords` (its title, and a note column's count), in its
  place; `projectColumns` lays the paths out over the unfolded thread
  columns alone (`openColumns`), so folding the trunk shows it in the next
  unfolded column. Going to a card unfolds it: `planOpen`'s `unfold`, a
  reveal of a note or a canvas place (`revealOf`), your new branch, a note
  column you made.
- **A column moves for everyone**: `moveColumn` is a reorder of its card
  on the canvas (`planColumnMove`), host-ordered and undone by the undo
  key; its width is the card's too (`cardWidth`, `columnMenu`).
- **A thread column's ⋯ copies and takes it** (`columnMenu`'s `thread`
  section, ADR-0127): `copyThread` (a `copy-thread` request at the
  source's end, `threadAnchor`, its id `Minted.thread`), `here` just after
  the source on its canvas (`taskOfCard`) or into your inventory, and
  `takeIntoInventory`. It lists no task: a thread reaches another task
  through your inventory. A thread's card put
  from your inventory lands on the canvas you are on after the column it
  was put on (`putOnCanvas`).
- **A thread not yet started** (a branch, a new tab, a copy before its
  first send) is a column of mode `unstarted` (`UnstartedMode`), from
  `unstartedThreads` (`@pinetrie/rules`): ending at its fork, or, a new
  tab's, at its root (anchor null), its next send a branch there
  (`branchesAt`). Shared as any card; it also closes (`isClosable`):
  `closeUnstarted` moves its card to your trash and your message there to
  your inventory (keep) or your trash, one move (`planCloseUnstarted`);
  a new tab's task, then empty, leaves the sidebar, and the host deletes it.
- **A thread whose parent thread is on no column of the canvas** carries
  `foldAbove`, its own thread: `projectColumns` folds the path above the
  first node in that thread into `ColumnView.above` when no column to its
  left shares any of it, and the column draws "↑ N earlier messages"
  (`earlierWords`). By thread, since each node carries its own
  (`TranscriptMessage.thread`): the thread's first entry is often a
  context entry, which is no node.
- **Gotcha: a thread's first entry is not always a message** (ADR-0125). A
  branch's first run writes its context entries (canvas, task cards,
  pinned cards, base news) above its prompt, in its own thread, and no
  column or rail row draws them. Read a thread's shape (its fork, whether
  it started) from `firstOf`; read what a person sees first from
  `firstMessageOf` (core), as `threadFace` and `taskRail`'s stubs do.
- **A thread not yet started in a thread someone else holds** is decided by
  `canvasColumns` from `holders` (`heldByOthers`): its `UnstartedMode.held`
  names that thread and who; `projectColumns` leaves the thread's entries
  out (`hide`), and the strip draws the column read only, "Bea has it".

## The column model (`columns.ts`)

A thread column is `{ key, anchor, thread, asksAgent?, foldAbove?,
density?, details?, mode }`, `mode` `bound` or `unstarted`
(`UnstartedMode`). Every column comes from its card on a canvas
(`canvasColumns`).

- **A column shows a thread** (ADR-0117): its anchor is its thread's end
  (`threadAnchor`: `threadEnd`, core, or before its first entry its lane's
  tip): a reply below its last message moves it on, and a branch, which
  starts another thread however new, never does. Its lane is the one named
  by its thread's id (`laneOf`), so there is no binding to do, and no
  newest leaf to follow.
- **A column opens its thread** (ADR-0126): the thread's id is minted with
  the column's key, the key being the thread (`newThreadId`,
  `@pinetrie/session`), and the host writes its record and card before any
  entry. Its first send is a branch at its fork, or a new root's first
  message; from then it follows its thread.
- **Every column's path ends at its anchor** in `projectColumns`: a
  thread's end (`threadAnchor`), or an unstarted thread's fork.
- **A null anchor** belongs only to an unstarted new root's thread: a new tab's.
- **An unstarted thread's column can carry a `Prefill`**, which its
  composer starts with, and a `pending` first message it sends as it opens
  ("branch here" after a conflict), both from your `CardView` (`opened`),
  spent by its first send (`sentFirst`). A blank prefill means nothing
  sent alone: a branch from agent work's `@agent ` (`branchPrefill`), which
  `sendable` (`send.ts`) will not send by itself. Anything else is content:
  an edit's text, which sent unchanged is a retry. A new tab can carry one
  too (an edit of a root's first message). The prefill is stored with the
  layout; `pending` is not, since it is sent on opening.
- **A column you open takes focus, once.** `→`, "Branch here" and ＋ open
  their column with a fresh key that `planIntent` arms (`armFocus`), and its
  composer focuses its box when it mounts (`takeFocus`, which `claimFocus`
  decides: the armed key focuses once, and nothing else does); `onFocus`
  puts the caret after the prefill. The key lives in a ref, never in the
  layout: a column restored on reload,
  or mounted again when its tab is shown, leaves focus where it is. The focus
  runs in an effect, after the strip's alignment, and scrolls a column opened
  past the strip's edge into view. The board's search is armed the same way,
  with `BOARD_SEARCH`, by a `board` intent a person sent (▦, a state's
  button: `focus: true`), and claimed as the field mounts in the strip. The
  board opening by itself with nothing to show (`pruneLayout`) sends no
  intent, so it takes no focus.
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
- **Deduplication is `planOpen`'s** (`layout.ts`, above).
- **Open columns are never written to the document.** Which paths a person
  reads is theirs. The page keeps them in the browser (Kept per tab,
  `packages/web/TECHNICAL.md`).

`projectColumns` shows each column only past the deepest message it shares
with ANY column to its left, so a shared stretch of paths is drawn once, in the
leftmost column that shows it. Anything looking for a message on screen (the
rail's scroll-to, the alignment) must search every column.

## Who is here, and your inbox (ADR-0030, ADR-0122, ADR-0091)

The footer (`footer.tsx`, `#bottom`) is you, then the rest of the session,
from live data; nothing in it opens a root until you choose. Its right end
leads with "syncing…" (`.sync-note`) while the document's status is
pending.

- **People:** `peopleHere` (`here.ts`) groups `readingAt` by
  person, in `writerOrder`. An end's task is its thread's (`threadAt`,
  `taskOfThread`), else the task its column reported (`readingTask`,
  `readReadingTasks`), so a person in a root this tab does not hold is
  shown, and opens it. "Never you" is `readingAt`'s rule, not repeated here.
  There is no group of people of its own (ADR-0122): a board item's readers
  are those people in its task (`peopleIn`), each avatar
  (`Avatar`) a `Menu` of the threads that person reads there
  (`ReaderMenus`); the sidebar's items and the strip's states show avatars
  only (`Readers`).
- **You** are first in the footer, under the sidebar (ADR-0098): your
  avatar and name, opening the account menu (`account-menu.tsx`), then
  your inbox and your inventory as icons. `accountView` (pure) decides the
  menu's items and the badge on your avatar: folded, the corner holds your
  avatar alone, carrying the inbox's badge, and the menu adds the inbox
  and the inventory; `accountWords` and `inventoryWords` word them.
- **Your inbox** (`inbox-view.ts`, pure, ADR-0091): what the threads you
  follow raise (`attentionOf`'s items) and your mentions, in one menu
  (`inbox-menu.tsx`). `inboxView` groups the items into sections (a verdict
  under its level, an offer under ready), so the inbox lists exactly what
  it counts; `inboxWords` words them. Its badge is `inboxCount`, given:
  `App` computes it once and the window's title shows the same number.
  `useInboxMenu` only turns each section's items into rows (`threadRow`,
  made once by `App` and shared with the board) and "not needed", for the
  corner's `InboxMenu` and, folded, the account menu alike. `kept` is the
  sections shown when the menu opened, set through `onToggle`, so an open
  menu keeps a section whose rows have gone and says so. The trigger is
  always drawn, quiet at zero. Its first section has a heading and no
  items: it names the menu, and its empty `.menu-section` is hidden, with
  no rule under it.
- **Where the agent works, and what is ready, is the board's** (ADR-0091,
  ADR-0116): `threadWork` (`app-view.ts`) is the agent's work in every
  thread: each busy held lane's (`laneWork`) and every lane running in the
  session (`running`); `taskWork` is each task's, the most of its threads'.
  `App` builds them once, and the sidebar, the board and `threadStatus` all
  read them, so a task rung on the board also refuses Move to Done there.
  `threadStatus` rings a thread while the agent works there or its verdict
  is pending, and `taskStatus` a task while any of its threads rings;
  `boardView` folds each column's items into `working` and `ready` counts
  beside `mark`, and an item's `ready` is its task's threads with an open
  offer (`offeredByTask`, each named by `threadNameOf`, so one the host has
  not named yet still counts). Nothing lists the runs.
- **The publish button and its toast** (`publish-view.ts`, `toast.tsx`,
  ADR-0090, ADR-0099): `publishView` decides the one button: `absent` with
  no record; `setup`, before setup on any host, whose `Menu` shows what it
  writes; `hidden` when
  `@pinetrie/rules`' `nothingToPublish` says so, the same function the host
  refuses by; else `publish`, carrying `acceptedActionState`. `publishWords`
  words it: "publish", or "publishing…" while out, and a title that says
  what it does from `publishWork` and the catch-up's preview (files it
  changes, other lines of your work that move), "the working copy does not
  move (publish.catchUp is off)" when the setting leaves the working copy behind or
  your commits unaccepted, then the jj, led by
  `acceptedRefusal` when the host would refuse (`PublishWords.refused`, the
  button's `data-refused`). The button still sends then: the
  host's refusal is the toast, so there is one path and one source of words.
  `publishToast` is accepted work's one place for a refusal or failure
  (`outcomeWords`), from the session's `acting` store, until dismissed or
  your next setup or publish command; `resolve` is set only by a refusal's
  `yours_conflict` code (`Unsuccessful.code`), and opens `resolveIntent`.
- **The inbox** (`inbox.ts`, pure): `mentionsOf` is every chat, from each
  root's directory record (`RootRecord.mentions`), whose mentions
  `address` resolves to your display name, never your own; `InboxItem` is one
  (core's `Mention` is a mention parsed from text). What you have seen is
  `{ since, seen }`: every mention at or before `since`, and the ids above it
  in `seen`. Marking compacts: `since` moves past a run of seen mentions, so
  `seen` holds only those above an unseen one.
- **`useInbox`** is its shell, over your attention document's
  `mentionsSince` and `seen` (ADR-0077), so what you have seen is seen on
  every device of yours. Until the document's first write it shows nothing
  unseen: the start (`startOf`, any root's newest entry, or `EARLIEST`) is
  written only once the directory has arrived, since from a partial one old
  mentions would count as new (S29). A mention on the paths of the tab you
  are on is seen (`seenOnScreen`), and the effect writes nothing when there
  is none.
- **Your attention document** is the session's (`SessionClient.attention`,
  `packages/session/TECHNICAL.md`): what you have dealt with, read and
  written through its `AttentionStore`.
- **"You" is your email** (ADR-0037). Your other tabs and devices are you, so
  they share your mentions; a mention resolves to your display name, so
  renaming yourself still changes which mentions are yours.
- **`Popover`** (`popover.tsx`) is a trigger and the box it opens. It wraps
  both in a span that gains `open` while open, which keeps `.open-more.open`
  visible; the box is `position: fixed` from the trigger's rect. Escape, a
  scroll of an element holding the trigger, a resize or a click elsewhere
  closes it. Escape is one document listener while open, taken with focus in
  the trigger or the box, or on nothing: live data can remove the item that
  held focus. `role` is `menu` or `dialog`: a dialog's box takes the role,
  and a menu's list does.
- **A trigger from live data is `gone`, not unmounted.** Unmounting a
  `Popover` takes its open box with it, so a change in the session would
  close a menu you opened. A thread card keeps a person who leaves while
  their menu is open (`withOpenMenus`, told by `onToggle`), `gone`, until
  you close it; the menu's heading says so (`readerHeading`). Escape closes
  that menu first: the board leaves Escape alone while a menu in it is open
  (`.open`), since both listen on the document and the board's listener,
  added first, hears it first.
- **`Menu`** (`menu.tsx`) is a `Popover` whose box is a `role="menu"` list,
  in sections (`MenuSection`): a thread card's readers, your inbox, the
  account menu, publish's setup, the sidebar's items' `⋯`, ＋'s menu and the
  composer's where line. A `lead` is drawn above the list, outside it (the
  account menu's who you are), and a change of `focusKey` while open gives
  the first item focus, as opening does (the account menu's swap to the
  inbox).
  The first section's heading is drawn above the list, not in it, since a
  menu holds only menu items, and names it (`aria-labelledby`); each later
  section is a `<fieldset>` (role `group`, which Biome asks for as the
  element) named by its own, which is drawn `aria-hidden`. A section's notes
  are text, not items, and describe it (`aria-describedby`): setting up's
  "pinetrie-accepted goes at your @-". Items can carry
  `data-*` attributes (`MenuItem.data`); one with `checked` is a
  `menuitemradio` with a ✓, and the arrow keys and the opening focus take
  both kinds.
- **`.initial` is the circle; `.avatar` is a person shown here.** The browser
  suite counts people by `.avatar`, and proves you are never among them by
  it. So your avatar in the corner and the account menu (`.me`) and the "+n" of `Avatars`
  (`.more`) are `.initial` and never `.avatar`.
  The circle's shape is `.initial`'s rule; `.avatar` has none. A person's
  picture (ADR-0098) is an `img` inside the same circle, so both rules hold
  with a picture or without. The sidebar's
  items and the board's hold readers' avatars too, so `.avatar` anywhere matches them,
  who never include you either.

## What needs you (`attention.ts`, `use-attention.ts`, ADR-0077)

- **`attentionOf` decides what is raised**, pure: a thread's verdict and its
  open offer, for its followers only (`follows`, over the directory's
  `RootRecord.threads`), while its lane is idle and its task not archived.
  A verdict clears when your read mark passes its `end`, an offer when it
  goes; either with "not needed" (`dismissed`, `dismissedOffers`). Nothing
  is raised before your attention document's `since` is set.
- **`levelOf` turns a verdict, a fact, into a level for you**: a stop is
  done for whoever stopped it. `LEVELS` orders the levels once; `highest`
  reads it.
- **`threadStatus`** is each thread's mark: working while the agent works
  there (`threadWork`, held by this tab or not) or its verdict is pending,
  else its highest item; **`taskStatus`** is each task's, its threads'
  together, working winning, through `taskOfThread` (ADR-0116). `markOf`
  folds it over several tasks: `unlisted` (`layout.ts`) gives ▦'s, as it
  gives `unsentSignals.elsewhere`.
- **Motion is a change you saw, never a state.** `arrivals` compares two
  statuses, and `useArrivals` takes the first status after the session has
  settled and your `since` is known as the baseline, so a load moves
  nothing. It keeps *when* each mark arrived, never a timer: a mark is
  keyed by that time and moves only as it mounts within `ARRIVAL_MS`
  (`moving`), and the ✓'s fade ends at no width. So the end of a motion
  redraws nothing. A timer that dropped arrivals redrew `App` while you
  typed, which the browser suite's render check caught.
- **One count** (`inboxCount`: the items that need you plus unseen mentions),
  computed once in `App`, is the inbox's badge and the window title's.
  `pageTitle` (`sidebar-view.ts`) puts it before the selected root's label.
- **Words:** `attentionWords` words each item's reason; a level is a
  signal (`signalOfLevel`, *Signals*), named by `signalWords`, and an
  inbox row's class is its signal. Selectors: `.signal[data-signal]`
  (`running`, `needs-you`, `worth-a-read`, `done`, with `data-arrived`),
  `.here-thread.raised`, `.not-needed`.

## The rail of a task (`taskRail`, `app-view.ts`, ADR-0116, ADR-0117)

A forest: one tree for each root a thread of the task is in, in canvas
order, each cut to the rows on a path to a task thread's end (`ends`: its
`threadAnchor`, a copy's fork). A child of a kept row in another thread
than the row's starts that thread (ADR-0125): not kept, it is a `RailStub`
with its `ThreadLink` (`railStubWords`), opening at the thread's
`firstMessageOf`. Each
tree's tracks are shifted (`shiftOf`) so the page's seed draws each in its
own root's palette (`trackSlot`; 7 is its own inverse in 12 slots): a
column takes its rows' track, so its colour agrees with no change of its own.

## Rail stretches (ADR-0031, ADR-0106)

The rail draws `compactRail(index, projectRail(...), keep, { asks, revisions })`:
a dot per landmark, and a capsule per stretch of three or more uneventful
messages. `projectRail` still returns a row per message, and everything
else reads those rows (tab summaries, archive search, `branchColors`).

- **`railLandmarks` (`rail.ts`) is the rule, and the columns read it too:**
  `railKeep` (`rail-view.ts`) is the view's part, rings, running tips,
  every open column's end, and every thread end holding a card of yours,
  whose dot carries its mark. A column's end is kept because an anchored column
  can end mid-stretch: inside one, half of it would be on the column's path,
  and where the column ends would not show. So a stretch is all on an open
  path or all off it, and `data-open` on its first message speaks for it.
  The columns fold around `columnLandmarks`, the same set but for the
  rings: a ring is a thread end, which on a column's path is its own end,
  and leaving presence out keeps a presence write from redrawing every
  column (S59).
- **A long ask is a dot and a capsule of its own** (ADR-0106): the prompt of
  an ask whose run holds `LONG_ASK` agent messages is a landmark, and a
  stretch never crosses its work's edge. Short exchanges merge as before,
  into a capsule when its span is fewer rows than its dots (`compactRail`'s
  `spanOf`, the page's `stretchSpan`: three messages or more). `LONG_ASK`
  is core's and the host's, since a long ask is digested; the span is the
  client's (ADR-0093).
  The stretch carries its ask (`RailStretch.ask`), and its tooltip is
  `stretchWords`: `askWords`, `workWords`, then the ask's digest as
  `digestText` words it (ADR-0075).
- **Every item has `slot`, `span`, `ids`, `track` and `across`;** a dot is
  an item with one id and a span of 1. An edge leaves its parent item's last
  slot, so the renderer never asks which kind an item is, only how to draw
  it.
- **Rows are depths, places are booked (`placeRail`, ADR-0068):** an item's
  slot is its parent item's `slot + span`, so a branch starts beside the
  older subtree, and each branch takes the leftmost `across` free from its
  fork's row to its last. A branch is a thread: a child in its parent row's
  thread continues its track, any other begins one (ADR-0125). `track` is
  the branch's colour, by creation order (`projectRail`), and never the
  place: `data-track` on a dot, a capsule,
  an outline or a tick is the colour the column shares. Places come after
  compaction, so a ring that splits a capsule can move the rows and places
  below it; colours never move. Items stay in depth-first order, the DOM's
  and Tab's too, so they no longer run top to bottom: a branch's dots follow
  its parent's whole subtree. The SVG is as tall as the lowest item, which
  need not be the last.
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
- **A task's rail before its first message (a new tab's) is `EmptyRail`:** a `.rail-start`, not a `.rail-dot`, so
  `railCount` never counts it. The rail's `min-width` is wider than one
  track, in both, so the columns keep their place; the browser suite checks `#strip`'s left edge
  across that send. `.rail-tree` is `fit-content` and centred, and the SVG is
  `PAD` wide on both sides of its outermost places.
- **A capsule's background depends on its fill** (the panel's colour, the
  track's, or the two blended half and half), so a colour check reads a `.rail-dot`. Signals (`.pulse`, `[data-here]`, a `.signal[data-signal="unsent"]`) are always on dots.

## Asks, densities and folds (ADR-0106)

An ask is a message that started a run, with that run (`indexAsks`, core,
kept per index). `readSessionFacts` reads it with the index, so the rail and
the columns read one. `segmentPath` (`ask-segments.ts`) decides what a column folds;
`columnRows` (`ask-view.ts`) groups each ask's segments, `planAskWork`
(`ask-fold.ts`) decides what one ask's work draws, and `AskWork`
(`ask-work.tsx`) lays that out.

- **`AskWork` is `ToolRow`'s twin.** `foldOpen` (`ask-fold.ts`, called in
  `planAskWork`) is the rule, as `rowView` is; the reader's choice is kept in a `FoldMemory` by
  the ask's prompt, made once in `App`, as tool rows' `RowMemory.open` is. Each `AskWork`
  reads its own key with `useSyncExternalStore`, so opening one redraws it
  alone and `MessageList` gets no new prop. Its messages are drawn only
  while open: a closed fold creates none of their elements (S59).
- **An ask is one row, even with a message steered into its run.** A
  base's news (ADR-0080) is written mid-run, and no run wrote it, so it is
  in no `askOf`. `indexAsks` (core) records it in `steered`, and `runOf`
  reads both: `columnRows` draws it in the ask's row and `compactRail` in
  its capsule. Read apart, it split the ask in two, and outline drew its
  line and digest twice.
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
  change. Whether its thread's details are open (`Column.details`,
  ADR-0073) is kept the same way.
- **Both are `ReaderAction`s, by the column's key** (`readerAction`,
  `intent.ts`), as `sent` is: `planColumn` sends them
  through `onColumn`, as your view of the column's card.
- **`workWords` counts what the work's records say** (`statsOf`): the
  files its turns changed, the ignored files they wrote ("3 ignored
  files", each record's topmost and how many more, ADR-0131), and
  "dependencies failed to install" when a turn's recipe failed, after the
  failed calls.
- **What `askView` decides:** what its work holds (`work`, `workWords`
  over `askStats`), the outcome's words, the live line while it runs, the
  last word outline hides (none in the column's last ended ask,
  `lastEndedAsk`, ADR-0106), its digest's headline and, once final, its
  points (ADR-0075), and how many files a review of it shows: none when
  it has no span (`askSpan`), so its fold offers no review. The pane
  reads the span itself (`askReviewTarget`, `packages/web/pane.ts`).
  `askWords` says an ask the same everywhere: the bar, the working mark's
  title, the rail's tooltip, outline, a search's match. `askLine` reads the
  ask's prompt from the index and words it so, for the rail, the column and
  a match.
- **An ask's summary is said once** (`planAskWork`). Its summary
  (`foldWords`: what its work holds, how it ended, and in story its
  headline, a model's marked as one) is built once and given to one place,
  `SummaryAt`: outline's line, the head of its first fold, or nowhere when
  it has no fold, which then draws an `.ask-outcome`. Every other fold
  head's words are its step count, made in the same helper. Worded apart,
  an opened outline ask said its work on its line and its first fold.
- **Every row carries its finished words** (`AskDraw`): fold heads, the
  digest's headline and points, the outcome, and the files label. `AskWork`
  reads only `view.ask` and `view.running`, and a test reads the plan as a
  reader would (`ask-fold.test.ts`, "the summary is said once").
  **Gotcha:** words go into a row only in `planAskWork`. A row that took
  them from `AskView` in the shell would bring the duplicate back, unseen
  by that test.
- **The digest goes where the summary does not carry its headline:** whole
  in `.ask-digest`, headline above points, in outline (open or closed: the
  line is cut to one line, and while the run lasts it says what the run
  does now) and with no fold; else the headline leads the first fold's head
  and the points, one `MessageText` over `pointsText`, are under it. A
  digest with neither is no row.
- **The first fold is `Segment.first`, not the first fold in `parts`:**
  `segmentPath` sets it across the path, so an ask drawn as two rows would
  still give its summary and its files to one fold.
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
- **Since you were here** (`left.ts`, ADR-0077): your attention document's
  `read`, per lane the furthest entry you have read, on any device of yours.
  A column bound to a lane reports its tip while it follows its end in a
  page you can see (`AttentionStore.read`), and `seen.leave` flushes every
  waiting mark on unmount, page hide and `pagehide`. `readStep` writes a
  lane's mark at most once a `READ_EVERY`, since each write stays in the
  document's history (S101). A column reads the mark as it mounts and when
  the page shows again, so the line stays where it was while you read below
  it, and `.left-line` takes no height.
- **Selectors:** `.column[data-density]`, `.density-choice[data-density]`
  (`aria-pressed`), `.ask-work[data-ask-of]`, `.ask-fold` (`aria-expanded`,
  `data-first`), `.ask-files`, `.ask-line` (`.running`), `.ask-headline`, `.ask-digest`,
  `.ask-outcome`, `.ask-bar` (`data-ask`, `data-where`), `.left-line`.
  The browser suite reads finished work raw (`readRaw`).

## Search (`search.ts`, `search-view.ts`, ADR-0101)

A search covers the task you are on: `searchCorpus` over its rail's rows
(`taskRail`), every message's text as `messageAt` gives it, then
`searchTexts` with a parsed query. `App` holds the `SearchState` (never
stored), and `searchOn` applies it only on the task it was opened on.

- **A match starts at a word's start; the last word may run on.** The
  results update as you type, so the last word may be half typed: "colum"
  finds "column". `queryPattern` puts `(?<![\p{L}\p{N}\p{M}_])` before the
  first word when it starts with a word character (so `@ada` matches too),
  joins the words with `\s+`, so each word but the last is whole, and lets a
  last word ending in a word character run on with `[\p{L}\p{N}\p{M}_]*`,
  so the match, and what the snippet marks, is the whole word. Not `\b`:
  in JavaScript it knows only ASCII word characters, and would find "rail"
  in "éraile". `-` is not a word character, unlike in a handle
  (`HANDLE_CHARS`, core), so "rail" finds "rail-view". The flags are `giu`.
- **The query is composed (NFC), the text is not.** Composing the text would
  move the ranges a snippet cuts by; text typed in a browser is NFC already.
- **Unlike the board's label search, on purpose.** The board keeps any label
  holding every word typed, anywhere in it and in any order (`board-view.ts`),
  which suits short labels. This finds a phrase in prose, from a word's
  start, so "rail" never finds "trail". Neither should be made to match the
  other.
- **Built only while searching.** `App` builds no corpus while the bar is
  closed, and searches the deferred query (`useDeferredValue`).
- **One match is one message**, however often the phrase is in it, and it
  belongs to the column that draws it (`ColumnView.nodes`), so none is drawn
  twice. `columnMatches` gives its rows in path order, which is time order,
  with a gap row for each run of messages left out. `searchLine` counts the
  hits no column draws by `App`'s `shown`.
- **The rail marks whole items** (`RailMarks.matches`, `itemMatches`): a
  count, 0 to dim, null while not searching. Matches are no landmarks, so a
  keystroke never moves a capsule.
- **Showing something new leaves the search** (`leavingSearch`, `intent.ts`),
  as `leavingPage` leaves a page (ADR-0098): a plan that reveals a message,
  opens or unfolds a column, or shows another task, a new tab or the board gets the
  search's close first and, for a revealed message, `landed` last, which
  outlines it. Every way of showing a message is a plan, so a match row
  sends plain `openAt`. The `landed` effect is not `mark`: that name is a
  title's mark on a task.
- **`open` names no task in an intent** (`SearchAsk`): `searchActOn` gives it
  the task you are on, so `keyAct` needs none.
- **Keys** (`page-keys.ts`): `/` outside a text box opens it, unless
  `Focus.search` is `"unavailable"`; Escape closes it when `"focused"`,
  checked before the text box's guard, so Escape in the field is this rule
  too.

## A message's tools (`message-tools.ts`, ADR-0043)

`messageTools` decides which tools a message offers, and `Message` draws
them in one row: *copy*, *comment*, *edit* or *new tab*, `→`. Nothing is
taken from the past (ADR-0132): a copy goes to the clipboard, and *Copy,
cut and paste* below is the rest.

- **Copy is the message as markdown** (`copyText`, `copy-text.ts`): its
  text as stored, not as drawn (mentions, a `/command` and
  `![name](/blob/…)` as written), then each tool call, its tool's word and
  all it touched in code (`callLabel(call, "whole")`), and its whole result
  fenced, past the 20,000 characters a row shows.
  A fence or code span is longer than any run of backticks inside it. A
  result's images, a `write`'s content and an `edit`'s change are not in
  the view, so they are not copied. It only reads, so a column that can't
  be written offers it too, alone.
- **What the past copies as** (ADR-0126, ADR-0132): `messageReference`
  names the whole message, or the block named (a table's bar, an image);
  `selectionReference` names a selection when its text is in the message's
  text as written, a range of it, and is null otherwise: a selection across
  formatting draws text that is not its markdown. Their markdown is
  `markdownOf`'s (an entry's is `copyText`, a block's and a range's their
  slices, `pastMarkdown`), so what the clipboard says and a reference's
  quote agree. `clipOfFocus` (`clip.ts`) reads them.
- **Edit as text** (`planEditAsText`) is a paste (ADR-0132, ADR-0133): a
  text card of the quote replacing the reference, in its very place and
  slot, its `origin` the address, the reference to the trash first, so a
  full inventory takes it too.
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

## Margins and comments (`margin.ts`, ADR-0126)

An entry's margin holds comments: notes on it, read by everyone on the
task and never by the agent. A comment is a text card at a `margin` place,
which names the entry and its thread (`packages/rules/TECHNICAL.md`,
*Cards*).

- **A message's *comment*** (`messageTools`' `comment`, where the column
  can be written) is the `comment` act: `planComment` makes an empty note
  at the margin's end, and the column opens that margin and focuses the
  new box once it is drawn.
- **Shut, a margin is a face**: its count under the entry
  (`marginFaceWords`, `MarginFace`), from `marginCounts` over the cards.
  Open (one per column, the column's state), its comments are drawn normal
  under the entry (`DETAIL_ON.margin`), each a `NoteCardEditor`, with
  *+ comment* and *shut*. The list carries the open margin as a slot
  (`marginSlot`), so opening it rebuilds the list once and typing in it
  rebuilds nothing.
- **A comment's ⋯ has *Queue a reference*** (`queueReference`): a
  reference to it (`{ kind: "card" }`) queued on its thread. Its quote is
  the comment's text as it is then, under a link to its entry
  (`commentMarkdown`), kept as a blob (`queueComment`, `perform`). The
  agent reads the quote, and the entry under the link (the host's
  `linkedQuotes`), so it reads the comment under what it is about. The
  comment stays where it is.
- **A queued reference is framed as a queued message** (`QueuedReference`,
  `dock.tsx`): who queued it, its place in line, ↑ ↓, its quote as the
  body, read only, and ⋯ and ×. Its ⋯ offers what its kind may do
  (`cardFrame` keeps a Move to ▸ item only where `PLACES_OF` puts the kind,
  `MOVE_PLACES`): back to the notes and into your inventory, never pinned.
  Unqueue and discard plan for any kind that may be queued or discarded
  (`isQueuedMessage`, `cardFitsPlace(card, "trash")`).
- **Entries by keys** (`onEntryKey`, `Column`): while focus is in a
  column's messages and in no text box, they are a grid one cell wide,
  read by `gridKeyAct` (`comments: true`): `j` and `k` select (a click
  selects too), Enter opens or shuts the selected entry's margin, Escape
  shuts it, `c` comments, and Cmd+C with nothing selected in the text
  takes a reference to the selected entry. The selection is the column's
  view state, marked `data-selected` on its message.

## What a column shows (`column-view.ts`, ADR-0040)

`Column` gathers the facts (`ColumnFacts`), `columnView` decides, and
`Column` draws what it returns: who works in the column (`identity`), where
it forks (`origin`), where lanes start on its path (`joins`), and what
became of its files (`strip`, a row of the column's header, ADR-0113).
What the thread does next is the dock's (`nextOf`, *Threads, lanes and the
composer*).

- **`lanesAlong` is the one model of which lane worked where.** It walks the
  column's whole path, root first, and starts a stretch at each asked message
  whose lane differs from the one before. The header's start, the dividers
  and the origin's speaker are all read from its stretches.
- **An asked message's lane is its revision record's, which the host writes
  when the turn ends** (`turnDone`). A message with no record yet is the
  column's lane's running prompt, so it falls back to the column's lane.
  With no revisions at all (a host without a project), every asked message
  falls back, and the whole path reads as the column's lane.
- **What a catch-up merges is worded by `catchUpName` alone**
  (`@pinetrie/rules`, ADR-0061, ADR-0072, ADR-0090, ADR-0100): accepted
  work is "accepted work", a WIP its bookmark, the thread a thread branched from its name. The words
  take core's `CatchUpFrom`, never a bookmark string, and accepted work's
  bookmark goes only in titles: `offerWords`' button titles ("moves
  pinetrie-accepted forward to pinetrie-offer/amber-fox"), `behindMark`'s,
  `baseChoices`'. A card's command is worded from `CatchUps` (the thread's
  base and its parent), which `Column` keeps as one object while it says
  the same, since the composer is memoised. A base that moved is worded by
  `baseMovedOn` beside it ("accepted work has moved on"), never as "has new
  work".
- **The thread a thread branched from** (`parentNow`, ADR-0072) is read
  from the column's tree, the revisions and each lane's thread end, with no
  read of your repo, once per `columnView` (`ColumnShows.parent`): the
  strip's `offerView` takes it with whether its lane runs, and `Column`
  words the composer's commands from it. A conflicted offer whose conflict came with its copy says
  "began from a copy with an unresolved conflict in N files", adding "·
  \<parent\> has resolved it" with "catch up with \<parent\>" as its button
  when the parent holds those files resolved; every other conflicted offer's
  button is "catch up with \<base\> and resolve". The parent's catch-up,
  quiet while it runs, is titled why.
- **A branch from a conflicted copy is warned** (`forkWords`, ADR-0072): a
  column whose next send creates a lane of its own, at a commit whose
  records carry conflicts (`conflictsAt` of `nearestRevision`'s commit),
  shows `.where-fork-conflict` under the where line.
- **An acceptance names the offer this tab shows** (ADR-0065): `SessionClient.offer`
  reads the lane's record from its session document as it sends, the one
  the strip was drawn from, and sends `offerSeen` of it (its ledger, and
  whether it conflicted). The host refuses the acceptance `offer_changed` when the
  offer now brings other work.
- **Your offer and setup and publish commands are tracked per tab** (`acting.ts`,
  `@pinetrie/session`): `SessionClient.offer` and `.line` mark the command
  `sent` at once and record the answer when it comes. A refusal or failure
  stays until your next command on that lane (or accepted work); an answer that
  carried it out (`accepted`, `offered`, a split's `started`, `line-moved`)
  clears it, since the record then says how things stand. Each send has an
  id, so the answer to a send since replaced changes nothing. The page's
  `offer` effect (`perform.ts`) only calls the session. `columnView` takes
  the lane's entry as `ColumnFacts.acting`: the strip's `waiting` disables
  its buttons and menu rows while it is `sent`, and `offerWords` words it
  as the strip's `note` (`.offer-note`, `role="status"`, `data-acting`
  `sent` or `said`). An acceptance in flight names a WIP destination
  ("accepting into wip/search…"); a refusal or failure is `outcomeWords`,
  shared with the publish toast.
- **`offerView` (`@pinetrie/rules`) decides an offer; `offerWords`
  words it**: its line and each button's label and title, by state. An
  offer that conflicts says so even when it is `edited` (S73), and its
  accept button reads "accept anyway" whatever the state, as it does when
  a resolution asked for you. Each accept button names a WIP the work
  goes into (ADR-0104, ADR-0083, ADR-0090): "accept", "accept into
  wip/search", and, from a WIP thread's menu, "accept, with your 2 commits
  beneath it". A conflicted offer on the
  line offers "resolve in the thread", never an acceptance into it. The bookmark is
  a fact of its own, drawn apart (`.offer-bookmark`), never in the line.
  `workStrip` hands `offerView` the record decoded (`offerStatus`): a `held`
  offer says "nothing to accept: accepted work already has this thread's
  work",
  and has no review.
- **What catching up would do** (`catchUpOf`, from `pinetrie.base`'s `start`
  and `catchUp` against `pinetrie.accepted`'s commits, S97): when it `brings`
  files, the strip's line adds "· accepted work has moved on", or is that
  alone with nothing to accept, catching up moves from the `⋯` menu to the
  buttons, its title counts the files, and the header shows `behindMark`'s
  ↓, titled with the count and the move (the bookmark, and the commits it
  went from and to). When it would change nothing (`current`, or
  `nothing-new`: the base moved by the thread's own work), it stays in the
  menu, quiet: `LabelledButton.disabled`, with the reason as its title, and
  `column.tsx` disables it. Until the host has read the move (`unknown`), it
  stays in the menu, enabled, and claims nothing. So does a lane with no
  base record at all: the host has never read it. An untraced thread
  (`pinetrie.base`'s `untraced`) says "an earlier accept of this thread
  can't be traced: catch up with accepted work to offer what's new", with catching up
  beside it. `ColumnFacts.queuedCommands` are the commands of the cards
  queued on the lane: a catch-up among them is `offerView`'s `catch-up`
  activity ("catching up with accepted work…"); a split only quiets the
  split button (ADR-0080).
- **A thread's base** shows in its header only when it is not accepted work
  (`baseWords`): "on wip/search", or "wip/search is gone", when the menu's
  update becomes "continue from accepted work" and no acceptance is
  offered.
  Catching up says its base: "catch up with wip/search". Two known limits,
  both in words only:
  - until a lane has a base record, the page names accepted work as its base
    (`effectiveBase(null)`), so a WIP thread that never changed a file says
    "catch up with accepted work". The host merges the WIP, read from the
    lane's own history;
  - with no line set up, `catchUpOf` is `current`, so the menu says
    "already caught up with accepted work" where it is not set up.
    The host refuses the catch-up (`no_line`).
- **The footer's publish button** (`PublishButton`, `footer.tsx`,
  ADR-0090): a plain button for a publish, a one-section `Menu` for setting
  up (the config text it writes: `immutable_heads()` and `revsets.log`),
  disabled while a setup or publish is out. A refusal or failure is a `Toast`
  above the footer, which keeps the `acting` entry you dismissed so the
  same one does not come back. It offers nothing: a conflict in the
  working copy is the person's, in jj (ADR-0102).
- **The origin row and the details' "where it started" are `openAt`
  intents** (`planOpen`), which reveal the entry in whichever column shows
  it. A column's lane may have started in a column to its left.
- **A named thread's details (ADR-0073) are `ThreadDetails`**, built by
  `detailsOf` and carried in `HeadIdentity`'s agent variant, so a pending or
  absent identity cannot have any, by type. The name is their toggle
  (`aria-expanded`); its chevron is `::after`, so `.agent-name`'s text stays
  `✦ name`, which the browser suite reads. The panel is drawn after the
  header, outside it: no drag handle (`NOT_A_HANDLE` needs `.column-head`),
  and its text can be selected.
  - **`start` is null at the path's first message,** where the reveal
    would only scroll to the top. It is the first exactly when its parent is
    null or missing from the index, which is where `ancestry` stops: one
    lookup, no second walk.
  - **The panel draws `ThreadMark` itself,** scaled by CSS, so the star,
    the banner, its fade and its blend are one component's. The spin is on
    the button around it: `.thread-mark` animates `transform` while the lane
    runs, and a spin on the same element would replace the pulse. A spin
    restarts by changing the animation's name (`data-spin` odd or even), not
    by a key, which would draw the mark again and fade a new banner in again.
  - **It spins only when opened here.** `Column` keeps `openedHere`, set by
    the opening click; details mounted open, by a reload or a tab switch,
    are still, as `mountedBanner` keeps a banner there at mount from fading.
  - **Toggling dispatches no `PLACED`**, unlike density: it changes the
    view's height, not the content's, and `useFollow` follows that.
- **The banner (ADR-0050, ADR-0053) is the thread's at the column's end**
  (`banner`): the lane's `pinetrie.banner`, none for a conversation. It takes
  the star's place before the name (`ThreadMark`): a fixed 1.5rem square,
  the head row's height, holding the star, with the image laid over it
  absolutely, so its arrival moves nothing. The star stays in the text
  (`✦ name`), hidden under an image. A new one fades in once loaded, the
  star fading out; the one there as the column mounts shows at once, or
  every tab switch would fade it in again: `Column` keeps the banner's URL
  as it mounted (`bannerUrl`), and `columnView` decides `fade` from it.
  `isolation: isolate` makes the
  header's own background what `mix-blend-mode: lighten` blends with: the
  sprite's black ground becomes the header's colour. The mark's rules are
  `.thread-mark`'s, not the header's, since the details draw it too, with
  `isolation` of their own; only its pulse is scoped to where it is. The header has no `overflow: hidden`: on a flex item that
  removes its minimum height, and a tall column squeezed the header.
- **`onCreatesLane`:** the composer tells the column, in an effect, whether its
  next send would create a lane, so the header can say `✦ new agent`. It is a
  boolean, not the text lifted up: `Column` redraws only when it flips, not
  on every keystroke.
- **A thread about to get its lane is named before the send** (ADR-0057).
  `headLane` is the lane the header names and draws the banner of: the
  thread's, or, while `createsLane`, the one its next send creates, named by
  the thread's id. `columnView` decides the `reserve` step: `ask` the host to
  name it while it has no name, else `none`. `Column` carries it out in an
  effect keyed on the step. Asking again (a remount, StrictMode) is harmless:
  the host does nothing for an id it has named. A conversation's thread is
  named by the host as its first message is recorded (ADR-0117), with no
  banner.

- **The agent can reply in several threads at once**: `readAgentActivity`
  returns every running lane. The rail pulses at each tip, and each column
  streams the runs whose tip is on its path.
- **The composer decides before sending, as the host will.** The column's
  thread names its lane (`laneOf`), over `readLanes` and `readParticipants`,
  the reads the host decides from; its end is the column's anchor. `planSend` (`send.ts`)
  decides the rest: who the message is for is `addressChat`
  (`@pinetrie/rules`), the function `planChat` runs on the host, so the
  button cannot promise a reply the host will not start. `SendPlan.to` is
  `addressChat`'s `Address`, unchanged. An unstarted thread's column sends `branch`; a
  send to a busy lane (`isBusy`), plain or asking the agent, and a card
  with a command, queue: the editor queues the card itself (the `queue`
  act), and sends nothing: `SendPlan.mode` is a `ComposerMode`, whose `queue`
  is the client's and never reaches the wire. A send the host finds busy,
  where the page thought the lane idle, the host queues in the same step,
  and answers `queued` (ADR-0059).
  `sendButton` words the plan (labels: `docs/06-interface.md`), and
  `placeholderWords` gives the box's placeholder: the composer holds only its
  state and draws.
- **Every send from a column carries its `ColumnHow`**: its thread, whether
  it is a Start Agent column, and an unstarted thread's root, built once by
  `Column` for its composer and for everyone else's cards at its end, since
  sending any of them here creates this column's lane.
- **The queue names who queued the last card,** not who the agent is
  answering: the host pops queued cards in order, so a new one waits behind
  the last (`LaneView.lastWaiting`). `queuePlace`
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
  error's message. The card keeps its text (`spent` is false), as for a
  refusal, but `failedWords` never says "not sent": the host may have written
  the message before it failed. The profile page words a failed rename with
  the same function, through `renameProblem` (`identity.ts`).
- **Queued cards** (ADR-0048) are drawn in the column's dock, above the
  line, in the order the host pops them (`queuedOn`), each a
  `QueuedCardEditor`: always bound, editable by anyone here, in its frame
  (*Card frames*, below). They are not in the tree yet, and leave the
  scrolling body alone: queueing a card changes no height `useFollow`
  measures. Below the line, the composer shows your message alone
  (`yourCard`, ADR-0113), and the notes are in note columns (ADR-0116): an
  unqueued card is a note, so it never takes your composer.
- **A queue sends the text's version too** (`seen`, `textVersion`), in the
  queued key, and so does a chat sent from a card (`SentCard`), which the
  host queues when the lane is busy: the host pops the card only once it
  holds that much of the text, since the request can reach it first (S96).
- **Queue, unqueue and a command are requests to the host, outside the
  card's own undo** (`moveCard`, and `request` with `set-command`): a
  card's box undoes only its text (ADR-0052). A queue and an unqueue are
  moves, so the host records them in the root's history of your moves, and
  the page undoes them, not a box (ADR-0066). An unqueue the host's pop got
  to first is refused `gone` (S69, ADR-0059); `session.moves` holds the
  refusal, read by the column through `useSyncExternalStore`, until your
  next send, queue or unqueue in its lane, and the column says "already
  sent".
- **A card the host could not send** carries `unsent` until it is queued
  again; its frame's header says it (`cardFrame`'s `unsent` state).
- **What happens next is `nextOf`** (`next.ts`, ADR-0113), read from the
  host's own rules so the dock and the host cannot disagree: running; else
  held (with the card a release sends first, `planNextQueuedCardPop` with
  no hold, and whether the turn may also carry on, `carryOnState`); else
  the pop the drain would make now (`sending`, or waiting on typing), a
  blank message passed over (`blankQueued`, read from the page's texts by
  `useBlankQueued`, the rule the host's drain and `readLanes` use); else stopped (who, from its stop's fact, `stopperOf`); else idle.
  `queueHead` adds the lane, the holder and the message cards queued, and
  `queueHeadPlan` decides the one button (stop, send queue, resume), the
  ⋯ items (resume, hold, release, unqueue all) and where ▸ sits.
  `nextWords`, `nextButtonWords` and `nextItemWords` word them. The dock
  computes it, not `columnView`: it needs presence's typing (S59). Each
  button and item is a `ColumnAct` (`holdQueue`, `unqueueAll`) or a
  request (`stop`, `carry-on`).
- **Every queue is a `queueCard` effect** (ADR-0113): the `queue` act and
  `queueNew` carry what the queue does to its hold, and the session sends
  one `queue-card` request. `queueNew` makes the card in the queue
  (`queueNew` in `card-intents.ts`, a move with no `from`) with its
  command: a command button's (`keep`) and "+ add to queue"'s
  (`hold-if-idle`). Neither is made as a note first, which would draw it
  in a note column until the queue's move landed. `planSend` decides the hold: on
  an idle lane whose queue is held, `release`, and the queue place is
  `releases`, which `queueWords` words "send all (n)"; else `keep`.
- **A discard is a move to your trash** (ADR-0111, ADR-0126): the
  `discard` act (a card's ×, or Ctrl+Shift+Backspace in its box,
  `cardKeyAct`) and the inventory's `discard` intent plan `planDiscard`:
  `DISCARDED`, which names no task. The host names its history (ADR-0066,
  ADR-0116): the task the card leaves, or for a card in your inventory the
  task you are on, which the move carries (`here`, `taskOfTab`), or on
  none your history outside any task, so the undo key there brings it
  back. The close ask's discard is the same move, with the thread's card. The session keeps your accepted discard as a notice where you made
  it (`CardNotice`, `noticeWords`), as it keeps a refusal.
- **A queued or pinned card moves one place** with its ↑ and ↓
  (`ReorderButtons`) or Alt+↑/↓ in its box (`card-keys.ts`, `cardKeyAct`).
  Both are the `reorder` act, carrying the card's list as drawn, by id;
  `planIntent` finds the new neighbours with `reorderOf` (`card-intents.ts`),
  which gives nothing at an edge or past a fact, and the session tracks the
  reorder as a move (`reorderCard`). Only those two editors take Alt+↑/↓:
  on a Mac it is Option+↑/↓, a textarea's move to its paragraph's start or
  end, which the composer and notes keep. A queued card's editor
  is keyed by its card, so a reorder moves the element, and its box keeps
  focus and caret. There is no drop target for a reorder: put could not
  reach it (`put-target.test.ts`).
- **Each keystroke says which card it is in** (`onTyping(card)`, through
  every editor to `App`): presence `typingIn`, which the host reads to pop
  no card someone types in. `typingDue` writes at most once a second, and
  at once in another card.

## Pasting an image (`paste.ts`, ADR-0042)

- **A paste with image files is an upload.** `pastedFiles` keeps the
  `image/*` files; with none, the paste is the browser's own. With some, the
  composer prevents the default, records the selection, and `POST`s each
  file to `/blob` (`uploadImage`, `upload.ts`, same origin, so the key
  cookie goes too; a reference's quote is kept the same way, `uploadText`).
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

## A person's picture (`picture-crop.ts`, ADR-0098)

- **The crop is a value** (`Crop`: a zoom and the square's centre, in the
  image's pixels). `fitCrop` starts with the largest centred square;
  `moveCrop` turns a drag over the preview into image pixels, the square
  moving against the pointer; `zoomCrop` keeps the centre; `cropSource` is
  what `drawImage` reads. Every step goes through one clamp, which keeps the
  zoom in [1, `MOST_ZOOM`] and the square inside the image.
- **The browser sends `PICTURE_SIZE`** (256): the host fits anything larger
  than `PICTURE_MOST` (512, `@pinetrie/rules`), so a picture from any client
  is drawn from at most 512 pixels.
- **Its words are `pictureWords`**, and the host's answer's
  `pictureProblem`, which reads a refusal or a failure as a rename's does.

## Commands in the composer (ADR-0036)

- **Completion** (`commands.ts`, `matchCommands`): while the text is a `/`
  and a first word, the commands whose name has every typed part in some
  part of it are offered. Those whose own name starts with what was typed
  come first. The list is `pinetrie.commands`, read with `readCommands`.
- **Keys:** arrows move, Tab or Enter chooses (inserting the full name and a
  space), Escape hides the list for that text. Enter sends only when the
  list is closed.
- **A command is for the agent:** the send button says so, as the host
  decides.
- **A sent command** shows its name as a label beside its speaker (`node.command`).

## Presence (ADR-0024)

- **Presence's verb is *reading*** (ADR-0077): a person is reading a thread
  now. A person *follows* a thread they have written on (`follows`,
  `attention.ts`), and a column *follows its end* (`follow.ts`), a column's
  verb, never a person's. Docs and comments keep to these; no word a person
  sees says that someone follows a thread they are only reading.
- **Every column of the tab you are on is reported** (ADR-0029), since there
  is no focused column: `App` writes each column's thread end when it changes,
  deletes the key of a column no longer reported (`planReading`,
  `presence-report.ts`, decides both), and refreshes all of them
  every 10 s while `document.visibilityState` is `visible` (a
  `visibilitychange` listener refreshes on return). Switching roots therefore
  clears the last root's keys, through that same deletion. On nothing, a
  page reports nothing. Typing is written at most once a second (`typingDue`).
- **A task's avatars in the sidebar** are `readersByTask(peopleHere(…))`
  (`here.ts`): the header's people turned around, each item's `Readers`
  taking its task's.
- **`core/presence.ts` decides everything shown**, from one field's read
  (`readReading` and `readTyping` in `@pinetrie/reads`) and the
  tree: rings (`readingAt`), a header's avatars (`seenBy`, others whose
  thread end lies on one path with this column's), and who is typing
  (`whoIsAt`). Each leaves you out, and shows a person once however
  many seats report them (ADR-0037). Which component reads which field is
  under Renders.
- **A person's colour** (`presenceColors`): the first three people, in the
  order they first wrote (`writerOrder`, the same in every window), get
  magenta, white and yellow, far from each other and from the tracks (S110);
  anyone later, a hue from their writer id (`stringHash`, `palette.ts`) at a
  saturation the tracks don't use. A
  ring on the rail has a dark gap between it and the dot, so it reads against
  any track.
  Names go through `displayName`, the fallback to an email's part before the
  `@` included.
- **`Initial` is the circle** (`presence.tsx`): a writer's initial in their
  colour, class `initial`. `Avatar` is an `Initial` with class `avatar`,
  which means a person shown here (Gotchas).

## Signals (ADR-0126)

What a mark says is one value, `Signal` (`signals.ts`): `unsent`,
`needs-you`, `worth-a-read`, `running`, `done`. `signalWords` is the one
place each is worded (its mark's name and title), and `packages/web` draws
every one through `SignalMark`, `.signal[data-signal]`, the one selector
the suites use. Attention keeps its `LEVELS` as what it decides
(`attention.ts`); `signalOfLevel` is the one mapping of a level to its
signal, and `statusSignal` a thread's or a task's status to its mark
(running while its agent works, its level's when raised, done while a
finished run fades). The plan's four signals are five: worth a read is a
level of its own, with its own dim mark.

### The unsent signal (ADR-0048, step 2)

A pip in your colour (`SignalMark`, `.signal[data-signal="unsent"]`) marks
where an unsent card of yours holds text: its root's item in your
list, the rail dot at its thread end, and the
root's item on the board. ▦ itself is marked only for a root not in your
list: an archived root's work is done, so it never lights ▦ (`elsewhere`).

- **`unsentSignals` (`signals.ts`) decides, purely,** from your cards, the
  ones holding text, the layout, the lanes and the index. Your message and
  a note you own are placed by `placeEnd` and `taskOfPlace` (ADR-0113): your
  message at a thread not yet started marks its task, with no end. A card in your inventory marks nothing: the inventory is no tab.
  Nor does a pinned card: it is a thread's direction, not unsent work.
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
- **Only your own cards count.** Cards you contributed to wait until
  Kyneta can name the writers whose text still stands (ADR-0048, *Who
  contributed*), so that the count follows undo.

## Your inventory (ADR-0048 step 4, ADR-0059)

A panel floating over the columns (`inventory-panel.tsx`, drawn by `App`),
docked left, centre or right by this device's choice (`inventory-dock.ts`,
`snapTo`, kept as a `deviceState`), holding a 3 × 6 card grid (`CardGrid`,
*Card grids* below). Open or closed is `App`'s state, never stored.

- **The selected card is previewed** (ADR-0126): `inventoryView`'s
  `preview` is the selected card, normal and one column wide (`CardPreview`),
  or null for an empty slot or while the card is open. The panel draws it
  beside the grid, on the side away from its dock edge, read only, by its
  kind's row of `RENDERINGS` (`packages/web/TECHNICAL.md`, *Renderings*).
  A click selects; Enter, or a click on the card already selected, opens it
  whole in place, which is the panel's state, so the preview can hide.
- **A thread's card is drawn by its face** (`thread-face.ts`, ADR-0124):
  `threadFace` (name, banner, first line, the first line of where it ended,
  stopped, cards queued), a case of `Face`; opened, `threadPreview`, its
  path read only, a `ThreadPreview` that no composer, dock or queue takes.
- **Two layers**: the host's records say which cards are in your
  inventory, and your inventory document which slot holds each. The session
  keeps the slots and repairs them (`packages/session/TECHNICAL.md`, "Your
  inventory's slots").
- **`settleSlots` is the one slot rule** (`@pinetrie/session`): the panel
  draws it (`inventoryView`, `inventory-view.ts`), the session's repair
  writes towards it, and a take into the inventory lands by the same
  `firstEmpty`. `App` computes it once, with the takes into the inventory in
  flight as intents (`intentsOf`), and
  both the panel and the intents read that.
- **The history of moves is the host's** (ADR-0066): one per person and
  task, and one per person outside any task (ADR-0126), which the host
  chooses for each move (`historyOf`). The page keeps none, and names no
  history when it moves a card. `undoMove` names the task you are on
  (`planUndoMove`, `taskOfTab`), or on none your history outside any task. The session sends `undo-move` and answers once its
  copy of the places reaches the reply's `rev` (`whenRev`).
- **The answer is planned afresh** (`undoAnswered`, `afterUndo`): each place
  a card went back to, once, brought into view (`revealOf`, `reveal.ts`):
  the panel, a thread's end through `openAt`, or, at a thread with no end
  here (one not yet started), its card unfolded in its task. A refusal shows the
  card where it is now and says who moved it there. An undo shows its place
  as it acts, not before, and flies nothing: the reply comes after the copy
  already has the move.
- **A swap is undone by this tab's own stack** (the session's `swaps`)
  while the panel has focus (`keyAct`'s `inPanel`); one whose slot the
  repair changed since is refused, `slots-changed` (S90).
- **A card an undo puts back in your inventory takes its old slot while the
  repair has not cleared it** (`steadiness`), else the first empty one: the
  host knows no slots.
- **One landing rule** (`put-target.ts`, `card-intents.ts`). A put, a
  drop and a paste name a `PutTarget`, and `planPut(source, target, how)`
  lands a `PutSource` (a card where it is, or a `Clip`) there, moving it
  or landing a copy. `putLanding` decides what that does as a value
  (`Landing`: move, swap, a new text card or reference, a thread's copy,
  an uncut, an insert into a text box, a replacement, or refused), which
  the drag engine can draw before a drop; `planPut` only mints ids, words a
  refusal and maps each case to its effect. Your inventory's target is
  aimed (`slot: number`, a drop or a paste on a slot) or not (`null`, a
  take, keep, Copy to your inventory): aimed and filled, the slot's card is
  replaced, discarded first (ADR-0133); unaimed, the selected slot if empty,
  else `firstEmpty`, else refused `full`. A target is: a thread's column by key (a note in the note column nearest
  its thread, `noteOf`), its composer (your message), a note column (a
  note at its end, ADR-0116), its pinned strip, a slot, a spot on a
  canvas (`canvas`: just after a folded column, or past the last, where
  `.canvas-end` leaves room; `data-put-canvas` and `data-put-after`), or a
  new thread: a workflow state or a place in the sidebar
  (`data-put-state`, `data-put-sidebar`, *The board*). On a spot, a
  thread's card or a note column lands there, and a text card or a
  reference is sent to it for the host to make a note column for it
  (`WRAPS`, ADR-0126); the put key never names a spot, which is a drop's. Each writable `Column` publishes its
  composer as it renders (`ComposerSpot`: its place, `composerPlace` in
  `column-view.ts`, and your message there); reading it redraws nothing. A
  drop target carries `data-put-column`, `data-put-composer`,
  `data-put-notes` (a note column's id), `data-put-pinned` or
  `data-put-slot`, each written by `dropProps` and read by
  `targetOfElement`, so a drop lands exactly where a put can. A column's pinned strip carries `data-put-pinned`: it
  lands where the column's composer would create a card, pinned (`pinnedOf`),
  an unstarted thread's too. A slot as the target swaps a card already in your
  inventory, and lands any other there, replacing what the slot holds.
- **Take into the inventory, put, paste, keep (the clipboard cell's),
  remove, select and undo are intents** (`intent.ts`, `card-intents.ts`),
  planned from `IntentState.cards` (`CardFacts`: the drawn cards, the
  lanes, the drawn slots, the selection and the composer places), carried
  out by `perform`. Several moves sent as one (a closing branch's cards
  kept in your inventory, a slot's replacement) are the `moveCards`
  effect, which the host accepts or refuses whole, `full` among its
  refusals; a closing branch's column closes once accepted (`afterKeep`).
- **Drag** is HTML drag and drop, not the column drag's pointer events: it
  crosses elements and roots. A card's drag carries its id under
  `CARD_MIME`; its handle is its frame's header (`CardFrame`), or a slot. `App` listens on
  the document for `dragover` and `drop`; a drag held over a root in your
  list for `ITEM_HOVER_MS` opens it. A root's drag is not a card's
  (`ROOT_MIME`, The board, above). `NOT_A_HANDLE` includes `[draggable='true']`, so
  a card's drag never starts a column's.
- **Keys** (`page-keys.ts`, `keyAct`): one table of the page's own keys,
  not only the inventory's, read by one `keydown` listener in `App` that
  decides nothing, from one record of where focus is (`Focus`, `focus.ts`,
  gathered by the page's `focusFacts`). It holds the search's keys too (Search, above). Ctrl+Shift+I takes the
  focused card into the inventory (`data-card` on the focused element, a box's included);
  Ctrl+Shift+O puts the selected one in the column whose element last held
  focus, never into a text box; Cmd+C, Cmd+X and Cmd+V are the page's
  `copy`, `cut` and `paste` events, not keys here (*Copy, cut and paste*); Cmd or Ctrl with Z, Shift+Z, or Ctrl+Y undo and redo a move, only
  outside a text box, where the box's own text undo has them. A grid's
  keys are its own (`gridKeyAct`, *Card grids* below). Ctrl+Shift+L
  folds or unfolds the sidebar (ADR-0088), from anywhere, as I and O.
  The open board's keys are a second table, `boardKeyAct` (`board-view.ts`),
  read by `Board`'s own listener, until the key-system redesign replaces
  both: clearing its filter and focusing its search are view state, not
  intents. Escape there clears the filter (its words and "mine") before it
  closes the board, after any menu open on it, in a text box too: in the
  search field it is how you leave the search. `/` focuses the search
  outside a text box. Both
  listeners ask `isTextBox` (`packages/web/text-box.ts`), which counts any
  `<input>`, a checkbox too.
- **A move flies** (`use-flight.ts`): `perform` measures the card's element
  before the move (`ports.fly`), and once it is drawn elsewhere that
  element animates from the old box. A take into the inventory while the
  panel is closed opens it briefly.
- **Selectors for the browser suite:** `.inventory` (the panel),
  `.inventory .slot[data-slot][data-card]` and its `.card-face-lines`, the
  preview's `.inventory .preview .card-normal[data-card]`, the open card's
  `.card-grid-open`, `.inventory .put`, `.inventory
  .discard-card`, `#bottom .inventory-toggle` (`.account-inventory` in the
  account menu while the sidebar is folded), the clipboard cell's
  `.inventory .clipboard-cell` and its `.keep`, a card's focusable
  `.card-head[data-card]`, and an unstarted thread's column's `.close-keep`,
  `.close-discard` and `.close-cancel`.

## Copy, cut and paste (`clip.ts`, ADR-0132)

The system clipboard is a tool, apart from the inventory: a copy moves
nothing and opens nothing; a paste lands a copy where focus is. The page's
`clipboard.ts` reads the events and the clipboard's data; everything it
decides is here.

- **A `Clip` is what was copied, holding its own text**: a selection or
  another app's text (`text`, with its origin or none), the past (`past`, a
  `Taken` of an entry or a block), or a card (`card`, its `CardClip` by
  kind, and whether it was cut). `cardClip` builds a card's: a text
  card's text (`textOf`), a reference's address and quote blob (its text
  the quote if this tab has fetched it, `quoteOf`, else its link: the copy
  cannot wait for a fetch), a thread's end as this tab holds it
  (`threadAnchor`, `threadClip`), a note column's or a task's link. A
  kind added to `CardClip` does not compile until `cardClip` and the
  landing say.
- **What a copy takes** is `clipOfFocus(focus, facts, cut)`, first match
  wins: a text box, or a selection outside any message, is the browser's
  own copy; a selection in a message is its text, its origin the range
  `selectionReference` names, else the message; then a focused block
  (`data-block`), the column's selected message (`data-selected`, only while
  focus is in that column), a focused card, the clipboard cell. A cut takes
  only a focused card `isDiscardable` says you may discard
  (`discardable.ts`, the one test a discard, a cut and a replacement ask).
- **The carrier** (S151): `planCopy` writes the text as `text/plain`, the
  selection's own HTML or the text escaped in one element carrying
  `data-pinetrie` as `text/html`, and the same JSON as
  `application/x-pinetrie`. `readPaste` reads the custom type, then the
  attribute (the page parses `text/html`: WebKit writes it again in its own
  form), then the text; a carrier counts only when it decodes, was written
  on this host (the page's origin) and names the text pasted, `\r\n` taken
  as `\n`. Shift held at the paste's keydown (Cmd+Shift+V) makes it text.
- **Where a paste lands** is `targetOfFocus`: the text box with focus, else
  the drop zone around focus (`targetOfElement`), else the column last
  focused. It lands by `planPut(…, "copy")`: in a text box, text as itself
  and anything else as a link (`addressLink`, an `insert` typed by the
  `insertText` port, so the box's own undo sees it); on a surface a
  selection or text as a text card keeping its origin, the past as a
  reference (its quote kept as a blob first), a text card as one with its
  text and origin `{ kind: "card" }`, a reference as a reference with its
  quote, a thread as its copy at its clip's end, a note column or a task as
  a reference to it. A cut clip whose card is still in your trash is an
  `uncut`: the card itself moves out.
- **A paste is one request** (`paste`, `@pinetrie/rules`' `planPaste`):
  the card it replaces discarded first, then the card made or moved, one
  step of history. **Queue a reference** is a paste of a reference onto
  its thread's queue, its quote the comment's under a link to its entry,
  read as it is kept.
- **The clipboard cell** is `clipboardCellView`: the last `Clip` this tab
  copied (or pasted: a paste shows what the clipboard holds), its words,
  "last copied here", and whether **keep** (a paste into an unaimed slot)
  has a free slot. No page reads the clipboard before a paste, so it claims
  no more.

## Card grids (`grid-view.ts`, `grid-keys.ts`, ADR-0048)

Your inventory is a grid (`CardGrid`, `packages/web/card-grid.tsx`):
core's `grid.ts` says what a cell is (`INVENTORY_GRID`, 6 × 3), the first
empty one (`firstEmpty`) and a step (`step`).

- **`gridView`** lays cards out by cell, each at its least detail
  (`faceOf`), with the selection and the selected card.
- **A face is one value for every surface** (`face.ts`, ADR-0126): `Face`
  is a union with a case per drawn kind (a text card's `TextFace`, a
  thread's `ThreadFace`, a note column's `NoteColumnFace`), so a grid's
  cell, a folded column and later a margin's mark draw the same value. The
  face is the kind's; the frame (tone, state, actions) is the place's
  (`card-frame.ts`), and the two modules never share a signal: the icon is
  the kind's (`KIND_ICON`), the colour the place's.
- **Which level a place draws its cards at** is `DETAIL_ON`, total over
  `CardPlace["kind"]` (ADR-0126's table), so a new place does not compile
  until it says; `detailOf(place, folded)` makes a folded column a face. `inventoryView` places them by
  `settleSlots`, each of the first nine labelled 1–9 (`slotKey`).
- **`gridKeyAct`** is the grid's keys while it has focus: arrows and `hjkl`
  select, Alt+arrows move the selected card (a put on that slot, which
  swaps), Enter opens it, and Escape folds it, from its box too.

## Note columns (`note-column-view.ts`, ADR-0116)

A task's notes are in note columns on its canvas, each a title and its
notes in one order; the notes board, its grid and the dock's notes line are
gone.

- **`noteColumnsOf`** is the task's note columns in the canvas's order,
  each with its title (its `NOTE_COLUMN` record, else `NEW_NOTES_TITLE`)
  and its notes in order (`notesIn`).
- **Where one is drawn is its card's rank on the canvas** (`canvasColumns`).
  "Add a note column here" in a column's `⋯` makes one just after it, and
  the task column's "+ note column" one first: a move with no `from` to a
  spot on the canvas (`canvas-at`), which the host ranks; it opens
  unfolded.
- **A note's acts are a column's**, keyed by its note column's card (a
  `column` intent with a `card` key), so a refusal is said there: ↑ and ↓
  reorder it among the column's notes (`reorderOf`, a `note` key), and its
  ⋯ takes it into your inventory or makes it a thread; a drag takes it
  anywhere else. "+ add a note" is `newNote`: an empty note at the
  column's end, drawn last until the host gives it its order
  (`LAST_ORDER`), in no history.
- **Renaming a note column is `rename` with a `MarkTarget`**: the same
  `TitleField` and `planTitle` as a task's, sent as `mark`.
- **A card leaving a queue or a pinned strip** is sent to its thread's
  nearest notes (`noteOf`, the `notes` key), which the host resolves; the
  page draws the move pending in the column the host would choose
  (`drawnPlace`), or where it was while the host would make one.
- **Selectors for the browser suite:** `.note-column` (`data-column`, its
  id), `.note-column-title`, `.note-column .open-title-input`, `.add-note`,
  and each note's `.card-editor.note` with its `textarea[data-card]`.

## Other threads' agents (`agents-view.ts`, `send.ts`, ADR-0128)

- **The composer's candidates** are every open task's named threads (the
  app's `inReach`, `reachableAgents` in rules), each a member when
  `threadMembers` of the column's path holds it (`agentCandidates`, core):
  the host builds them the same way, so the send button and the host agree.
- **`recipientWords`** puts the agents a send invites first ("invite
  amber-fox · send to agent") and names those it asks as people are named.
- **`agentsRow`** is the header's row: the thread's members by name, and
  the newest budget a message of the thread set, worded by `agentsWords`.
  A member is away exactly when it is not in `inReach`, so `threadReach`
  is read for those alone, to say why (`awayWords`).
- **`crossTaskLinks`** gives each ask, answer and heard row from a thread
  on another task its `ThreadLink` and words ("Sync bug", "Bea has it"),
  one value-compared map per column, as `joins` is; the message draws it
  beside its speaker and opens it through the column's `onLink`, as a fork
  row does. A thread on the column's own task gets none.
- **`threadLink` reads `threadReach`**, the one reader of where a thread's
  card is; an archived task's thread still opens its task.

## Names

A message keeps the name its writer had when they sent it: that is what the
agent read, and rewriting it would change history the agent has seen, and the
provider's prompt cache. The screen shows the writer's current name, with the
name the message was sent under in parentheses when they differ
(`speakerLabel`, `names.ts`): "Duane (duane)". Someone who set no name is
shown by their email's part before the `@`. Each rendered chat carries its
`writer` for the lookup. `speakerWords` names any message as its column does:
a person so, with those who wrote it with them, and any other role by its
label ("agent", "caught up"). A message and a search's match both say it; a
fork's origin says it for a person, and names the agent by its thread.
