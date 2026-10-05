# ADR-0029 — A tab per root, an archive shared by everyone

**Status:** Accepted. Implemented by `PLAN-2026-09-27-root-tabs`. Evidence:
S30, S31. Amended by ADR-0030: the tab bar is each person's, and a
tab closes for you; and by ADR-0045: a root's label is its mark's title,
else its first message's first line; and by ADR-0063: the archive record is
keyed by the root's `RootId`, and the Archive tab searches labels only. Amends ADR-0027 (a stored layout holds a
tab and columns per root), ADR-0028 (marks stay inside a root; focus is
withdrawn), ADR-0021 (where Start Chat and Start Agent live) and ADR-0024
(which columns report presence).
Amended by ADR-0061: archiving a root withdraws its threads' offers from
your repo, and restoring builds them again.
Amended by ADR-0068: a track is a branch's colour, by creation order, not
its place on the rail.
Amended by ADR-0081: the tab bar is the header, and the tab you are on is
drawn as part of the page.
Amended by ADR-0085: the tab bar becomes your list down the left, and the
Archive tab the board; archiving is moving a root to the closed workflow
state, whose place replaces the archive record.

**Context.** The rail draws every tree in one strip, one after another, and
columns from different trees sit side by side. `projectRail` starts each
tree's tracks again at 0, so trunks share a colour, and a column on another
root has no fork dot and no header stripe: nothing on screen says which tree
it belongs to. ADR-0028 answered with marks and a focus. A root is a stronger
boundary than a mark, though. A column's context is its path to its root, so
nothing in one root is ever in the context of another, while a branch off
message 40 reads the 39 above it. Roots also only accumulate. Nothing marks a
root as finished, so the rail grows with every thread anyone has started, and
there is no way to put one aside, or to take it back.

**Decision.**
- **Each root has a tab, which shows only that root's tree:** its rail, and its
  columns. Every column in a tab shares the root, so each column after the
  first has a fork point, and colour always links a branch to its parent.
  Tracks start at 0 in each rail. An orphan counts as a root, as it does on
  the rail today.
- **The tab bar is the same for everyone:** every root that is not archived,
  in creation order (id order, S9). Which tab you are looking at is yours.
  A root someone else starts appears as a tab and does not take you there.
- **Archiving hides a root for everyone, and deletes nothing.** The record is
  a host-written `pineta.archive` value keyed by the root's entry id: its
  state (`archived` or `restored`), who changed it and when. Clients archive
  and restore with a command over the Line. Anyone can do either. Entries are
  immutable (ADR-0004), so archiving touches no entry.
- **An archived root is read-only until it is restored.** The host refuses
  commands that would write in it: a message attached there, a note opened,
  drafted, sent, marked done or reopened there, a reference written there, a
  mark (ADR-0028). A reference is written where its author reads, so one
  written in an open root that cites an archived message is accepted. The host does
  not refuse writes to Yjs documents (notes, descriptions) because their
  message is in an archived root: a refused write cannot be recovered from
  (S28). The screen offers no editor there.
- **Archiving is refused while any lane in the root runs or has messages
  waiting** (ADR-0020, and queued notes, ADR-0026). A lane is in the root that
  holds its tip. Stopping the run or holding the queue instead would do work
  nobody asked for. Refusing leaves the choice with the person.
- **Commands race in the host's serial executor.** A message that arrives
  after the root was archived is refused, naming who archived it, and its
  composer keeps the text, as it does after a conflict.
- **The Archive tab is the leftmost tab,** and it works differently: a list,
  not a rail with columns. It lists every root, open or archived, with its
  label, last activity, who wrote in it, its message and note counts, and its
  state. It filters by state and to roots you wrote in, and searches message
  text. Selecting a row shows that root's rail and one read-only column.
  **Restore** puts the root back in the tab bar and switches to it.
