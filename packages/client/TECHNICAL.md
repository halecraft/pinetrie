# `@pineta/client` — technical notes

The browser interface: a rail beside a strip of columns (`docs/06-interface.md`).
Everything drawn is a read of the session document through `projection.ts`;
the only state kept here is which columns are open, and the text being typed.

## Reads go through one index

`readTreeIndex(doc)` builds `indexTree` once per document change. The columns,
the rail, thread rules and the agent's path all read that one index
(`packages/core/tree.ts`). `App` reads it inside a single `useTracked`, together
with the agent's activity and the thread rules, so they are always from the
same moment.

## The column model (`columns.ts`)

A column is `{ key, anchor, exclude? }`, and `columnsReducer` is pure: keys come
from the shell in the action, so the reducer has no hidden counter.

- **A column follows its own tip.** `sync` runs on every change and advances
  each anchor to `followTip(anchor)`. A reply below a column's last message
  moves it on; a branch off an earlier message, however new, never does.
  Following from a fixed anchor instead would jump to any newer branch below
  it. `followTip` follows **leaves**, not lane tips, because the agent's lane
  leaves a thread whenever another thread compels it (ADR-0018).
- **A null anchor** is a new session's first column. `sync` pins it to the
  newest leaf once one exists, then it follows as above.
- **A fresh branch** (`branch from here`) is `anchor` plus `exclude`, the
  anchor's children when it opened. It follows only leaves reached through a
  new child, so it stays empty until its first message exists; then `sync`
  anchors it there and drops `exclude`. A `started` reply carries no entry id,
  so this is how the column finds its own branch.
- **No branch from a column's last message.** A message there is a child of the
  column's tip, which the column itself follows, so a fresh column would be
  left empty. The action is not offered; the composer replies there.
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

## Gotchas

- **Message tools are hidden until hover or focus.** A browser test must hover
  a message before clicking its `.tools` buttons.
- **`:last-of-type` matches element type, not class.** Rule markers and the
  stream are `div`s too; find a column's last message by querying `.msg`.
- **The agent's stream renders only in a column containing its tip.** When no
  open column does, the rail's pulse is the only sign, and clicking it opens
  that thread.
