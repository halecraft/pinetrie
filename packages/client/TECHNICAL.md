# `@pineta/client` — technical notes

The browser interface: a tab per root, each a rail beside a strip of columns
(`docs/06-interface.md`, ADR-0029). Its connection to the host is
`@pineta/session` (`packages/session/TECHNICAL.md`), which declares no React:
this package draws and words, and decides what the page asks the session for. Everything drawn is a read of the session
document through `@pineta/reads` and `projection.ts`; the only state kept here
is the layout (which tab you are on, and each root's columns), kept per
browser tab. What is typed is a card (ADR-0048): a document of its own,
written by this client, and kept on its thread.

## The roots a tab holds (ADR-0063)

- **A tab holds the roots it shows** (`planHeldRoots`, `held-roots.ts`): the
  roots of your open tabs, the one you are on, and the Archive tab's
  preview. `SessionClient.holdRoots` opens what is new and `destroy`s what
  is not, which leaves the host's copy (S86). A root this client starts is
  held from its first send until the page asks for it, and after that only
  while the page does. What opens and goes, and why every other root is
  declined, is the session's (`planHold`, `root-hold.ts`, and `rootDocs`,
  `packages/session/TECHNICAL.md`).
- **Every cross-root fact comes from the directory** (`readRoots`): the tab
  bar's labels and summaries (`summariesOf`, `firstLinesOf`, `labelsOf`), the
  Archive tab's rows, `prune`'s known roots, the inbox's mentions, the
  header's count (`messageCount`: the held roots' messages, of every root's), the participants (`participantsIn`), the
  roots of the header's runs and offers (`runsHere`, `laneRootsOf`), and the
  root of a card drafted in a root not held (`cardMarks`'s `rootEntries`).
  The Archive tab searches labels: a search of every message would hold
  every root.
- **A directory write wakes every read of the session's records**:
  `readValues` reads the whole `values` map. So `readParticipantNames`
  keeps its map while the names are the same, since every message compares
  it by identity (the browser suite's "a message in another thread redraws
  none of this tab's messages").
- **The held roots read as one tree** (`readHeldIndex`), so every projection
  below works as it did over one document, for the roots held. A root's
  columns sync only while it is held; `prune` waits for the stored tabs'
  roots to settle, and drops only what the directory lacks.
- **What the header opens may be in a root not held** (`openIn`): one held
  opens as `openAt`; an archived one is previewed; any other root's tab is
  shown, which holds it, and `openWhenHeld` shows the entry once the index
  has it.
- **A write names its root**: `chat` and `mark` find it from the held
  document with the entry (`rootOf`), and a send at the root mints one
  (`newRootId`); a card's place at an entry carries it. A queued card
  takes its lane's root (`queueRoot`, in core), since the host takes it
  into a chat in `place.root`; only a lane with no record yet falls back to
  the card's own root.

## Reads go through one index

`readTreeIndex(doc)` (`@pineta/reads`) builds `indexTree` once per change of
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
as an `EntryId`, and every lane as a `LaneName` (`packages/reads/TECHNICAL.md`),
so the client never mints one but where an id comes back in from elsewhere:
its stored form (`layout.ts`'s `decodeLayout`), your attention document
(`readAttention`, in `@pineta/schema`), and ids read back from the page (`use-ask-bar.ts`, from `data-ask-of`).
`biome.json` refuses an `entryId` or `runId` import anywhere else in the
client; tests build entries and trees through `fixtures.ts`, which mints.

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
- **What a message's tables and images need from the pane comes by context,
  never a prop** (`pane-context.ts`, ADR-0078). `PaneReach` (what the pane
  shows, and `open`) is provided by `Column`, memoised on the subject with
  a stable `open`; `MessageSource` (the message's entry, or a reply still
  streaming) by `MessageView`, memoised on its id, and by `Reply`. A
  context change redraws only `MessageTable`, `BlobImage` and `AskWork`,
  which read it, and React records no such render, since their props are
  the same. So `MessageList` takes no handler for an ask's review.
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
  `afterArchive` plans an archive's or a restore's answer, and `nameEffects` the settle's
  name step (`reconcileName`).
- **`perform` carries the effects out** (`perform.ts`), one port call each,
  through `AppPorts`: the reducer's `dispatch`, the session's writes,
  `reveal`, the Archive tab's pick, focus, the identity store and
  `reload`. A request the session does not track is one `request` effect
  carrying the `HostRequest` itself, so a new kind of request adds no effect
  and no case. What the session tracks keeps a method of its own: a chat
  and a move (`moves`), an offer action and a line action (`acting`), and a
  mark, whose root it finds. Whether a move animates is the plan's too
  (`moveCard`'s `fly`).
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

- **A root's label is `labelsOf`'s** (`root-label.ts`, ADR-0045, ADR-0074):
  its title; else `CHAT_LABEL` for a root no lane works in, read from the
  session's lane records, so a root only people wrote in needs no field of
  its own; else its first line (`firstLinesOf`), from its directory record
  (ADR-0063). `App` builds both maps once per directory change, and every place that names a root looks one up: the tabs,
  the header, the inbox, and the Archive tab, whose search reads labels, so
  it finds a title without knowing about marks. The first lines are also
  the rename field's placeholder: what clearing a title brings back.
- **Renaming is `TabBar`'s state, never the layout's.** `planTitle` is the
  field's submit, over `parseTitle`, the rule the codec decides by too, and
  `renameKey` what Enter and Escape do.
- **What the bar shows and offers is `tabsView`'s** (`tabs-view.ts`), over
  `tabBar`'s order: each tab's label, pip, ⋯ items and the intents it
  sends. `TabBar` draws it; the `Readers` on each tab read presence
  themselves (S59). Every tab has a `label`, Archive's `ARCHIVE_LABEL`.
  `selected` is the tab you are on, decided there once: `App` titles the
  window from it (`pageTitle`) and `TabBar` scrolls it into view, keyed by
  `tabKey`, which is also each tab's React key.
- **The tab bar is the header** (ADR-0081): `#top` holds `TabBar`, then
  `Header` (`.header-right`, pushed right by `margin-left: auto`, so
  nothing stands in for a `TabBar` not yet drawn). Every tab, Archive
  included, is a `.tab-wrap` around its `.tab` button, ⋯ and ×; the wrap is
  what is drawn as the tab. The selected wrap carries `data-selected`,
  set from `TabView.selected`, so it holds even while its button is the
  rename field; it is filled with `--page`, and the bar is `--chrome`. The session's message count is
  the Archive tab's (`TabView.messages`): its title and `data-messages`,
  and `.archive-count` in its list.

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
- **Archiving closes the root's tab once the host answers `archived`**
  (`afterArchive`), not when it is asked: a refusal leaves the tab open.
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
- **A new tab mints its root's id as it opens** (`fresh.root`, ADR-0066),
  from the shell, beside its key (`planIntent`'s `newRoot`), as a column
  reserves its lane's id. Its cards' fresh places name it, the host keeps
  its moves' history under it, and its first send starts it
  (`ChatHow.root`). Stored with the layout; one restored without it is
  given one (`decodeLayout`'s `mintRoot`).
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
  tab shown again places its columns as if opened, left to right: each at
  the spot it was left (A column's view, below), else aligned, the first at
  its end (Layout, below). Each keeps what it knew of its end
  (`SeenEnd`, Following a column's end), and each tool row what it decided
  (`RowMemory`, Tools and live work).
- **The Archive tab** is `archive.tsx` over `archiveIndex`
  (`archive-rows.ts`, a client-only read like `projection.ts`). Its filter,
  search, selection and preview anchor are component state, never stored. The
  preview is a `Rail` and one `Column` with `readOnly`: Restore for an
  archived root, Open for an open one. Its column's reader settings
  (density, details) are its own state, never stored.

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
  fresh column is `anchored` in `projectColumns`: its path ends at its anchor.
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

The header's right end (`header.tsx`, beside the tabs in `#top`) is the
rest of the session, from live data; nothing in it opens a tab until you
choose. It leads with "syncing…" (`.sync-note`) while the document's status
is pending.

- **People:** `peopleHere` (`here.ts`) groups `readingAt` by
  person, in `writerOrder`. An end's root is found in the index, else in
  the root its column reported (`readingRoot`, `readReadingRoots`), so a
  person in a root this tab does not hold is shown, and opens it. "Never you" is `readingAt`'s rule, not
  repeated here. Each avatar (`Avatar`, the same circle the tabs and columns
  draw) is a `Menu` of the threads that person is in.
- **You** are the last thing in the header: your profile (`profile.tsx`,
  below, under Who you are).
- **The agent:** `runsHere` is its running lanes in every root: a held
  lane's run at its tip (`activity`), any other at its root entry, from the
  lane's record (`running`) and the directory.
- **Activity** (`activity.ts`, pure, ADR-0069): the agent's runs, the open
  offers and your mentions, in one menu (`ActivityMenu`). `activityView`
  decides the badge (offers plus unseen mentions, never runs), which
  sections show, and whether the trigger is drawn; `activityWords` words
  them. `kept` is the sections shown when the menu opened, set through
  `onToggle`, so an open menu keeps a section whose rows have gone and says
  so. Its first section has a heading and no items: it names the menu, and
  its empty `.menu-section` is hidden, with no rule under it.
- **The project menu** (`line-view.ts`, ADR-0076): `lineView` decides two
  sections, the project's (setting it up, publishing it, on every host) and
  your files' (null on a host that admits others), each offering what
  `@pineta/rules`' `lineActionState` allows, the rule the host decides by;
  `lineWords` words them, a publish it does not offer with `lineRefusal`.
  Notes name no files but those that would conflict; how many files
  updating changes is the action's title. The trigger counts unpublished
  commits, never your files being behind.
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
  both in a span that gains `open` while open, which keeps `.tab-more.open`
  visible; the box is `position: fixed` from the trigger's rect. Escape, a
  scroll of an element holding the trigger, a resize or a click elsewhere
  closes it. Escape is one document listener while open, taken with focus in
  the trigger or the box, or on nothing: live data can remove the item that
  held focus. `role` is `menu` or `dialog`: a dialog's box takes the role,
  and a menu's list does.
- **A trigger from live data is `gone`, not unmounted.** Unmounting a
  `Popover` takes its open box with it, so a change in the session would
  close a menu you opened. The header keeps its activity menu
  mounted with `gone` when there is nothing to list (no trigger drawn unless
  open), and keeps a person who leaves while their menu is open
  (`withOpenMenus`, told by `onToggle`) until you close it.
- **`Menu`** (`menu.tsx`) is a `Popover` whose box is a `role="menu"` list,
  in sections (`MenuSection`): the header's people, activity and
  project, the tab's `⋯`, the add tab's menu and the composer's where line.
  The first section's heading is drawn above the list, not in it, since a
  menu holds only menu items, and names it (`aria-labelledby`); each later
  section is a `<fieldset>` (role `group`, which Biome asks for as the
  element) named by its own, which is drawn `aria-hidden`. A section's notes
  are text, not items, and describe it (`aria-describedby`): the project
  menu's "your files have everything in the project". Items can carry
  `data-*` attributes (`MenuItem.data`); one with `checked` is a
  `menuitemradio` with a ✓, and the arrow keys and the opening focus take
  both kinds.
- **`.initial` is the circle; `.avatar` is a person shown here.** The browser
  suite counts people by `.avatar`, and proves you are never among them by
  it. So your profile's trigger (`.me`), the agent's mark (`.agent-mark`)
  and the "+n" of `Avatars` (`.more`) are `.initial` and never `.avatar`.
  The circle's shape is `.initial`'s rule; `.avatar` has none. `#top` holds
  the tabs too (ADR-0081), so `#top .avatar` also matches a tab's readers,
  who never include you either.

## What needs you (`attention.ts`, `use-attention.ts`, ADR-0077)

- **`attentionOf` decides what is raised**, pure: a thread's verdict and its
  open offer, for its followers only (`follows`, over the directory's
  `RootRecord.threads`), while its lane is idle and its root not archived.
  A verdict clears when your read mark passes its `end`, an offer when it
  goes; either with "not needed" (`dismissed`, `dismissedOffers`). Nothing
  is raised before your attention document's `since` is set.
- **`levelOf` turns a verdict, a fact, into a level for you**: a stop is
  done for whoever stopped it. `LEVELS` orders the levels once; `highest`
  reads it.
- **`rootStatus`** is each tab's mark: working while a lane of its root is
  busy or its verdict pending, else its highest item. `untabbed`
  (`layout.ts`) gives the Archive tab's, as it gives `cardMarks.elsewhere`.
- **Motion is a change you saw, never a state.** `arrivals` compares two
  statuses, and `useArrivals` takes the first status after the session has
  settled and your `since` is known as the baseline, so a load moves
  nothing. It keeps *when* each mark arrived, never a timer: a mark is
  keyed by that time and moves only as it mounts within `ARRIVAL_MS`
  (`moving`), and the ✓'s fade ends at no width. So the end of a motion
  redraws nothing. A timer that dropped arrivals redrew `App` while you
  typed, which the browser suite's render check caught.
- **One count** (`needsYouCount` plus unseen mentions) is the badge's and
  the window title's. `pageTitle` (`tabs-view.ts`) puts it before the
  selected tab's label.
- **Words:** `attentionWords` words each item's reason, `LEVEL_WORDS` and
  `LEVEL_CLASS` a level's name and class. Selectors: `.tab-status`
  (`.working`, `.needs-you`, `.worth-a-read`, `.done`, `data-arrived`),
  `.here-thread.raised`, `.not-needed`.

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
tabs: where the inventory is docked, and who you are (`pineta-identity`,
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
  whose dot carries its mark. A column's end is kept because an anchored column
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
  `stretchWords`: `askWords`, `workWords`, then the ask's digest as
  `digestText` words it (ADR-0075).
- **Every item has `slot`, `span`, `ids`, `track` and `across`;** a dot is
  an item with one id and a span of 1. An edge leaves its parent item's last
  slot, so the renderer never asks which kind an item is, only how to draw
  it.
- **Rows are depths, places are booked (`placeRail`, ADR-0068):** an item's
  slot is its parent item's `slot + span`, so a branch starts beside the
  older subtree, and each branch takes the leftmost `across` free from its
  fork's row to its last. `track` is the branch's colour, by creation order
  (`projectRail`), and never the place: `data-track` on a dot, a capsule,
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
- **A new tab's rail is `EmptyRail`:** a `.rail-start`, not a `.rail-dot`, so
  `railCount` never counts it. The rail's `min-width` is wider than one
  track, in both, so the columns keep their place; the browser suite checks `#strip`'s left edge
  across that send. `.rail-tree` is `fit-content` and centred, and the SVG is
  `PAD` wide on both sides of its outermost places.
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
  change. Whether its thread's details are open (`Column.details`,
  ADR-0073) is kept the same way.
- **Both are `ReaderAction`s, by the column's key** (`readerAction`,
  `intent.ts`), as `sent` and `reserve` are: `planColumn` sends them
  through `onColumn`, so a new tab's one column takes them
  (`newTabColumn`), and the Archive preview reduces its own column with
  `columnsReducer`, keeping them only while it shows.
- **What `askView` decides:** what its work holds (`work`, `workWords`
  over `askStats`), the outcome's words, the live line while it runs, the
  last word outline hides (none in the column's last ended ask,
  `lastEndedAsk`, ADR-0070), its digest's headline and, once final, its
  points (ADR-0075), and the span its files open in a review (`askSpan`).
  `askWords` says an ask the same everywhere: the bar, the working mark's
  title, the rail's tooltip, outline.
- **`foldWords` orders an ask's line** (`line`, outline's) and first fold
  (`fold`, story's) as parts, a model's headline marked as one, so
  `AskWork` only lays them out and wraps the headline in `.ask-headline`.
  Outline's line holds no headline: it is cut to one line, and while the
  run lasts it says what the run does now.
- **`digestApart` decides where a digest goes** (`ask-fold.ts`): whole in
  `.ask-digest`, headline above points, where no fold head carries the
  headline (outline's closed line, or an ask with no fold); else the
  headline in the first fold's head and the points under it. The points
  are one `MessageText` over `pointsText`.
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
- **What a catch-up merges is worded by `catchUpName` alone**
  (`@pineta/rules`, ADR-0061, ADR-0072): the line is "the project", a
  WIP its bookmark, the thread a thread branched from its name. The words
  take core's `CatchUpFrom`, never a bookmark string, and the line's
  bookmark goes only in titles: `offerWords`' button titles ("moves
  pineta-onto forward to pineta-offer/amber-fox"), `behindMark`'s,
  `baseChoices`'. A card's command is worded from `CatchUps` (the thread's
  base and its parent), which `Column` keeps as one object while it says
  the same, since the composer is memoised.
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
- **A take names the offer this tab shows** (ADR-0065): `SessionClient.offer`
  reads the lane's record from its session document as it sends, the one
  the strip was drawn from, and sends `offerSeen` of it (its ledger, and
  whether it conflicted). The host refuses the take `offer_changed` when the
  offer now brings other work.
- **Your offer and line commands are tracked per tab** (`acting.ts`,
  `@pineta/session`): `SessionClient.offer` and `.line` mark the command
  `sent` at once and record the answer when it comes. A refusal or failure
  stays until your next command on that lane (or the line); an answer that
  carried it out (`taken`, `offered`, a split's `started`, `line-moved`)
  clears it, since the record then says how things stand. Each send has an
  id, so the answer to a send since replaced changes nothing. The page's
  `offer` effect (`perform.ts`) only calls the session. `columnView` takes
  the lane's entry as `ColumnFacts.acting`: the strip's `waiting` disables
  its buttons and menu rows while it is `sent`, and `offerWords` words it
  as the strip's `note` (`.offer-note`, `role="status"`, `data-acting`
  `sent` or `said`). A take in flight names its destination by
  `catchUpName`; a refusal or failure is `outcomeWords`, shared with the
  project menu.
- **`offerView` (`@pineta/rules`) decides an offer; `offerWords`
  words it**: its line and each button's label and title, by state. An
  offer that conflicts says so even when it is `edited` (S73), and its take
  reads "add anyway" whatever the state, as it does when a resolution asked
  for you. Each take names where the work goes (ADR-0060, ADR-0061): "add to
  the project", "add to wip/search", and, from a WIP thread's menu, "add to
  the project, with your 2 commits beneath it". A conflicted offer on the
  line offers "resolve in the thread", never a take onto it. The bookmark is
  a fact of its own, drawn apart (`.offer-bookmark`), never in the line.
  `workStrip` hands `offerView` the record decoded (`offerStatus`): a `held`
  offer says "nothing to add: the project already has this thread's work",
  and has no review.
- **What catching up would do** (`catchUpOf`, from `pineta.base`'s `start`
  and `catchUp` against `pineta.line`'s commits, S97): when it `brings`
  files, the strip's line adds "· the project has new work", or is that
  alone with nothing to add, catching up moves from the `⋯` menu to the
  buttons, its title counts the files, and the header shows `behindMark`'s
  ↓, titled with the count and the move (the bookmark, and the commits it
  went from and to). When it would change nothing (`current`, or
  `nothing-new`: the base moved by the thread's own work), it stays in the
  menu, quiet: `LabelledButton.disabled`, with the reason as its title, and
  `column.tsx` disables it. Until the host has read the move (`unknown`), it
  stays in the menu, enabled, and claims nothing. So does a lane with no
  base record at all: the host has never read it. An untraced thread
  (`pineta.base`'s `untraced`) says "an earlier add of this thread can't be
  traced: catch up with the project to offer what's new", with catching up
  beside it. `ColumnFacts.catchingUp` is a card with a command queued on
  the lane (`offerView`'s `catch-up` activity: "catching up with the
  project…").
- **A thread's base** shows in its header only when it is not the line
  (`baseWords`): "on wip/search", or "wip/search is gone", when the menu's
  update becomes "continue from the project" and no take is offered.
  Catching up says its base: "catch up with wip/search". Two known limits,
  both in words only:
  - until a lane has a base record, the page names the line as its base
    (`effectiveBase(null)`), so a WIP thread that never changed a file says
    "catch up with the project". The host merges the WIP, read from the
    lane's own history;
  - with no line set up, `catchUpOf` is `current`, so the menu says
    "already caught up with the project" where the project is not set up.
    The host refuses the catch-up (`no_line`).
- **The header's project menu** (`LineMenu`, `lineView`, `lineWords`)
  offers "set up the project", showing the config text it writes
  (`immutable_heads()` and `revsets.log`); then notes of where your files
  stand, from the line's record: conflicts first, then what the project has
  that your files lack, with the record's preview of updating (ADR-0061).
  Its actions (`LineMenuAction`): "resolve with the agent" when your work
  has conflicts, "update my files" only with a preview, "add my work to the
  project (N commits)". The first is no `line` command: `resolveIntent`
  opens a new agent tab whose `Prefill` carries its text and its work
  setting (your files), which the editor starts its choice from. Your last
  command is said at the top of the notes (`lineNote`), from the session's
  `acting` store, not the menu's state, so it outlives the menu closing:
  what it is doing while out (its actions are disabled), then a refusal or
  failure (`outcomeWords`).
  A host that admits others offers none, and says to use jj on its machine.
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
  - **`where` repeats a direct lane's strip line** (`whereWords`), on
    purpose: every thread's details say where it works.
  - **Toggling dispatches no `PLACED`**, unlike density: it changes the
    view's height, not the content's, and `useFollow` follows that.
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
  sprite's black ground becomes the header's colour. The mark's rules are
  `.thread-mark`'s, not the header's, since the details draw it too, with
  `isolation` of their own; only its pulse is scoped to where it is. The header has no `overflow: hidden`: on a flex item that
  removes its minimum height, and a tall column squeezed the header.
- **`onCreatesLane`:** the composer tells the column, in an effect, whether its
  next send would create a lane, so the header can say `✦ new agent`. It is a
  boolean, not the text lifted up: `Column` redraws only when it flips, not
  on every keystroke.
- **The thread to come is named before the send** (ADR-0057). `headLane` is
  the lane the header names and draws the banner of: the thread's, or the
  column's reserved one while `createsLane`. `columnView` decides the
  `reserve` step: `mint` a lane id (`newLaneName`, `@pineta/session`) for a column
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

- **One verb, one meaning** (ADR-0077): a person follows a thread they wrote
  on, reads one now (presence), and a column follows its end (Presence,
  below).
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

## The page's colours (`index.html`, ADR-0081)

`:root` names them: `--page` (the paper the columns and the tab you are on
are drawn on), `--chrome` (the bar), `--edge` (its line and the selected
tab's sides) and `--on` (the selected tab's top edge). No page-colour
literal is left in the stylesheet. `--surface` is the colour behind a
thing, set by context: `--page` by default, `--chrome` in `#top`, the hover
fill on a hovered tab, `--page` on the selected one. A ring that must read
as a gap around a dot (`.tab-status.needs-you`, `.card-pip`) is drawn in
`--surface`, so it matches whatever the dot sits on.

## Colour carries the link, not geometry

Each column takes the rail track of its last message (`branchColors`); its
header, its fork dot in the parent column and its rail track share that
colour. There are no connector lines, so sibling branches never cross.

- **One inline `--track` per column** (`trackStyle`, `rail.tsx`), on
  `.column`: the header's border, name and origin dot, the thread's details
  and the pane read `var(--track)` in CSS. A fork dot sets its own, the
  track of the branch it opens, and so does the narrow pane's dialog, which
  is outside the column.
- **Hover linking is CSS.** Headers and fork dots carry `data-color`, the track
  modulo the palette; `:has()` rules in `index.html` outline one in
  `var(--track)` when the other is hovered. No component state. The rules are
  eight pairs: CSS cannot match two elements' attribute values.
- **The palette is eight colours**, so tracks eight apart share one. A track
  is a branch's rank by creation (ADR-0068), so two columns share a colour
  only then; the rail shows them the same way.

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
- **The Archive preview keeps no spot** (`spots={undefined}`): it shows a
  root's newest path, and its spot, saved as you go back to the tab, would
  replace the tab's columns' own. Its column still measures, and its rail
  draws its outline.
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
  (`@pineta/rules`), the function `planChat` runs on the host, so the
  button cannot promise a reply the host will not start. `SendPlan.to` is
  `addressChat`'s `Address`, unchanged. A fresh column sends `branch`; a
  send to a busy lane (`isBusy`), plain or asking the agent, and a card
  with a command, queue: the editor queues the card itself (the `queue`
  act), and sends nothing: `SendPlan.mode` is a `ComposerMode`, whose `queue`
  is the client's and never reaches the wire. A send the host finds busy,
  where the page thought the lane idle, the host queues in the same step,
  and answers `queued` (ADR-0059).
  `sendButton` words the plan (labels: `docs/06-interface.md`), and
  `placeholderWords` gives the box's placeholder: the composer holds only its
  state and draws.
- **Every send from a column carries its `ColumnHow`**: its bound lane,
  whether it is a Start Agent column, and its reserved lane, built once by
  `Column` for its composer and for everyone else's cards at its end, since
  sending any of them here creates this column's lane.
- **The queue names who queued the last card,** not who the agent is
  answering: the host takes queued cards in order, so a new one waits behind
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
  the message before it failed. The profile form words a failed rename with
  the same function, through `renameProblem` (`identity.ts`).
- **Queued cards** (ADR-0048) are drawn after the thread's last message and
  its working line, above the line, in the order the host takes them
  (`queuedOn`), each a `QueuedCardEditor`: always bound, editable by anyone
  here, with `queuedWords`, its command's `commandNote` and **unqueue**. They
  are not in the tree yet. Below the line, the column shows every drafting
  card at its end but the composer's (`others` filters on id, not owner), so
  a card of yours someone unqueued while you typed another shows there.
- **A queue sends the text's version too** (`seen`, `textVersion`), in the
  queued key, and so does a chat sent from a card (`SentCard`), which the
  host queues when the lane is busy: the host takes the card only once it
  holds that much of the text, since the request can reach it first (S96).
- **Queue, unqueue and a command are requests to the host, outside the
  card's own undo** (`moveCard`, and `request` with `set-command`): a
  card's box undoes only its text (ADR-0052). A queue and an unqueue are
  moves, so the host records them in the root's history of your moves, and
  the page undoes them, not a box (ADR-0066). An unqueue the host's take got
  to first is refused `gone` (S69, ADR-0059); `session.moves` holds the
  refusal, read by the column through `useSyncExternalStore`, until your
  next send, queue or unqueue in its lane, and the column says "already
  sent".
- **A card the host could not send** carries `unsent` until it is queued
  again; its editor's status says it (`cardStatus`).

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
  most 120 characters; a `grep` or `find` label shows its pattern and the
  path it searches (`subjectOf`, core). A cut label is shown uncut in its place while the row
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
- **The run button** shows above the composer: **Stop** while the thread's
  lane runs, sending `stop`; **Resume** while the lane may carry on after a
  stop (`carryOnState`, ADR-0082), sending `carry-on`. `columnView` decides
  it (`run`) and `runWords` words it. It is the column's, not a card's, and
  never shows read-only. The host records who stopped under the ask
  (`pineta.stop`, ADR-0056). The button is `.stop` or `.resume`: the
  browser suite reads `.stop` as "the lane runs" (`page.ts`), and a
  carry-on message's row is `.msg.carry-on`.
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
- **Where a new thread's agent works** (ADR-0032, ADR-0061). When a send would
  create a lane (it asks the agent where no lane is, or it is a branch), a
  line left of the button (`.where-line`) says where, in `whereWords`'s
  words, by what it does to your files: "works on its own copy · your files
  stay as they are ▾", "edits your files directly ▾" or "edits files in
  <dir> ▾". It opens a menu whose first section is `whereChoices`
  (`send.ts`): its own copy, your files, directories other lanes used, and
  "another directory…", each a name and what it means ("you review its
  work, then add it to the project", "it edits them directly"), the current
  one checked. Its own copy is disabled, with the project's reason, where
  the project cannot have one. For its own copy, and only when there are
  WIP bookmarks, a second section lists where the thread starts from
  (`baseChoices`): the project, then each WIP with how far it is behind the
  project; the line then names the WIP. The base is each editor's state, as
  the work choice is, and is sent with the chat. The choice is
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
  ("catch up with the project", "rewrite description"). What the lane runs
  now (`activityOf`: a turn, a resolution, or a split, from its latest
  prompt's role) comes first: while it runs, the line counts files so far
  and offers nothing. A lane that works directly says so ("edits your files
  directly"), and names other lanes running in the same directory now.
- **Catching up is a card queued at once** (ADR-0055, ADR-0061): the button
  is the `bringUpToDate` act, which creates a card at the thread's end with
  the command and no text, then queues it, two effects in that order. The
  host takes them in order, so the command is set before the queue's move
  starts the drain that takes the card. Your card in the composer is not
  touched. A card that carries a command anyway (one unqueued) says above its box what
  sending it does first (`commandNote`), its placeholder says its text is
  optional, and its button names the command (`commandSendWords`: "catch
  up", "catch up and send"), its queue place in the title. The card is
  then queued like any other (`planSend`, which carries the command), and
  the host carries the command out when it takes it.
- **Land, update, stack and carry-on messages** show as one line each,
  roles `land` ("catching up"), `update` ("caught up"), `stack` and
  `carry-on` ("resumed"). The update's line
  is `updateLine` (`@pineta/rules`), which names what it merged by
  `catchUpName`.
- **The page header counts offers open** in your repo ("work ready to add to
  the project"), as it counts mentions, and the agent's running threads;
  each row leads with the thread's name and opens its thread. Archive in a
  tab's `⋯` names the threads whose offers it withdraws (`offeredByRoot`,
  `dropsWords`). Both read `openOffers`, which keeps only `offerStatus`'s
  `open` (ADR-0067): one the line already holds (`held`) has nothing to
  add, so it is neither counted nor named, as the strip says.
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
  header's mark is `.thread-mark` (`.pulse` while its lane runs). The name
  has `aria-expanded`; open, the details are `.thread-details`, with
  `.thread-details-icon[data-spin]` around their mark,
  `.thread-details-started`, `.thread-details-where`,
  `.thread-details-working`, `.thread-details-behind` and
  `.thread-details-start`. The line is `.working-line`, and a row the work opened `.tool[data-revealed]`.
- **The invite key** needs no client code: the host's redirect sets a cookie
  that same-origin requests and upgrades carry. `connectSession({ key })` is
  for Node clients.

## Reviewing an offer (`review.ts`, `review-pane.tsx`, `use-fetched.ts`, ADR-0047)

The offer's line opens a review in the column's pane ("A column's pane",
below). So does an ask's file count (ADR-0056): every review is of spans
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
- **Every URL names its commits** (`reviewUrl`, `diffUrl`, `@pineta/rules`),
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

## A column's pane (`pane.ts`, `pane.tsx`, ADR-0078)

Beside the thread, a column has one pane, holding one thing at a time: the
offer's review, an ask's, a table from a message, or a stored image.

- **A subject is a name, never data** (`PaneSubject`): the offer, an ask by
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
- **Two frames, one breakpoint** (`useNarrow`, `NARROW`). Wide, the pane is
  `section.pane`, `.column`'s child after `.column-thread`. Under
  `NARROW_REM` (76rem, the 36rem margin plus the 40rem minimum of `.pane`'s
  `clamp`; `pane.test.ts` reads `index.html` to hold them together), it is
  `dialog.pane`, modal, portalled to `body`: the top layer covers every
  stacking context and makes the page inert. Crossing the line remounts it.
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

## The session (`@pineta/session`)

The page's one connection to a host is `SessionClient`, from
`@pineta/session`; its parts, and the order they are made in, are in
`packages/session/TECHNICAL.md`. `main.tsx` connects and hands its
`exchange` to `ExchangeProvider`, so React renders from the same connection.

## Drafting cards (ADR-0048)

What you type is a card: a record in the places document, which only the
host writes (ADR-0059), and a `TextDoc` of its own (`session.cardText`),
which this client writes. The page reads the records as `session.cards`; how
the session sends moves and draws them until its copy holds them
(`card-moves.ts`), and when it destroys a spent card's copy, is in
`packages/session/TECHNICAL.md`.

- **A move is planned once.** `planIntent` builds each `Move` with core's
  `moveOf` (an unqueue's target is `draftingOf`, a queue's root
  `queueRoot`), from the cards as drawn, and the session sends it.
- **Refusals are worded here** (`refusalWords`), from the session's
  `CardRefusal`: an unqueue the take beat says "already sent", a move
  someone made first names them. A column draws its own, and the panel the
  inventory's.

- **Where the column's cards are.** `Column` resolves its thread's end with
  `threadOf`, as a reply would go, and finds your card there with `yourCard`
  and everyone else's with `cardsAt("drafting", …)`. A fresh column's cards are found by
  its key (`CardPlace` `fresh`). So a tab switch, a reload or another device
  finds the same card: it belongs to the thread, not to the mounted column.
  Every card there but the one the composer shows is drawn above it: the
  composer reports its `EditorState` (`onShows`), and `shownBelow` decides
  which card that leaves out. So a card put where you already had one is
  drawn too, and once a send frees the box it takes your newest card there.
- **"+ card" empties the box for another card** (`blank`). It shows while the
  box is bound to a card with text, detaches and focuses the box, and moves
  no card, so it adds no history step. A blank box takes no card it finds:
  `card` is still your newest, so the editor reads only the card its state
  holds (`shownBy`), and `shownBelow` leaves nothing out, so the card set
  aside is drawn above. Typing creates a new card at the first input
  `needsCard` accepts, as from `local`; a send's settling returns the box to
  `local`, which takes your newest card here.
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
  with its size (`tokensOf`, four characters a token, as pi estimates),
  its status, **unpin** and **take**. It has no send: Enter is a new line.
  A drafting card's editor gains **pin**. Pin and unpin are moves
  (`planPin`, `planUnpin`, `card-intents.ts`), so the host records them and
  the undo key outside a box reverses them; `revealOf` shows a pinned place
  as a drafting one, at its thread's end.
- **A card's status is `pinnedStatus`** (`column-view.ts`): the card's
  entry in `pinnedDiff(pinnedInView(index, end), …)`, the walk and the
  comparison the host plans a run's entry from, so the strip and the run
  agree on what the agent read. A card with no text yet has none.
- **"+ pin" opens a box at the strip's end** that makes a pinned card. It
  is a `CardEditor` whose `place` is pinned (`drawnPlace(pinnedOf(…))`, `@pineta/session`):
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
  this client has it (`versionOf`, `@pineta/session`); the run waits for
  them.
- **The marker above a run's prompt** is `pinnedMarkers(index, nodes)`,
  computed in `MessageList` from the index: a node whose parent is a cards
  entry gets `pinnedMarker(entry, pinnedInView(index, parentOf(entry)))`.
  A cards entry and its prompt are written in one commit, so the prompt's
  parent is the only place to look. The marker draws "no longer applies"
  only when what the entry replaced was read by its own lane: a branch's
  first run retires its parent's cards, and its column draws nothing for
  that. A null marker draws nothing.
- **Selectors for the browser suite:** `.pinned-strip`, its
  `textarea[data-card]`, a drafting card's `.pin`, a pinned card's `.unpin`,
  `.pinned-status[data-status]`, and `details.pinned-read` just before its
  prompt's `.msg`.

## History and traces (ADR-0048 step 6)

- **Each card's editor has a history button** (`card-history.tsx`): the
  composer's, others' cards', and every `BoundCardEditor`'s (queued, pinned,
  the inventory's selected card). Its popover lists `historyWords` for each
  event, oldest first, then `writtenWords`, the card's writers, read only
  while it is open. A card someone other than its owner unqueued or
  unpinned says so beside its heading (`MovedBack`, `movedBackBy`).
- **They read by context, not props** (`CardHistories`): `App` reads the
  histories with the session's facts and provides them, the seats, the
  session and the reader, in one object kept while those are the same, as
  `pane-context.ts` does for a message. A prop would pass through five
  editors.
- **A column draws your traces at its thread's end** (`traces.ts`):
  `tracesAt` keeps yours whose place resolves to this end (`placeEnd`, as a
  card there would), `traceGroups` makes one line per person and verb
  (`verbOf`), and `traceWords` words it ("Bea queued this", "3 cards moved
  by Bea"). Only a column that can be written draws them: the Archive
  preview is a glance.
- **A click is `openTrace`** (`planOpenTrace`, `card-intents.ts`): the card's
  place now, as an undo's answer shows it (`revealOf`); a sent card's
  message; nothing for a card in someone else's inventory.
- **Seen is the host's.** An effect in `Column` sends `traces-seen` for the
  traces it draws, once each, while its `visible` state says the page can
  be seen (the read marks' condition, ADR-0077). The host deletes them; the
  column keeps drawing what it drew until it unmounts (`keptTraces`).
- **Selectors for the browser suite:** `.trace` (with `data-trace`, its ids)
  inside `.traces`; `.card-history-trigger`, `.card-history-box` and its
  `li[data-event]`; `.moved-back`.

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
  nothing. A card in your inventory marks nothing: the inventory is no tab.
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
`snapTo`, kept as a `deviceState`), holding a 3 × 6 grid of slots and the
selected card whole beside it (`BoundCardEditor`). Open or closed is `App`'s
state, never stored.

- **Two layers**: the host's records say which cards are in your
  inventory, and your inventory document which slot holds each. The session
  keeps the slots and repairs them (`packages/session/TECHNICAL.md`, "Your
  inventory's slots").
- **`settleSlots` is the one slot rule** (`@pineta/session`): the panel
  draws it (`inventoryView`, `inventory-view.ts`), the session's repair
  writes towards it, and a take lands by the same `firstEmpty`. `App`
  computes it once, with the takes in flight as intents (`intentsOf`), and
  both the panel and the intents read that.
- **The history of moves is the host's** (ADR-0066): one per person and
  root, which the host chooses for each move (`historyOf`). The page keeps
  none, and names no history when it moves a card. `undoMove` names the
  root of the tab you are on (`planUndoMove`: its `RootId` from the
  directory, `IntentState.rootEntries`, or a new tab's `fresh.root`); the
  Archive tab has none. The session sends `undo-move` and answers once its
  copy of the places reaches the reply's `rev` (`whenRev`).
- **The answer is planned afresh** (`undoAnswered`, `afterUndo`): each place
  a card went back to, once, brought into view (`revealOf`, `reveal.ts`):
  the panel, a thread's end through `openAt`, a fresh column's tab, or a
  closed fresh column opened again at the end of its root's tab from its
  place alone (`openFresh`: key, root, branch point). A refusal shows the
  card where it is now and says who moved it there. An undo shows its place
  as it acts, not before, and flies nothing: the reply comes after the copy
  already has the move.
- **A swap is undone by this tab's own stack** (the session's `swaps`)
  while the panel has focus (`keyAct`'s `inPanel`); one whose slot the
  repair changed since is refused, `slots-changed` (S90).
- **The grid's keys** step through it by `stepSlot` (`inventory-keys.ts`),
  stopping at its edges.
- **A card an undo puts back in your inventory takes its old slot while the
  repair has not cleared it** (`steadiness`), else the first empty one: the
  host knows no slots.
- **One landing rule** (`put-target.ts`). A put and a drop name a
  `PutTarget`: a column by key, or a slot. A column's place is its
  composer's (`composerPlace`, `column-view.ts`), which each writable
  `Column` publishes to `ComposerPlaces` as it renders; reading it redraws
  nothing. A drop target carries `data-put-column` (the column's
  `form.composer` and the cards above it) or `data-put-slot`, both written
  by `dropProps` and read by `targetOfElement`, so a drop lands exactly
  where a put can. A column's pinned strip carries `data-put-pinned`: it
  lands where the column's composer would create a card, pinned (`pinnedOf`),
  and a fresh column's strip, which has no thread, lands nowhere. A slot as the target swaps a card already in your
  inventory, and takes any other into that slot.
- **Take, put, keep, remove, select and undo are intents** (`intent.ts`,
  `card-intents.ts`), planned from `IntentState.cards` (`CardFacts`: the
  drawn cards, the lanes, the drawn slots, the selection and the composer
  places), carried out by `perform`. A keep sends one move of every card
  (`moveCards`), which the host accepts or refuses whole, `full` among its
  refusals, and closes the column once accepted (`afterKeep`).
- **Drag** is HTML drag and drop, not the column drag's pointer events: it
  crosses elements and tabs. A card's drag carries its id under
  `CARD_MIME`; its handle is its take button, or a slot. `App` listens on
  the document for `dragover` and `drop`; a drag held over a root's tab for
  `TAB_HOVER_MS` opens it. `NOT_A_HANDLE` includes `[draggable='true']`, so
  a card's drag never starts a column's.
- **Keys** (`inventory-keys.ts`, `keyAct`): one table, read by one
  `keydown` listener in `App` that decides nothing. Ctrl+Shift+I takes the
  focused card (`data-card` on the focused element, a box's included);
  Ctrl+Shift+O puts the selected one in the column whose element last held
  focus; Cmd or Ctrl with Z, Shift+Z, or Ctrl+Y undo and redo a move, only
  outside a text box, where the box's own text undo has them; arrows and
  `hjkl` move through the grid while the panel has focus.
- **A move flies** (`use-flight.ts`): `perform` measures the card's element
  before the move (`ports.fly`), and once it is drawn elsewhere that
  element animates from the old box. A take while the panel is closed opens
  it briefly.
- **Selectors for the browser suite:** `.inventory` (the panel),
  `.inventory .slot[data-slot][data-card]` and `.slot-line`, `.inventory
  .put`, `.inventory .remove`, `#top .inventory-toggle`, a card's `.take`, a
  message's `.take-copy`, and a fresh column's `.close-keep`,
  `.close-discard` and `.close-cancel`.

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
- **Presence is per seat** (`presence-seat.ts`, `@pineta/session`), so
  your tabs never overwrite or clear each other's; `core/presence.ts` shows
  each person once, and never you.
- **The host is found by principal** (`@pineta/session`): its seat is
  Kyneta's to issue.

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
- **A root tab's `⋯` and a tab's × are always rendered, hidden with
  `visibility`** except on the tab you are on, while hovered or focused, or
  (the `⋯`) while its menu is open (`Menu`'s wrapper, `.tab-more`, gains
  `open`). The menu is its child, so hiding the `⋯` would hide an open menu
  too. On a tab you are not on, both are absolutely placed over the label's
  end, so they take no width from a shrunk label. A browser check clicks a
  × on the tab you are on, or hovers first: Playwright waits on a hidden
  target until it times out.
- **The bar's bottom line is an inset shadow on `#top`**, which the selected
  tab's fill covers: a descendant's background paints over an ancestor's
  inset shadow. A negative bottom margin on the tab could not do it, since
  `.tab-list` scrolls sideways and so clips what hangs below it ("Anything
  that pops out of the tab bar", below).
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
  the one you are on has `aria-selected="true"` and its wrap
  `data-selected`, its × is the `.tab-close`
  after it, its `⋯` holds `.rename-root` and `.archive-root`, a root being
  renamed is `.tab-title-input`, Archive is `.tab-archive`, new tabs are
  `.tab-new`, and the add tab's buttons are `.add-agent`, `.add-menu` and
  `.add-conversation`. The Archive tab's `data-messages` is the session's
  message count; the browser suite's `countIsHosts` waits on it, and
  `connected` (`page.ts`) waits for `#tabs .tab-archive` with no
  `.sync-note`. In the header: `#top .here-person .here-trigger` per
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