- **The add tab is the rightmost tab,** a split button: **＋ agent** as its
  main action, and **conversation** in its menu, since a conversation at the
  root is the rarer start. It replaces the rail's `+` and the Start Chat and
  Start Agent buttons; what each does is ADR-0021's, unchanged. A new tab is
  local until its first send, like any fresh column: only its opener sees it,
  it sits beside ＋, and closing it leaves no trace. Its first send makes the
  root, and the tab joins everyone's bar.
- **Marks and branches stay inside their root** (amends ADR-0028). A marked
  branch never becomes its own tab: it reads the messages above it, and a tab
  of its own would hide them. ADR-0028's focus, its breadcrumb and its
  whole-session rail sections are withdrawn. Tabs split the session where
  context splits, and marks name the work inside a root. There is no view of
  the whole session.
- **A tab shows what a whole-session rail would have shown:** a pulse while a
  lane in the root runs, and who else is reading there (presence `reading`,
  ADR-0024, resolved to its root). Unread marks follow when presence has a
  last-read position.
- **Only the tab you are on reports presence** (amends ADR-0024): its columns
  report the threads they follow, and switching tabs clears the last tab's
  reports. Columns in other tabs are kept, not read, so reporting them would
  put you in every tab you have ever opened.
- **The layout is kept per browser tab, with one layout per root** (amends
  ADR-0027): the active tab, and each root's columns. Archived roots' layouts
  are kept, so restoring a root brings its columns back. A layout stored before
  this change fails to decode and is dropped once.
- **"Root tab" in docs and code.** "Tab" alone already means a browser tab
  (`tab-state.ts`, ADR-0027). On screen, a root tab shows only its label.

**Consequences.** `docs/06-interface.md` gains a tab bar, the Archive tab and
the add tab, and its rail becomes one root's. The special case of a column on
another root goes, and so does the colour repeat between trees that ADR-0028
cites; colours can still shift inside a tree as it grows. The notes index
counts the tab's root; searching across roots is the Archive tab's job. A
root's label is its first message's text until a mark names it (ADR-0028). If
someone archives the root you are looking at, the tab stays while you are on
it, read-only, saying who archived it, with **Restore**; it leaves the bar when
you switch away, and after a reload you land on the newest open root, or on
the Archive tab if there is none. References show only as counts: the link
between columns that `docs/06-interface.md` describes was never built, and
this ADR adds none across roots. What carries something from one root to
another is the inventory planned with fold (`PLAN-2026-09-27-fold`). Picking
up writes nothing, so it will work in the Archive tab's preview too, and what
is picked up there is cited or folded into an open root. A fold from another
root cannot be drawn as a rail edge, since each rail is one root's, so its
fold row will have to name and link its source instead. With many roots open, the tab bar scrolls; Archive and
＋ stay put. On a narrow screen, the tab bar becomes a switcher above the
stacked columns. The Line gains a command and two outcomes, which changes the
schema of stored Lines; a store written before still opens and serves (S31).
Clients and host ship together.

**Alternatives rejected.** Tabs each person opens and closes (a collaborator's
new root would not reach you, and the Archive tab would become an inbox).
Every root always a tab (the bar grows forever). A per-person archive (people
sharing a session would each tidy their own bar, and would disagree about what
is current). Replying in an archived root to restore it (work would come back
without anyone deciding it should). Archiving that stops the agent or holds its
queue (it does work nobody asked for). Suggesting, or automatically archiving,
roots idle for a long time (not now: a person decides what is finished).
Deleting archived roots (entries are immutable, and archiving by mistake must
be undoable). Archiving a branch inside a root (closing its column already
hides it from one reader, and it stays on the rail). A marked branch as its own
tab (it would hide the context it reads). A whole-session view beside the tabs
(the tabs carry its signals). One rail per root, side by side (ADR-0028: the
gutter widens with every root, and the rails sit apart from their columns).
A separate session per root (a session is who is in it, ADR-0021).
