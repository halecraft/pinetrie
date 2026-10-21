# ADR-0113 — A card below the line is a note, on the thread's notes board; a column's dock holds what the agent does next and the message you are writing

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`
- **Amends:**
  - ADR-0048: a card below the line is a note, laid out on its thread's notes
    board, a shared grid; a composer shows only its owner's card; "add to
    queue" on an idle thread holds the queue, and a send from the composer
    releases it.
  - ADR-0111: the drafts leave the column for the notes board; the column's
    foot is a dock of the queue, the line and your message, whose queue header
    says what happens next and holds the one control for it.
  - ADR-0082: Resume is in the dock's queue header; with a held queue there,
    sending the queue is the header's button and Resume is in its ⋯.
  - ADR-0040: the work strip moves from the column's foot to a row of its
    header.
  - ADR-0105: the offer's line is in the column's header.
  - ADR-0112: a note dropped on a workflow state in the footer's strip, or in
    the sidebar, becomes a new thread; a held queue is not work, so it draws
    no ring.
- **Amended by:**
  - ADR-0116: notes are in note columns, the task's; the notes board and the
    dock's notes line go.
  - ADR-0203: the dock holds the changes row and one ⋯, with the changes' and
    the queue's sections.

**Context.**

- **What happens next is unclear.** A stopped thread with two cards queued
  showed Resume, "queue held by you · release" and "unqueue all" in a row
  under the offer strip, and the composer's "queue after yours" below them.
  Three controls start the agent, in three places, and only release sends
  what is queued. Resume started a new turn and left the hold, so the
  queued cards waited on.
- **The queue scrolls away.** Queued cards are drawn after the thread's last
  message, in the scrolling list, while their controls sit at the column's
  foot.
- **A held queue rings its thread.** The sidebar's ring means the agent
  works there (`rootWork`, `isBusy`), and a lane with cards queued counts as
  busy whether or not its queue is held. A thread stopped with its queue
  held is waiting for a person, and rang as if it ran.
- **Drafting cards have no purpose of their own.** ADR-0111 drew them as a
  stack above the composer, between the line and your message. That made
  them a stage between typing and queueing, which is what the composer
  already is, and gave a team nowhere to lay out its thinking.
- **"Drafting card" names a state, not an intent.** A card is a container;
  what a card below the line holds is a note.

**Decision.**

*A note is a card below the line.* The word is **note**: a text card on its
thread's notes board, which people read and the agent does not. "Drafting
card" leaves the interface, the docs and the code.

*The notes board.*

- **Each thread has one**, shared by everyone at the thread. It opens in the
  column's pane (ADR-0078), beside the thread, from the dock's notes line,
  and covers the page on a narrow screen. Whether it is open is the
  column's, as the pane is: nothing opens it by itself.
- **It is a grid, and a note snaps to a cell.** A cell is an address, the
  same for everyone ("the plan is top-left"), as the inventory's slots are
  (ADR-0048). The grid has a fixed width, and always one empty row below
  its last note to grow into. A small pane scrolls the grid; it never
  reflows it.
- **Notes keep their cells, gaps included.** A drop on an empty cell places
  the note there; a drop on a note swaps the two, as in the inventory. Put
  lands in the selected cell, else the first empty one in reading order.
- **A cell shows its note folded**: its header and first lines. Selecting a
  note opens it whole, to read and edit.
- **A heading is a note.** Notes are markdown, so a note reading `# Ideas`
  draws as a heading, and placing it above others titles them. There are
  no columns, sections or names to create.
- **Keys:** arrows move the selection through the grid while it has focus;
  Alt+arrows move the selected note a cell; Enter opens it.
- **Who is here shows on the dock's notes line** ("notes (4) · Bea", with
  the avatars of those on the board), and on the note each is typing in.
  Nothing reaches an inbox.
- **A note moves anywhere a card goes:** dragged onto the dock's queue it is
  queued; onto the pinned strip, pinned; onto the composer, it becomes your
  message, and a message already there takes its cell; into your
  inventory, taken.

