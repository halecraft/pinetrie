# ADR-0031 — The rail compacts uneventful stretches, and never compacts structure

**Status:** Accepted. Implemented by `PLAN-2026-09-27-rail-runs`. Evidence:
S33. Amends `docs/06-interface.md` (the rail is no longer a dot per message).
Amended by ADR-0056: a capsule's messages are a *stretch*, since a run is
the agent's work for one ask. An ask whose run holds three or more agent
messages is a landmark, and its run is a stretch of its own, so a stretch
never crosses such an ask. Short exchanges still merge as below. A
capsule's tooltip leads with its ask, and the column folds the same
stretches.

**Context.** The rail drew a dot per message on a 16 px row. Tool results get
no row, but each step of an agent's work does, so a loop of 200 steps was
about 3,200 px of identical dots. Forks, branches, notes, others' rings, a
running tip and the ends of open columns were lost among them. A long
conversation between people has the same problem. Clicking a dot is also how a
reader gets to a message, and that did not always bring it into view (S33).

**Decision.**
- **A message is a landmark if it is any of:** the root's first message, a
  branch's first message, a fork, a thread end, a note's message, a thread end
  someone else follows, a running lane's tip, or the end of a column you have
  open. Every other message is uneventful.
- **A stretch of three or more consecutive uneventful messages is one run,**
  whatever their kind: people's messages and the agent's alike. An uneventful
  message has exactly one child, on its own track, so a run holds no structure
  and the compacted rail has every branch the full one has.
- **A run is a capsule on its track, one row long plus one per digit of its
  size:** 3–9 messages take 2 rows, 10–99 take 3, 100–999 take 4. Its length
  shows roughly how much is inside it. Its fill says who wrote it: hollow for
  the agent's work alone, solid for people alone, and filled at half strength
  for both.
  Hovering gives the exact figures: "12
  messages from Ada and Bea · 143 agent messages · 211 tool calls · 2 failed".
- **Clicking a capsule opens the message at that point of the run,** in view:
  a click a quarter of the way down opens the message a quarter of the way
  through. The capsule is far shorter than its messages, so this is
  approximate. A click from the keyboard opens the first message. The column
  is where a run is read; the rail does not expand it.
- **A pick from the rail lands in view:** the message is scrolled to if it is
  not already visible, and its column is told it was placed, so it holds there
  rather than following its end.

**Consequences.** Which messages are landmarks depends on the reader's open
columns and on who else is here, so two people can see the same root's rail
compacted differently, and a rail changes as columns open and close. The rail
was already each reader's (which paths are marked, the rings). While the agent
works, each step joins the run behind the running tip; the count rises every
step, but the capsule grows only at 10, 100 and 1,000. A message inside a run
is reached through its column. `projectRail` still returns a row per message,
so tab summaries, the Archive tab's search and branch colours are unchanged;
the compaction is a second step that only drawing reads. If marks (ADR-0028)
land, a marked message is a landmark.

**Alternatives rejected.** A fill in proportion to the share people wrote (a small share filled only
the capsule's rounded end, and read as a drawing fault). The bottom half filled for a mixed run (it read as a gauge, half full of
something). A larger circle with a digit inside, capped at 9 and
then a symbol for "many" (a circle that fits a digit is wider than the 12 px
between tracks, and the cap hides the difference between 12 and 400). Separate
runs for agent work and for conversation (the kinds alternate every turn, so a
session of many short turns would still cost three rows a turn). Expanding a
run in place on click (a run has no structure inside it, so it would show only
identical dots, and a click on the rail would mean two things). Always opening
a run's first message (a long run's middle could only be reached by scrolling
the column). Returning runs
from `projectRail` (every reader of rows would have to learn about them).
Collapsing runs in the columns too (a separate decision; the column is where a
run is read). A red mark on a capsule holding a failed tool call (tried: nothing
said what it meant, and it did not lead to the failure; the label counts
failures instead).
