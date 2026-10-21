# ADR-0206 — Topics and Active are marked states, and a canvas moves from Topics to Active when an agent first works in it

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `docs/06-interface.md`, `docs/glossary.md`,
  `packages/rules/TECHNICAL.md`, `packages/threads/TECHNICAL.md`,
  `packages/schema/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0158: a topic is a canvas in the state the workflow marks Topics,
    wherever that state stands; a task is a canvas in any other open state.
    Topics is no longer first by convention, and a topic now behaves
    differently: the host moves it to Active when an agent first works in it.
  - ADR-0122: the workflow marks two open states, Topics and Active, and a
    workflow edit moves either mark; the sidebar's ＋ puts a canvas at the end
    of Topics, wherever it stands.

**Context.**

- **Work stays in Topics.** Moving a canvas on the board is a person's
  move alone, and nobody makes it when the work starts: one board reads
  Topics 103, Active 2. The board does not show where the work stands.
- **Only the archive is a state of its own kind.** The workflow is its
  open states in order, then the archive (`Workflow`). Topics is the first
  open state by convention (ADR-0158), and Active is a name. A team that
  adds Next after Topics, as one has, leaves the second open state
  pointing at Next. A team that moves Topics to the right leaves new
  canvases starting in whatever state is now leftmost.
- **Rearranging is not work.** A thread's card can move from one canvas to
  another, or out of an inventory, with its lane. That changes where the
  thread is, and no agent has started anything.
- **A person's placement is a choice.** A canvas moved back to Topics by
  hand was put there on purpose. The host should not move it out again.

**Decision.**

*The workflow marks two states.*

- **A mark is the state's own**: an open state is marked Topics, marked
  Active, or neither. Exactly one open state is marked Topics, and at most
  one Active. The archive takes no mark. A state holds one mark at most,
  so the two never share a state.
- **A mark goes where its state goes**: renaming or reordering a state
  keeps its mark, and removing the state removes its mark.
- **A workflow is checked whole, once**: one constructor makes every
  workflow the host stores or plans, and refuses one without exactly one
  Topics. The workflow it makes names its Topics state and its Active state
  (`Workflow.topics`, `Workflow.active`), so no reader looks them up.
- **A new session marks Topics and Active**, its first two open states.
- **A team moves either mark to another open state**, by one workflow edit,
  from a board column's ⋯, or unmarks Active. A mark is refused on the
  state holding the other.
- **The state marked Topics is not removed** until its mark moves, as the
  archive is never removed. So the board always holds an open state, and
  that rule needs no refusal of its own. Removing the state marked Active,
  once it holds no canvas, leaves Active unmarked.

*What a canvas is reads the marks, not the order.*

- **A topic is a canvas in the state marked Topics**; a **task** is a
  canvas in any other open state, left of Topics or right of it; an
  archived canvas is in the archive.
- **A canvas in a state the workflow no longer holds is read as in
  Topics**, and drawn at the end of it.
- **The sidebar's ＋ puts a new canvas at the end of Topics.** A board
  column's ＋ still puts it at the end of its own column.
- **Restore moves an archived canvas to Topics**, wherever Topics stands.

*The host moves a canvas once, when an agent first works in it.*

- **A canvas's card stores whether its state has changed**
  (`stateChanged`): false when it is made, set by any move between states, a
  person's or the host's. A reorder within a state leaves it. An undo
  restores the card as it was, this flag with it: an undone move never
  happened.
- **When an agent's run starts in a thread whose card is on a canvas, the
  host moves the canvas to the end of Active**, if the canvas is in Topics,
  Active is marked, and the canvas's state has never changed. Every run counts: a
  person's send, a chat whose agent is asked, a carry-on after a Stop, a
  queued card drained, an ask relayed from another thread's agent. A run
  resumed at the host's start does not: it goes on with work that started
  before.
- **The host's move is its own write**: it is in nobody's stack of moves,
  and the canvas's history says the host moved it. It sets `stateChanged`, so the
  host never moves that canvas again. Moved back to Topics by hand, a
  canvas stays there until someone moves it out.

*A session made before this.*

- **A migration marks the states and clears every canvas's flag**: it
  marks Topics on the open state named Topics, or the first open state
  when none is, and Active on the open state named Active, if there is one. Every canvas's card gets
  `stateChanged` false.
- **Nothing is moved by the migration.** A topic whose threads an agent
  worked in before moves at its next run.

**Consequences.**

- **Topics holds what no agent has worked in**: chats, and ideas not
  started. A new canvas opens with `@agent` typed, so its first Enter moves
  it to Active, and its history holds two events: made in Topics, moved by
  the host.
- **A canvas can go to Active with nobody in it writing**, when another
  thread's agent asks one of its threads.
- **The undo key can make a canvas eligible again**: a person's first move
  out of Topics, undone, clears its flag, and the next run moves it.
- **Two stored shapes change**, the workflow and a canvas's card content, so
  the migration rewrites both (no backwards compatibility).
- **A team that unmarks Active turns the move off.** With a single open
  state there is nothing to mark Active.
- **The board column's ⋯ grows**: it offers each mark, worded in the plan.
- **"The board needs one open state" is no refusal of its own any more**:
  the last open state is the one marked Topics, which is not removed.

**Alternatives rejected.**

- **Moving at the lane's making**: a lane is made by a first send, but a
  thread's card moved onto another canvas carries its lane there, and
  rearranging is no work. A run starting is the work.
- **A rule held always**, that a canvas an agent worked in is never in
  Topics: it overrides a person who put it back on purpose.
- **Moving once per lane, or per run**: each new lane or run would undo a
  person's placement.
- **Deriving "its state never changed" from the card's history**, whose first event is
  always kept: correct, but indirect, where one stored boolean says it.
- **The flag in a session record of its own, per canvas**: undo would not
  restore it, but it is a second write beside the card's, and a record left
  behind when the canvas goes.
- **Active as the open state after Topics**: on a board with Next, the
  host would move work into Next.
- **Active by its name**: names are renamed and may repeat.
- **Active as the last open state**: a team that adds Review after Active
  would get its work moved into Review.
- **Topics as the first open state, as before**: a team that moves Topics
  would have canvases start, and be called topics, in another state.
- **Moving the past's topics at the migration**: the move is about work
  starting, and it starts again at each topic's next run.
- **The host's move in the sender's name**: it would be in their stack of
  moves, and their history would say they moved a canvas they only wrote
  in.
- **The marks as two state ids beside the states**: every edit would have
  to keep them naming open states, and apart, and a removal would have to
  clear one. On the state, the shape holds most of that, and one check
  holds the rest.
