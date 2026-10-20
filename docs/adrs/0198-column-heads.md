# ADR-0198 — A column's header is one line, folded or not, with one status dot decided once per thread and a box anyone ticks

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S284
- **Amends:**
  - ADR-0040: the header's rows other than its first move into its details,
    except a raised needs-you row and an ssh request.
  - ADR-0073: the header's line, the name and the free space after it, opens
    the details, for every thread column.
  - ADR-0077: a thread's status is one level of one order, decided by
    `threadStatus`; a canvas's mark is the highest raised status of its
    threads; "changes ready to accept" is raised from the work strip's state,
    not from the proposed changes being open.
  - ADR-0116: a canvas with no view kept opens with its first unticked card
    unfolded, and that view is kept once its cards are drawn.
  - ADR-0137: the strip is the whole header turned on its side, in the
    header's order; the fold toggle comes first and stays where it is.
  - ADR-0161: the fold toggle is first in the header, not last; ⋯ ends it
    alone; one value, `columnHead`, decides a header and its strip.
  - ADR-0173: the focus row moves into the details; a strip's tooltip keeps
    it.
  - ADR-0175: the run-end status row shows under the header only while raised;
    read or dismissed, it is in the details, and the dot carries its level.
  - ADR-0177: an unstarted thread's bin takes the fold toggle's place.

**Context.**

- **A folded strip and an unfolded header disagree.** The strip has a
  grip and starts with ⇥. The header has no grip, ends with ⇤, and opens
  its details from a press on the name. The two read as different
  objects, though ADR-0137 calls the strip the header on its side.
- **The header grew rows:** focus, run-end status, origin, the agents
  line, "↑ N earlier", the work strip, the access row. Most of them are
  for when you look, not for a glance.
- **Nothing marks a column as handled.** People keep finished threads on
  the canvas rather than trash them, and have no way to say so.
- **The sidebar and a column can disagree about one thread.** The
  sidebar raises "changes ready to accept" for any proposed changes that
  are open (`openProposed`). The work strip sorts the same record by its
  own ladder (`workStripView`), where open proposed changes can be in
  conflict. So the sidebar can say "ready to accept" while the strip says
  "conflicts with main in 2 files" (S284).
- **Everything a thread's dot needs is in the tab** for every column on
  a canvas, folded or not (S284). Two facts read the root's tree. One is
  whether a run is a turn, a resolution or a split, and the dot reads all
  three as running. The other is the agent having asked about a conflict.
  The sidebar covers canvases whose roots the tab does not hold, so the
  host must record that ask for every thread to be judged alike.

**Decision.**

1. **One header line, in one order.** Unfolded:
   `⇤ ☐ mark name ●` then, at the end, the density switch, the pin, who
   is reading, and ⋯. Folded, top to bottom: `⇥ ☐ mark name ●`. There is
   no grip: the whole header, and the whole strip, is the drag handle, a
   press that moves 5 px drags, one that does not is a click. The fold
   toggle is first, at the same place in both states, so a second click
   lands on it. An unstarted thread, which does not fold, has its bin
   there.
2. **The header line opens the details.** The name and the free space
   after it are one disclosure button; the controls sit beside it. The
   details hold everything else the header held: focus, origin, the
   agents line, the proposed changes with their buttons, the access row,
   and what ADR-0073 put there. The panel's open state is kept per column,
   as now. "↑ N earlier messages" stays under the line: it is the
   column's path, not its header's facts.
3. **Closed, a header shows only what asks something of you:** its line,
   then a raised needs-you or worth-a-read row (ADR-0175), and an ssh
   request waiting for its owner. Read or dismissed, the run-end row moves
   into the details.
4. **One status per thread, decided once.** `threadStatus`
   (`packages/interface/attention.ts`) takes the work strip's state, the
   agent's work, the standing run-end report, any ssh ask, and whether you
   follow the thread and have read or dismissed what it raised. It
   returns a level, whether it is raised for you, and why. Every place
   reads it and decides nothing: the column's dot, the strip's dot, an
   inventory slot, the header's needs-you row, the sidebar's item, the
   board's dot, ▦, the inbox, the TUI's inbox.
   - The levels are attention's `LEVELS`, lowest first: `accepted`,
     `running`, `worth-a-read`, `ready`, `conflicts`, `needs-you`; none is
     null. A thread's level is the highest that holds, and a canvas's
     mark is the highest raised level of its threads. `Signal` holds
     `Level`, as it does now, so no function maps one to the other.
   - The work strip's state maps to a level through a `Record` over every
     state, as `SIGNAL_WORDS` words every signal, so a new state does
     not compile until it says what it shows.
   - Raised is decided in one place: `running` for everyone, `accepted`
     never, the rest by the sidebar's rule (ADR-0077): a thread you
     follow, not busy, not read past or dismissed. The column draws a
     status that is not raised in its quiet form.
5. **The host records the conflict ask.** When `ask_about_conflict` asks
   the person, a rules plan writes the time to a session record keyed by
   lane, `pinetrie.conflict-ask`. The work strip compares that with its
   proposed changes, as it compares the tool result's time today, and no
   longer walks the tree for it; the tool result carries no `asked` fact.
6. **A box anyone may tick, on a thread, note or media column.** It is the
   card's, for everyone, kept as the card moves; on a read-only canvas it
   is drawn and disabled. It means what the person means: the page draws
   a ticked column's name dimmed and does nothing else with it. The
   canvas list an agent is told marks a ticked card "box ticked", and the
   canvas block's rule says once that a ticked box is the person's own
   mark, which may mean done, or handled for now.
7. **A ticked card starts folded for whoever has not opened it.** A
   canvas with no view kept in your tab opens with its first unticked
   card unfolded. The view is kept once its cards are drawn, so ticking a
   card later folds nothing under anyone. An explicit open (a link, the
   inbox, the rail, your click) unfolds a ticked card as any other.

**Consequences.**

- A folded column shows whether it needs you, which it did not.
- The sidebar no longer says "ready to accept" for a thread whose strip
  says it conflicts.
- A header is one line in most columns, so more of the thread shows.
- The work strip's proposed-changes line and buttons are one click away,
  behind the line, instead of always shown.
- The work strip's state is its own function, apart from its buttons,
  over facts every thread has, so the sidebar judges a thread whose root
  the tab does not hold as a column does.
- An ssh ask raised during a run shows as needs you in the sidebar, where
  the working ring hid it.
- An inventory slot shows its thread's dot.
- A stored card carries one more field, and a session record is added.
  A hash migration accepts the places document's new schema: a card
  stored before reads unticked, so no data moves and every canvas keeps
  its columns.
- A tick does not fold anything, and a fold ticks nothing. Whether
  ticking should fold the column for its ticker is left until people
  have used the box.

**Alternatives rejected.**

- **Keep the grip on both.** The whole header already drags, and the grip
  was one more mark in a strip about 2rem wide.
- **Fold toggle last, as now.** At the end of a wide header and the top of
  a strip, it moves under the pointer with every fold.
- **The dot as the sidebar's three levels.** A column is where you act;
  conflicts and accepted are worth telling apart there.
- **The column dot derived beside the sidebar's.** Two derivations of one
  thread's state already disagree today, and a third would be one more to
  keep in step.
- **The sidebar judging unheld threads on fewer facts.** It would say
  "ready" until the canvas opens and then "needs you": not a
  contradiction, but not one rule.
- **A personal "done".** The box marks the card for the canvas, as its
  width and order do; folds stay personal.
- **"done" as the agents' word.** The page cannot know what a tick means;
  telling the agent "done" would let it act on a guess.
