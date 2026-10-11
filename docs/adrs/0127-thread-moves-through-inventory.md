# ADR-0127 — A thread changes task through your inventory: its column's ⋯ lists no tasks

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `docs/06-interface.md`
- **Amends:**
  - ADR-0117: a column's ⋯ copies a thread beside itself or into your
    inventory, and takes it; another task is reached through your inventory.
- **Amended by:**
  - ADR-0132: a thread also reaches another task by a cut and a paste.

**Context.**

- **A thread column's ⋯ grew with the sidebar.** It listed Move to ▸ each
  other open task and your inventory, and Copy to ▸ this task, each other
  task and your inventory: 2N + 5 items for N open tasks, some 35 in
  practice, in a menu as tall as the window.
- **The inventory already carries a card between places.** Take a thread,
  open the other task, and put it down from its slot or by a drop on a
  column (ADR-0117). A list of tasks in the ⋯ is a second way to do what
  the inventory is for.

**Decision.**

- **A thread column's ⋯ has the same five items however many tasks are
  open**: Make wide (or narrow), Add a note column here, Copy to this
  task, Copy to your inventory, Move to your inventory.
- **Copy to this task** puts the copy just after its source, on the
  source's canvas. Copying to another task is a copy to your inventory,
  put down there.
- **Moving to another task** is taking the thread into your inventory and
  putting it down there.

**Consequences.**

- **Moving a running thread to another task stops it**, as taking does
  (ADR-0124). The page offers no move between canvases that keeps a run
  going.
- **The host still accepts a thread's move between canvases** and still
  tells the thread it moved (`packages/rules/canvas.ts`). The page no
  longer sends one.
- **No task picker is needed**, so the ⋯ stays a short, fixed menu.

**Alternatives rejected.**

- **A task picker for Move and Copy**, a filterable dialog. It scales to
  any number of tasks, but it does the inventory's job a second way.
- **Cascading submenus.** They still list every task, need hover intent
  and keyboard handling, and in a 28rem column open off-screen or over the
  next column.
- **Keeping Move to ▸ a task for running threads**, since taking stops a
  run. A thread put away is stopped on purpose, and moving one between
  tasks is rare enough to go through your inventory.
