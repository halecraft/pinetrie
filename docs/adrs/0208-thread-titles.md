# ADR-0208 — A person can give a thread a title, shown instead of its focus until they clear it

Numbered 0207 until 2026-10-21, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `docs/06-interface.md`, `docs/glossary.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`, `packages/threads/TECHNICAL.md`
- **Amends:**
  - ADR-0173: a person's own words for a thread are its title, beside the
    focus, which the model keeps writing and never replaces it.
  - ADR-0203: under the line is the raised reason, else the thread's title,
    else its focus; a chat's is its title alone.

**Context.** A thread's header says what a model thinks it is doing (its
focus, ADR-0173), and nobody working in it can correct that. ADR-0173 left
"a person's own focus" to a later decision, since it would need a rule for
when the model may replace it. A chat's header says nothing about it at
all, and another thread's agent reading the canvas list knows a thread only
by its two-word name.

**Decision.**

- **A thread has a title, a person's**, separate from its focus. While it
  is set, the header, the preview and the folded strip's tooltip show it in
  the focus's place; clearing it shows the focus again. The model's focus is
  never touched by it and keeps being written, so the two need no rule
  between them.
- **It is a card's title** (`CARD_TITLE`, ADR-0182): a thread's card id is
  its thread's, so one title per thread, on every canvas. `KINDS.thread`
  is titled by a person alone, so the agent is refused, as for a note
  column. It is set and cleared as every card's title is (`rename`, `mark`,
  `planMark`): no new record, request or host command.
- **A title and a focus are two types.** `threadTitle` reads a title,
  `threadFocus` a focus (a model's, else the opening line), and
  `threadAbout` the title, else the focus. A chat's header reads
  `threadTitle` alone, so an untitled chat's header stays one line.
- **Anyone who may write the column** sets or clears it, from the ⋯'s
  **Edit title**, a field in the line's place.
- **The agent's canvas list quotes it** after the thread's name, and
  `CANVAS_RULE` says what the quoted words are.
- **The word is *title*.** *Description* is a revision's, in the glossary.

**Consequences.**

- Every column with a head has a titled card, so the ⋯'s title row is
  offered to every reader who may write, and its words come from one table
  by kind (`titleWords`).
- A copy keeps its source's title (`planCopy`), still naming who set it,
  since the words are theirs.
- A title changing changes the canvas list, so the next run of each thread
  on the canvas is told the list again.

**Alternatives rejected.**

- **A person's write as the focus itself.** The next run's focus would
  replace it, and a rule for when it may not is what ADR-0173 left open.
- **A record of its own for a thread's title.** `CARD_TITLE` holds a
  person's title for a card already, with who set it and when, and every
  path that writes one exists.
- **The word *description*.** It already names a revision's description in
  the glossary.
