# ADR-0028 — Pieces of work: any message can start one, and everyone sees the same boundaries

**Status:** Proposed. Amends ADR-0027 (what a stored layout holds). Builds on
ADR-0021 (threads are topics inside a session), and ADR-0023 and ADR-0025
(host-written records, and Yjs where people type together). Amended by
ADR-0029: marks stay inside a root, and focus, its breadcrumb and
the whole-session rail sections are withdrawn, along with this ADR's change
to ADR-0027. Amended by ADR-0045: a mark's record is keyed by its entry and
holds a title only; a root's mark titles its tab; the rest is deferred.

**Context.** People use one session for several separate pieces of work, and
start each one where it belongs: a new thread at the root, or a branch off any
message. The rail draws every tree in one column, one after another, with
nothing between them. `projectRail` starts each tree's tracks again at 0, so
every root thread's trunk has the same colour, and colour is the only link
between the rail and the columns (`docs/06-interface.md`). Nothing on screen
says which tree a column belongs to. Grouping by root thread would not fix
this. A branch off message 40 can be as separate a piece of work as a new root
thread, and a root thread is not special (ADR-0021). The steps that cost
something, asking the agent and later a workspace (ADR-0021's table), do not
mark where one piece of work ends and another begins. Nothing records that
boundary, and collaborators need to see the same one.

**Decision.**
- **A mark starts a piece of work at a message, and the piece of work holds
  that message's subtree.** Any message can carry a mark. A message belongs to
  the piece of work of its nearest marked ancestor, itself included. That
  change of membership at a mark is the piece of work's boundary: focus, the
  rail's sections, presence and lanes all follow it. A pure function in
  `packages/core` derives membership when it is read; it is never stored.
- **Marking and branching are independent.** Starting a branch does not start
  a piece of work, and marking a message does not start a branch. An unmarked
  branch belongs to the piece of work above it.
- **Pieces of work nest.** A mark inside a piece of work starts a new one
  there, and that message's subtree leaves the outer one. The session is the
  outermost piece of work: a message with no marked ancestor belongs to it, so
  a thread at the root is no different from one anywhere else.
- **A mark has two optional fields, a name and a description.** Every column
  header holds a place for the mark of the column's first message, filled or
  not. An empty mark is only that place: it is not stored and draws no
  boundary. Typing into either field for the first time makes the mark real.
- **Inside a column, a mark is a section header, and needs a name.** Between
  two messages, a rule appears on hover. Naming it marks the message below it,
  and the rule becomes a section header that sticks to the top of the column
  while its section scrolls. Without a name, a section header would show
  nothing. Which message is a column's first depends on the columns to its
  left, so one mark can be a header in one layout and a section header in
  another; the host checks no position, and the record's name stays optional.
- **A label with no name is computed when drawn,** from the description's
  first line, else the opening words of the marked message. Nothing is stored.
- **The record is a host-written `pineta.work` value, keyed by its own id,** as
  a note's is (ADR-0025). It holds the marked message, the name if any, its
  state (`marked` or `unmarked`), who marked it, and when. Clients mark,
  rename and unmark with commands over the Line, and the host writes the
  record. A message carries at most one mark: marking it again returns the
  existing record. The last rename wins; nobody types a name together, so it
  needs no CRDT (ADR-0023).
- **The description is a Yjs document per mark (`work:<id>`).** People edit it
  together, with edits attributed from their `clientID`s and `editing`
  presence as for notes (ADR-0025). The column header shows its first line;
  the whole editor opens over the columns, as the notes index does. The host
  accepts writes to it while a record names it, whatever the record's state,
  because a refused write cannot be recovered from (S28). This is its own case
  in `acceptsWrite`, apart from notes. A description is not a note: a note is
  a message opened for editing or a draft of the next one, and a description
  is neither.
- **Unmarking is its own action, and removes only the boundary.** Emptying
  both fields does not unmark: the boundary would then depend on the
  description document's text, and drawing the rail would mean opening every
  description (ADR-0025 turned down that cost for notes). The record stays, in
  state `unmarked`, with its name and description; marking the same message
  again brings them back. The tree is untouched.
- **A fresh column's header can be filled before its first send.** A fresh
  column writes nothing until then (ADR-0021), so what was typed waits in the
  column. Once its first message is written, the column marks it with the
  name and then writes the description into its document, so the description
  is attributed to its writer as any edit is.
- **Marking is free, and is not a step up.** It spends nothing and stores only
  the record. A piece of work shows the lanes in it, and later their
  workspaces (ADR-0019), but does not own them. A lane is in the piece of work
  that holds its tip.
- **Which piece of work you look at is yours.** Focusing on a piece of work is
  view state, never in the document. It is not the focused column ADR-0024
  rejected: every open column still reports its thread. ADR-0027's stored
  layout gains the focused piece of work, under a new version, so layouts
  stored before this are dropped once. With nothing stored, you see the whole
  session: no focus, every open column whole, and marks shown as headers and
  section headers. A stored focus whose mark is gone, or unmarked, falls back
  to the whole session, checked after `whenSettled`, as missing anchors are.
- **A focus shows every column with messages in its piece of work, cut at the
  piece's boundaries.** Past a boundary, a column shows one labelled line:
  above, the path it reads ("reads 3 messages above"); below, where it goes
  ("continues in: Refactor"). A nested piece of work that starts at a branch
  shows as its fork dot and a collapsed row on the rail. The open columns are
  one list: a focus filters it, so focusing on another piece of work hides
  columns rather than closing them, and the whole session shows them all
  again.

**Consequences.** The rail's whole-session view draws each top-level piece of
work as a labelled section. Focused on a piece of work, the rail draws its
subtree, each nested piece of work collapsed to one labelled row, and one line
above for the path it reads, which opens on demand. `docs/06-interface.md`
needs rewriting for the rail, the column header, section headers and focus.
Who is in a piece of work follows from presence's `reading` keys (ADR-0024),
with no new field. Marking a message moves every lane whose tip is below it
into the new piece of work, and unmarking moves them back; neither writes to a
lane (ADR-0020). Every description is a Yjs document, never compacted
(S24); descriptions are short, so the cost is small beside queued
notes (ADR-0026). The agent reads neither the name nor the description. An
agent updating a description later needs no change to the record or the
document, since the host can write the document as it seeds a note; when the
agent does so, and how its edit meets people typing, is left for later. The
hover rule and the description editor are reachable only by pointer for now;
keyboard access and touch are a later step. Reusing track colours across trees
is a separate fix, and this ADR does not depend on it.

**Alternatives rejected.** Root threads as the unit (a branch can be as
separate, and roots are not special). Marks kept in the browser (collaborators
would each draw their own boundaries). A piece of work per lane or per
workspace (a conversation can be a piece of work, one piece of work can hold
several lanes, and a tidy screen would cost disk). Separate sessions (a
session is who is in it, ADR-0021, and a branch reads the messages above it).
One rail per root thread, side by side (the gutter widens with every root
thread, and the rails still sit apart from their columns). Every thread its
own piece of work (every aside would split off, and a piece of work could not
span a thread and its branches). Marks only at a thread's first message (work
that drifted partway down a thread could not be marked where it began). A name
required on every mark (someone who would rather describe than label must
invent a title). A stored default name (it would read as chosen). Unmarking by
emptying both fields (the boundary would live in the description's text). The
description as a note (a description is not a message, and is never sent).
The name in the Yjs document (nobody types it together). Deleting the record
on unmark (the description would be lost).
