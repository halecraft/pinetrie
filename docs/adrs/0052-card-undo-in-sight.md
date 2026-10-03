# ADR-0052 — Undo never acts out of sight: each card keeps its own history

**Status:** Accepted. Evidence: S64 and its addenda. Amends ADR-0048
(*Undo is Kyneta's*: "Cmd+Z in a card undoes through the same stack", and
"the stack is per tab"). Implementation: `PLAN-2026-10-01-card-undo-scope`.
Amended by ADR-0059: a move between owners is undone by the reverse
handoff, which the host refuses if the card has moved since; your
inventory's own moves by Kyneta's undo on your inventory document. An undo
past a card's creation empties its text and keeps its record, which only
the host writes, so the box stays bound to it and Cmd+Shift+Z there brings
the text back (*The box remembers its card…* no longer applies). Amended
by ADR-0066: each person has one history of moves per root, kept by the
host and shared by their tabs; Cmd+Z undoes the newest move in the root you
are on, whole or refused, and the place is brought into view as the undo
acts, not before; no undo reaches into an archived root.

**Context.** ADR-0048 gave each browser tab one undo stack over every card,
and Cmd+Z in any card's box undid the tab's last step. That step can be
anywhere:
- you type in a card in one root, switch to another, and press Cmd+Z there:
  your typing in the first root is undone, out of sight;
- once a sent card's steps were skipped (S64), the next Cmd+Z after a send
  undid the step below it, which could remove a card in another root.

Someone who presses Cmd+Z and sees nothing change cannot know that something
changed elsewhere, or where. Before S64, a wasted keypress after each send
hid the second case.

**Decision.**
- **Undo never acts out of sight.** Cmd+Z changes only what you are looking
  at, or first shows you where it acts.
- **Each card has its own history, in each browser tab:** its creation and
  your typing in it. Cmd+Z and Cmd+Shift+Z in a card's box go to that card's
  history and nowhere else, as they do in any text box. The tab keeps one
  Kyneta stack, in memory (ADR-0048), and a card's box undoes and redoes
  only the steps that wrote its card's text (`undo({ docs })`).
- **The box remembers its card after an undo past the card's creation**, so
  Cmd+Shift+Z there brings the card back. Typing in that box starts a new
  card, and the box then reaches only the new one. A card created anywhere
  else leaves the redo alone (S64, addendum 3).
- **A sent card's steps act on nothing.** Each client destroys its copy once
  the host lets go of it (S64), so a step on it no longer stands. A send is
  final (ADR-0048), and a discard is too until the inventory.
- **Moves get one history per tab** (ADR-0048, step 4: take, put, queue,
  unqueue, the inventory). Undoing a move first brings its place into view
  (switching tabs, opening a column or the inventory), then undoes it there.
  *Built by `PLAN-2026-10-03-inventory`:* one press of the undo key outside
  a box (Cmd+Z, or Ctrl+Z; Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y to redo)
  shows the place the card goes back to, then sends the reverse move. A
  fresh column closed since is reopened, as it was. In an archived root, a
  dialog asks whether to restore it first. An undo the host refuses, or one
  that can already see it would be, drops its entry and says why, where it
  showed: kept, it would block every entry below it. A send and a discard
  are final, and a composer's card coming into being is its text's first
  step, so none of them enters the history.

**Consequences.**
- No new documents: the tab's one stack stays, and each card's editor passes
  Kyneta its own card's document. A step that created a card is undone whole,
  its record with its text.
- Kyneta conflicts steps by what they write, down to record keys, clears
  every redo step built on a cleared one, and never takes a step from under
  a newer one it conflicts with (S64, addendum 3). So a card's undo and redo
  are its own, though every card's creation writes the cards document.
- Your typing in someone else's card is undone from that card's box, in the
  tab you typed it in. Another of your tabs has its own stack and cannot
  reach it, which matches what each tab shows.

**Alternatives rejected.**
- **One history per tab, undone from the top** (ADR-0048). It undoes out of
  sight.
- **A Kyneta stack per card**, each its own undo document. It works (S64,
  addendum 1), but a stack is made asynchronously, so the next card's stack
  had to be ready before anyone typed, and every card's stack disposed with
  it.
- **One history per tab that refuses a step out of sight.** Cmd+Z then does
  nothing you can see, the same complaint, and a step it refuses blocks
  every step below it.
- **One history per tab that shows where a text step acts before undoing
  it.** Cmd+Z in a box would switch roots under you. Text undo is expected to
  stay in the box; showing first is kept for moves, which have no box.
- **One history per column.** A card belongs to its thread, not to a column
  (ADR-0048), and two columns can show one card.
