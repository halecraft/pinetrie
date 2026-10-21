# ADR-0200 — A column drags by its mark and name, and its status is a button that opens the rest

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`
- **Amends:**
  - ADR-0198: the drag handle is the mark and name, not the whole header or
    strip; the status button, not the line, opens the details; a raised
    run-end status is a word on that button, its row in the details; density
    and + pin leave the line.
  - ADR-0182: a list column's title renames from its ⋯, not a click.
- **Amended by:**
  - ADR-0203: the status is a mark, not a button; a strip unfolds from ⇥
    alone; density is in the column's ⋯.

**Context.**

- **A header was a handle full of buttons.** Every press on the toggle,
  the line, density, + pin or ⋯ was judged a drag or a click by 5 px, so
  clicks started drags and short drags clicked.
- **A strip's name unfolded on a click**, where a drag starts too.
- **The line still held what is read rarely**, and a raised status took a
  row of its own.

**Decision.**

1. **The mark and name are the handle, and only they**, folded or not: a
   grab cursor, and a press there does nothing but drag. A chat's handle
   reads "chat", a new thread's "✦ new agent", a list column's its icon and
   title.
2. **The status is a button after the name**, folded or not: its dot and a
   chevron, asking the details' other state. Opening a folded column's
   details unfolds it first, so the same press on a strip unfolds it with
   its details open. Raised for you, it says its level in
   a word (needs you, conflicts, ready, worth a read), and its title the
   reason, worded once for every place a status is titled; the details
   start with the run-end row.
3. **Closed, under the line is only an ssh request.** Density is in the
   details; + pin is in ⋯.
4. **A strip unfolds from ⇥ and its status button alone.**
5. **A list column's ⋯ starts with Rename**, as the sidebar's does.

**Consequences.**

- A drag and a click never share an element in a header or a strip.
- The line is `⇤ ☐ mark name ● word ▸ … readers ⋯`.
- A folded column shows why it needs you in two presses fewer.
- Density and pinning are one press further away.

**Alternatives rejected.**

- **Keep the whole header a handle, with a larger threshold.** Fewer
  wrong drags, never none.
- **A grip.** ADR-0198 took it out for space; the mark and name are a
  grip already.
- **The run-end row kept under the line.** The button's word says the
  same at a glance; the reason is one press away.
