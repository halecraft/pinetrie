# ADR-0116 — A task is the board's card, and its canvas lays out what it holds as columns, in an order everyone shares

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/schema/TECHNICAL.md`
- **Evidence:** S141
- **Amends:**
  - ADR-0029: a task, not a root, is what opens; columns side by side need not
    share a root, and the rail draws a forest.
  - ADR-0122: the board holds tasks, and the sidebar your open tasks.
  - ADR-0111: a thread card is a thread, held by a task or an inventory; a
    text card on a board state starts a task.
  - ADR-0113: notes are in note columns, the task's; the notes board and the
    dock's notes line go.
  - ADR-0063: a root is the unit of storage, not of work; the host holds the
    roots of open tasks' threads.
  - ADR-0027: a task's order and its cards' widths are shared, in the
    document; folds stay view state.
  - ADR-0045: a title is a mark on the task.
  - ADR-0074: the model titles a task, from its first thread's first ask.
  - ADR-0121: a lane is told its task's canvas.
  - ADR-0048: a card can be pinned to a task, and read by every thread of it.
- **Amended by:**
  - ADR-0126: a task is a card, placed on the board, whose surface is its
    canvas; a column is how a card on a canvas is drawn, not a card; a text
    card dropped on a canvas lands in a note column made for it.
  - ADR-0137: a folded strip shows its thread's mark, and its name at the
    header's size and colour, in its thread's colour.
  - ADR-0138: the task column no longer has **+ note column**.
  - ADR-0158: the board's card is a canvas, not a task; topic and task are
    words for where a canvas is on the board; the task column is the canvas
    column, and its pinned cards are pinned to the canvas.
  - ADR-0164: a file card names a file of the project, the one source a host
    has, as accepted work holds it.

**Context.**

- **A root does five jobs at once.**

  | job | what it decides | where |
  |---|---|---|
  | context | what the model reads: the path to the root | the entry tree |
  | work item | workflow state, title, followers, archive | `pinetrie.board` by `RootId` (ADR-0122) |
  | view | which columns are seen together, the rail | the layout, per root (ADR-0029) |
  | storage | what is loaded, compacted, unloaded | `root:<RootId>` (ADR-0063) |

  and the host adds a fifth, one repo for every lane (ADR-0086). ADR-0029
  joined the first three on purpose: "tabs split the session where context
  splits". Context and work do not split in the same places.
- **What a person needs to see together is not one tree.** Two columns of
  one piece of work can be unrelated conversations. Some of what is needed
  is not a conversation at all: a mockup, a video, a file from another
  folder.
- **Work splits off.** Working on X, someone finds bug Y. A branch keeps the
  context Y needs, but stays in X's root, under X's place on the board. A
  new root gets its own place, and loses the context.
- **A column cannot show another root's thread.** ADR-0029 removed that
  case, since nothing then linked the two.
- **Notes belong to one thread.** A thread's notes board (ADR-0113) is a
  grid in its column's pane. Notes about the work as a whole, or about two
  threads, have no place of their own, and taking a thread away would take
  its notes with it.
- **Nothing shows a file.** A person sees a file only as a diff in an
  offer's review (ADR-0047), or through an agent.
- **Where a column sits is the reader's own** (ADR-0027). Beside notes, an
  arrangement says something ("the decisions are right of amber-fox"),
  which it cannot if everyone's differs.
- **The area a root opens into has no name.** The docs call it "the root
  you are on".

**Decision.**

*A task is the board's card.*

- **The board holds tasks**, each in one workflow state (ADR-0122). A
  task's place is keyed by its `TaskId`, which a client mints as it opens a
  new task, as it mints a `RootId` (ADR-0066).
- **A task's title is a mark on the task**, set as a root's is now
  (ADR-0045), and written by the model from its first thread's first ask
  when untitled (ADR-0074). Untitled, its label is its first card's.
- **The sidebar holds your open tasks**, in `open:<you>`, keyed by
  `TaskId`. The window's title names the task you are on.
- **A text card dropped on a board state starts a task there**, holding one
  new conversation thread whose first message is the card's text
  (ADR-0111). The undo key lifts it back into the card, and removes the
  task, while the thread holds that first message alone.

*Archiving is moving a task to the archive.*

- **The archive is the board's last workflow state**, always there, named
  Done in a new session and renamed as any state is (ADR-0122). A task in
  it is **archived**. "Closed" names it no longer: closing is what × does
  in the sidebar, for you alone.
- **Each thread it holds is read-only at its end**, its offers are
  withdrawn, and the host lets go of a root once no task outside the
  archive, and no inventory, holds a thread of it (ADR-0029, ADR-0061,
  ADR-0063).
- **Nothing moves out of an archived task**: a move is refused with
  "restore the task first". Copying a thread out works (ADR-0117).

*What a task holds.* Every card a task holds is shared: everyone sees the
same ones, in the same order. Its kinds:

| card | opened as a column, it shows | kept |
|---|---|---|
| **thread card** | a thread: its path, its dock, its offer (ADR-0117) | the entry tree, and its lane |
| **note column** | notes, one under another | its notes are text cards |
| **file card** | one file of a source (ADR-0118) | the source |
| **media card** | an image, a video, a piece of art | a blob by its SHA-256, as a pasted image (ADR-0042) |

- **A task holds no loose text card.** A text card is a note in a note
  column, your message, queued or pinned on a thread, or in an inventory.
- **Where a card is held is a place the host owns** (ADR-0059): in task T,
  at a rank. Putting a card in a task, moving it to another, and taking it
  out are handoffs, refused with where the card is now.

*Note columns.*

- **A note column is a card** a task or an inventory holds: a title, and
  its notes in one order, each a text card everyone in the task sees and no
  agent reads. Anyone moves a note within it with ↑ and ↓, as a queued card
  moves (ADR-0048), or to another note column.
- **A task has as many as its people make**, "Ideas", "Decisions". Side by
  side on the canvas they cluster notes, as the notes board's grid did.
- **A card leaving a thread's queue or pinned strip goes to the note
  column nearest the thread's column**, in the task's order; between two at
  the same distance, the one after it. With none, a note column titled
  "Notes" is made just after the thread. So does a card the host could not
  send.
- **The dock is the queue, the line and your message** (ADR-0113). The
  thread's notes board and the dock's notes line go.

*File cards.*

- **A file card names a source and a path**, and shows that file: markdown
  drawn, code highlighted, an image as an image.
- **Which version is the source's:** a live or a read-only source's file as
  it is on disk, updated as it changes; a branched source's file as
  accepted work has it (ADR-0100), updated as accepted work moves. A file
  card is no thread's, so it shows no thread's copy, and no one's working
  copy.
- **A file card cannot be edited yet.** A branched source's files change
  through a thread. A live source's could be edited, but a write from the
  page and a lane's write to one file would be last-write-wins, and on the
  Mac a lane's appends overwrite the Mac's (S141).
- **A file moved or deleted** keeps its card, which says so.

*The canvas is where a task opens.*

- **A column is a card opened on the canvas**, in the task's order. The
  order is the task's, the same for everyone: moving a card moves it for
  everyone, ordered by the host and undone by the undo key (ADR-0066).
- **A card's width is shared too**, one column or two, so a file card can
  be drawn wide.
- **Folding is yours.** A folded card keeps its place as a narrow strip
  with its title, so the arrangement reads the same for everyone. Scroll
  positions, density, the pane and whether a column is folded are view
  state, per browser tab, with the device's latest for a new one
  (ADR-0027, ADR-0058).
- **Where a new card lands:** a branch just after the thread it forks
  from; a new root, a moved or put card, at the end, or where it is
  dropped. A branch's column stays yours until its first send, as a fresh
  column is (ADR-0021).
- **Whatever is first reads as the trunk** (principle 3 of
  `docs/06-interface.md`), now for everyone.
- **The rail is a forest.** It draws one tree for each root that has a
  thread in the task, each cut to the paths that lead to the task's
  threads, in its root's palette (ADR-0089). A fork to a thread held
  elsewhere is a stub that names where it is.
- **"The shared part of paths is shown once"** holds among columns of one
  tree. A column whose parent thread is not on the canvas shows its path
  from the root, folded above its fork row.

*The agent knows what is on its canvas.*

- **At each run's start, a thread's agent is told the task's cards**, in
  order: each card's kind and title, who put it there; for a thread, its
  name and state; for a note column, how many notes; for a file card, its
  source and path, and whether this thread has that source. Not their
  contents, nor anyone's folds or inventory.
- **A change during a run reaches it as a fact line** ("Bea added
  mockup.png to the canvas"), as ADR-0080's do.
- **A card pinned to the task is read by every thread of the task on every
  run**, as a pinned card is read by its thread (ADR-0048). That is how a
  card's contents reach the agents: deliberately.
- **Reading any card on demand, and one lane writing to another**, wait
  for tools of their own.

**Consequences.**

- **The board, `open:` and the title marks are keyed by `TaskId`.** A
  store migration (ADR-0096) makes each root a task holding its threads,
  in the root's board place, ordered as its rail is. Each thread's notes
  become one note column beside it, in the grid's reading order, gaps
  dropped. Nothing else on screen changes until a task holds a second root.
- **The order of a task's cards is in the document**, as a rank per card;
  a column's width is the card's. A reorder is a command, as a board move
  is.
- **The notes board goes**, with its grid, its cells, its keys and its
  pane; the inventory keeps its grid.
- **A root is still the unit of storage** (ADR-0063), not the unit people
  work in. A client holds every root a thread of its task lives in: a long
  root with one thread here costs its whole document. Measure before
  splitting documents further.
- **Presence resolves a thread to its task**, and the inbox opens the task
  holding a thread, with that thread in view.
- **Board signals count a task's threads**: its ring, ⇡ and readers are
  those of the threads it holds.
- **The agent's prompt grows with the canvas.** The list is capped, its
  tail counted ("and 12 more").
- **A task can hold nothing.** Taking its last card leaves it on the board,
  empty, until someone archives it.
- **ADR-0029's "no view of the whole session" holds; its reason changes:**
  context still splits at roots, and tasks split where work does.
- **Deferred:** editing a file card; a file card on a thread's copy, which
  would belong to that thread; drawing a wide card on a narrow screen.

**Alternatives rejected.**

- **Keep the root as the work item, and let a column show another root's
  thread.** One piece of work would have two places on the board, and a
  reference is neither unique nor movable, the two things that make a card
  (ADR-0122).
- **A task holds roots, not threads.** Bug Y could not leave X's task
  without leaving its context behind.
- **A thread in several tasks.** Archiving freezes a thread's end, so its
  end needs one owner.
- **Notes kept on each thread's board.** Notes about the work as a whole
  had no place, and moved with a thread taken away. The grid's second
  dimension is the canvas's now: note columns side by side.
- **Loose text cards on the canvas, beside notes.** Two kinds of shared
  unsent text, with nothing to tell them apart.
- **Each reader's own order.** Notes placed beside a thread mean something
  only if everyone sees them there.
- **Everyone's folds shared.** Hiding what you are not working on would
  hide it from everyone.
- **A file card on your working copy.** Collaborators would see your
  uncommitted edits, and the host does not touch your files (ADR-0065).
- **A file card following a thread's copy.** The card is the task's, not
  a thread's; a thread's files are its offer's review.
- **Agents read the whole canvas.** Putting a card down would change every
  agent's context, unasked, and cost tokens in every run.
- **Agents told nothing of the canvas.** They could not talk about what the
  people beside them see.
- **Placing cards freely in two dimensions now.** Columns are the reading
  surface; "canvas" leaves room for more.
- **Other names.** "Workspace" is jj's (ADR-0032). "Desk", "case" and
  "spread" were weighed; "task" is plain, and sits near "ask" (ADR-0106)
  without meaning it: a task is a card, an ask a message and its run.
