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

## Root tabs and the layout (`layout.ts`, ADR-0029)

The layout is `{ active, roots, newTabs }`, and `layoutReducer` is pure. A root
tab's key is its root entry's id: a thread started at the root is rooted at
its first message (S30). `summarizeRoots`, `openRoots`, `rootWork` and
`rootReaders` (`packages/core/roots.ts`) say what the bar shows.

- **`active` is null only before the first `prune`.** A browser tab with
  nothing stored has not chosen a tab, and the document has not arrived.
  `App` draws "connecting…" meanwhile. `prune`, once after `whenSettled`,
  chooses the newest open root, or Archive when there is none, and replaces a
  stored active root that is gone or archived. No action sets it back to null,
  so a root someone starts later never moves you: resolving null at each
  render did, in the plan's first draft.
- **An archived active root stays active** until you switch or reload, and
  `tabBar` keeps it in its place. Its columns are drawn with `readOnly`: the
  composer stays mounted, disabled, so what was typed survives; Restore brings
  it back in place.
- **`columnsOf` is the one place a root gets its first column**
  (`first-<root>`, anchored at the root). `columnsReducer` may leave a root
  with none; the layout then deletes the entry.
- **Column keys hold no `:`.** A presence key is `${writer}:${columnKey}`, and
  `readPresence` takes the writer from before the last colon. A colon in a
  column key makes your own column read as someone else.
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
  Exact: no other message at the same point, the lane's own next append
  included, can be mistaken for it. "Branch here" opens one holding the text
  (`pending`), and that column's composer sends it, so a refusal shows where
  the message is, like any other send.
- **`→` at a column's end only in agent work.** Below a conversation's last
  message, a branch would be the same as replying. At an agent thread's end
  it steps back down to a conversation (ADR-0021).
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

## Kept per tab (`tab-state.ts`, ADR-0027)

`tabState` keeps a value under one key in two slots: the tab's
(`sessionStorage`), read first, which survives a reload; and the device's
(`localStorage`), which a new tab starts from. It knows nothing of Pineta; a
value's stored form is its codec's. The layout is its one use, under the key
`pineta-columns:<session>`, which predates root tabs.

- **Every change is saved, `sync`'s too.** Saving only what a person does
  would store older anchors, and `followTip` from an older anchor can land on
  a newer branch below it. So with two tabs open, the device slot holds
  whichever changed last: both move their columns as messages arrive.
- **The codec is the edge** (`encodeLayout`, `decodeLayout`), in the house
  shape: a TypeBox schema, then a build step field by field. A layout decodes
  whole or not at all, and `v` rejects an older one: `v: 1` (a column list,
  before root tabs) is dropped once and overwritten by the first save. A lane that is not a lane
  name is left off; `sync` binds the column again.
- **`fresh.pending` is never stored**, by either side: restoring it would send
  its message again. A "Branch here" column comes back empty.
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
  guarded: where storage is disabled, touching it throws, and
  `persistentPeerId` does so first.
- **In the browser suite,** the main page comes from `browser.newContext()`.
  A page from `browser.newPage()` owns its context, and Playwright refuses a
  second tab in it; each `browser.newPage()` is a new context, with storage of
  its own.

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
  callback.

## Threads, lanes and the composer (ADR-0020)

- **The agent can reply in several threads at once**: `readAgentActivity`
  returns every running lane. The rail pulses at each tip, a message is lit if
  any run reads it, and each column streams the runs whose tip is on its path.
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

## Tools and live work (ADR-0022)

- **A tool call is a row under the agent's message** (`ToolRow` in
  `message.tsx`): its label (`toolLabel`), ✓, ✗ or …, and its result folded in
  a `<details>`, capped for display. A result is its own entry in the tree;
  `projectSpine` pairs it with its call on the same path, so it adds no column
  row and no rail dot. A message that only called tools shows only its rows.
- **Live work is one component** (`Streams` in `column.tsx`), reading
  `readStreams` for the lanes running on the column's path: the reply as it is
  written, and each running tool's output, following its end as a column
  does. A reply's
  stream closes when its message ends, which a fast model can do between two
  renders, so a check that must see one uses a slow scripted model.
- **Stop** shows in the composer while the thread's lane runs, and sends
  `stop`.
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
- **A tab's avatars** are `rootReaders`: others' thread ends resolved to their
  roots.
- **`presenceView` (core) decides everything shown**, from `readPresence`
  (`@pineta/reads`) and the tree: rings (`readingAt`), a header's avatars
  (`seenBy`, others whose thread end lies on one path with this column's), and
  typing (`typingAt`). It always leaves you out.
- **A person's colour** (`presenceColors`): the first three people, in the
  order they first wrote (`writerOrder`, the same in every window), get
  magenta, white and yellow, far from each other and from the tracks; anyone
  later, a hue from their writer id at a saturation the tracks don't use. A
  ring on the rail has a dark gap between it and the dot, so it reads against
  any track.
  Names go through `displayName`, the `guest-…` fallback included.

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

## Who a tab is

A tab's peer id comes from Kyneta's `persistentPeerId("pineta-peer-id")`, as
Kyneta's examples do. A reload keeps it, so a person keeps their name and is
not shown to themselves as someone else while the old entries decay. The first
tab open on a device takes the device's stable id; a tab opened alongside gets
a fresh one, so two windows are two people. The writer id is `w-` and that id.
Except a duplicated tab: browsers copy `sessionStorage`, so Duplicate Tab gives
two live tabs one peer id, and one writer (S29). That is Kyneta's to fix.

## Names

A message keeps the name its writer had when they sent it: that is what the
agent read, and rewriting it would change history the agent has seen, and the
provider's prompt cache. The screen shows the writer's current name, with the
name the message was sent under in parentheses when they differ
(`speakerLabel`, `names.ts`): "Duane (guest-x4bu)". Each rendered chat carries
its `writer` for the lookup.

## Gotchas

- **Selectors for root tabs:** a root's tab is `#tabs .tab[data-root="…"]`,
  the one you are on has `aria-selected="true"`, Archive is `.tab-archive`,
  new tabs are `.tab-new`, and the add tab's buttons are `.add-agent`,
  `.add-menu` and `.add-conversation`. The rail is `.rail`, not `#rail`: the
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