*A note spun off is a thread.* A note dropped on a workflow state's name in
the footer's strip becomes a new conversation root in that state (ADR-0111);
hovering it on ▦ opens the board, to drop it among the threads. Dropped in
the sidebar, it becomes a new thread where ＋ puts one, opened there for you.
A note's ⋯ has "Move to ▸ new thread in …" for the keyboard.

*The column's dock.* The column's foot holds, top to bottom: the queue, the
line, and your message. It is pinned to the column's foot; the messages
scroll above it.

- **The queue's header says what happens next**, with the one control for
  it. ▸ marks what goes next, and only one button shows:

  | the thread | header | button |
  |---|---|---|
  | running | ◉ running | stop |
  | idle, queue held, cards queued | held by Bea · ▸ on the top card | send queue (2) |
  | idle, stopped, nothing queued | stopped by Bea | resume |
  | idle, nothing queued | idle · ▸ on your message's send | none |

  Resume, with a held queue, is in the header's ⋯; so are hold queue and
  unqueue all.
- **Queued cards fold** to their header and first line, and open when
  focused. The dock is at most a third of the column's height and scrolls
  within itself past that, its queue header kept in view.
- **The line is drawn** between the queue and your message.
- **Your message is the composer**: one card, yours, in the frame ADR-0111
  gives every card. Its button says where it goes ("send to agent", "queue
  as 3rd", "send all (3)"). The composer is where you write, alone, a
  message to people or to the agent; it is not shared. Only you see your
  message, as only you see your inventory, and it still stays on its
  thread through a reload, a closed column or a restart. What you share
  with the team before it is sent is a note. Others writing at the
  thread's end show as "Bea is writing…".

*Staging and the hold.* **Sending removes the hold.**

- **"+ add to queue"**, at the queue's foot, adds an empty queued card. On
  an idle thread whose queue is not held it holds the queue first, so the
  card is not sent as you type it, and the header says "staging".
- **While the queue is held, the composer's button is "send all (n)"**: it
  queues your message last and releases the hold, and the ▸ marks show the
  order before you press it. "queue only", in the composer's ⋯, adds it
  without releasing. The header's "send queue (n)" releases with nothing
  added.
- **A Stop with a message card queued holds the queue**, as ADR-0048 has
  it; what comes next is then the queue, and its header says so.
- **A held queue is not work.** A thread with its queue held and nothing
  running draws no ring in the sidebar or on the board; it still cannot be
  moved to the closed state while cards are queued.

*The work strip moves to the column's header*, as a row under the name: the
offer's line and its buttons, catching up, and the parent's state.

**Consequences.**

- The column's foot is short when nothing is queued: the queue's header,
  the line, the composer and the notes line.
- A team's thinking is on the board, out of the reading flow. Someone who
  never opens it sees only the notes line's count and avatars.
- "+ card", and other people's drafting cards above your composer, go. Your
  own unsent text is your message, or a note. The unsent-text marks
  (ADR-0048, step 2) count both.
- A note's place gains a cell; the drafting place is renamed. Notes already
  stored at a thread's end are laid out in reading order when the host
  first starts with this.
- The pane gains a subject, the notes board, which shares the pane with the
  review, a table or an image: opening one closes the other.
- The offer's line moves away from accept's natural place under the work;
  the header row is the one place a thread's work is summed up.

**Alternatives rejected.**

- **Notes stacked above the composer** (ADR-0111). They read as a step
  between typing and queueing.
- **A queue column on the notes board**, or a pinned one. Each is already
  shown in the column, beside the board; a second copy is two things to
  keep in step.
- **Notes in stacks, a heading card on top.** Simpler, but a grid lets
  notes cluster in two dimensions, leaves gaps on purpose, and shares the
  inventory's physics: one way to lay cards out.
- **A free canvas.** A position no key can name breaks the fidelity of put
  and the keyboard (ADR-0048, *Input*), and two people's notes overlap.
- **Columns made and named on the notes board.** A heading note does it
  with nothing new to learn.
- **Queued cards in the scrolling list.** They and their controls were
  apart, and scrolled out of sight.
- **Resume releasing the hold.** Resume carries on the stopped turn; the
  queue's cards are other work, sent by sending.
- **A notification when someone works on the notes board.** Thinking out
  loud is not something to be pinged about; presence shows it.
