# ADR-0138 — A column is made past a canvas's last column, by one split button: an agent thread, a conversation or a note column, each thread a new root

- **Status:** Accepted (Duane, 2026-10-12)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0126: `open-thread` also opens a new root's first thread in a task the
    session holds, its card where a drop on the canvas would land.
  - ADR-0134: a column's ⋯ no longer adds a note column after it.
  - ADR-0116: the task column no longer has **+ note column**.
- **Amended by:**
  - ADR-0158: ＋ past a canvas's last column offers an agent thread, a chat or
    a note column: the conversation is a chat.

**Context.**

- **A thread entered a task only from another**: a branch at a message, a
  copy at a thread's end, or a move. A thread with a context of its own
  began only in a new tab, which is a new task.
- **A fork carries its whole path.** A thread's context is its path to its
  root: every request of a branch or a copy pays for what came before it,
  and an intention stated there can pull against a new instruction.
- **A note column had two buttons**: the task column's **+ note column**,
  first on the canvas, and a column's ⋯ **Add a note column here**, after
  it. A thread had none.
- **The model allows more than one root in a task** (ADR-0116), and the
  host's first send at a root already took a thread opened in a task it
  holds.

**Decision.**

- **One split button past the last column makes a column**, for everyone,
  on a task you may change: **＋** makes an agent thread; its **▾** offers
  a conversation and a note column. On a read-only task it is not drawn.
- **A thread made there starts a new root.** It has no history: its lane
  is told its task's canvas (ADR-0121) and reads the task's pinned cards
  (ADR-0048). Forking at a thread's end stays the ⋯'s **Copy to this
  task**.
- **It lands where a drop there would**: just after the last card the page
  drew, ranked by the host; a card that has left the canvas since lands it
  at the end. A note column and a thread land by that one rule.
- **`open-thread` says how a thread starts**: a branch at an entry, a new
  tab's new root in a new task, or a new root in a task the session holds,
  just after a card. Which one is explicit, so a new tab's task id in use
  is still refused.
- **It is the one way to make an empty column.** The task column's **+
  note column** and a column's ⋯ **Add a note column here** go. A card
  dropped on the canvas still lands in a note column made for it.
- **Every ＋ is one split button, worded once**: the sidebar's, each board
  column's and the canvas's draw what they start in the same words.
- **What it offers covers every kind a canvas holds**: each kind of canvas
  card is offered at least once, under its own kind, or the page does not
  compile.

**Consequences.**

- **A task can hold threads of several roots** from the canvas itself, and
  the rail draws a forest. Each root is a document the page loads for the
  task; a new one holds only its own messages.
- **A second root's first ask titles an untitled task**, as its first
  root's would: a task is titled only while it has no title.
- **Making a column is at the canvas's end only.** To have one elsewhere,
  make it there and drag it.

**Alternatives rejected.**

- **A new thread forked at the last thread's end.** No host change, but it
  carries the path this decision exists to leave behind; it is **Copy to
  this task**.
- **Inferring a new root in a held task from the task being held.** A new
  tab whose minted task id were in use would land in another's task
  instead of being refused.
- **Keeping the other ways to make a note column.** Three places for one
  act, each with its own words.
- **Showing the button disabled on a read-only task.** Nothing there can
  be made; the archived banner says why.
