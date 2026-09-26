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
