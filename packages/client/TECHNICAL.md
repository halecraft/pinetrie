# `@pineta/client` — technical notes

The browser interface: a rail beside a strip of columns (`docs/06-interface.md`).
Everything drawn is a read of the session document through `projection.ts`;
the only state kept here is which columns are open, and the text being typed.

## Reads go through one index

`readTreeIndex(doc)` (`@pineta/reads`) builds `indexTree` once per document
change. The columns, the rail and the agent's path all read that one index
(`packages/core/tree.ts`). `App` reads it inside a single `useTracked`, together
with the agent's activity, the lanes, the outbox and the participants, so they
are always from the same moment; `sync` takes the index and the lanes together.

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
- **A null anchor** is a new session's first column. `sync` pins it to the
  newest leaf once one exists, then it follows as above. While the session is
  empty it offers **Start Chat** and **Start Agent** (`start.tsx`) in place of
  a composer; choosing replaces it with a fresh column at the root.
- **A fresh column** (`openFresh`: `→`, the rail's `+`, a start, or "Branch
  here" after a conflict) has nothing of its own yet. Its first send mints the
  command's id (`sent`), which the host stores with the message (`sendId`), and
  `sync` anchors the column at the entry that send wrote (`TreeIndex.bySend`).
  Exact: no other message at the same point, the lane's own next append
  included, can be mistaken for it. "Branch here" opens one holding the text
  (`pending`), and that column's composer sends it, so a refusal shows where
  the message is, like any other send.
- **`→` at a column's end only in agent work.** Below a conversation's last
  message, a branch would be the same as replying. At an agent thread's end
  it steps back down to a conversation (ADR-0021).
- **`asksAgent`** is a Start Agent column: a message with no mention asks the
  agent, as if `@agent` were written, until the thread has a lane of its own.
- **Deduplication is the shell's.** Two anchors can resolve to one path, which
  the reducer cannot see. Before opening, `App` checks whether any open column
  already shows the entry, and scrolls to it instead.
- **Open columns are never written.** Which paths a person reads is theirs.

`projectColumns` shows each column only past the deepest message it shares
with ANY column to its left, so a shared stretch of paths is drawn once, in the
leftmost column that shows it. Anything looking for a message on screen (the
rail's scroll-to, the alignment) must search every column.

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

Each column scrolls on its own, its composer at its foot. The **only**
imperative layout code is `alignOnOpen` in `app.tsx`: when a column first
appears, it scrolls the column (or grows a spacer above its first message) so
that message is level with its fork point in the column showing it. After that,
columns scroll freely. A shared vertical scroll was tried in design and
dropped: forks far apart could not be seen together (`docs/06-interface.md`).

`Column` keeps itself at the bottom as messages arrive only while the reader is
at the bottom; once they scroll up, it leaves them there.

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
  written, and each running tool's output, kept scrolled to its end. A reply's
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

- **Every open column is reported,** since there is no focused column: `App`
  writes each column's thread end when it changes, deletes a closed column's
  key, and refreshes all of them every 10 s while `document.visibilityState` is
  `visible` (a `visibilitychange` listener refreshes on return). Typing is
  written at most once a second.
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
- **The notes index** is `notesIndex` (`@pineta/reads`) over the records, drawn
  from the rail's top; each row reads its note's first line on its own.
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

## Names

A message keeps the name its writer had when they sent it: that is what the
agent read, and rewriting it would change history the agent has seen, and the
provider's prompt cache. The screen shows the writer's current name, with the
name the message was sent under in parentheses when they differ
(`speakerLabel`, `names.ts`): "Duane (guest-x4bu)". Each rendered chat carries
its `writer` for the lookup.

## Gotchas

- **Message tools are hidden until hover or focus**, the margin `→` too. A
  browser test must hover a message before clicking its `.tools` buttons or
  its `.branch`.
- **Stop aborts a running command only once the command has started.** With a
  slow model, the tool call itself streams first; a check waits for the live
  tool row before clicking Stop, as a person would.
- **`:last-of-type` matches element type, not class.** The "agent
  joined" marker and the stream are `div`s too; find a column's last message by querying `.msg`.
- **The agent's stream renders only in a column containing its tip.** When no
  open column does, the rail's pulse is the only sign, and clicking it opens
  that thread.
