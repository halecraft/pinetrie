# ADR-0203 — A column's changes are acted on in its dock, and its header says the rest without a details panel

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`
- **Supersedes:**
  - ADR-0073: a thread has no details panel; what it showed is under the line,
    in the name's title, or in ⋯.
- **Amends:**
  - ADR-0040: the work strip is no row of the header; it is the dock's changes
    row. Under the line are the raised reason or the focus, and the fork row.
  - ADR-0113: the dock holds the changes row and one ⋯, with the changes' and
    the queue's sections.
  - ADR-0198: under the line is the raised reason, else the focus, and the
    fork row, always; nothing is closed behind a press.
  - ADR-0200: the status is a mark, not a button; a strip unfolds from ⇥
    alone; density is in the column's ⋯.
- **Amended by:**
  - ADR-0207: under the line is the raised reason, else the thread's title,
    else its focus; a chat's is its title alone.

**Context.**

- **Opened, the details were six unrelated rows**, two of them repeating
  the base's news, the reason cut short, the name and icon shown again,
  behind a chevron easy to miss.
- **Accepting and resolving were at the column's top**, while a reader
  works at its foot, where getting the latest and splitting already queue
  their cards.

**Decision.**

1. **The header tells, the dock does.** The work strip is the dock's
   changes row, above the queue header, shown while it has something to say
   or do; its buttons act at once.
2. **The dock has one ⋯**: the changes' commands, then the queue's.
3. **A resolution takes your words only where you send**: while the thread
   conflicts and your box holds text, the send button's ▾ offers **resolve
   and send**, which queues your message with the resolving command.
   **send** always sends.
4. **No details panel.** Under the line, always: the run-end reason while
   raised for you, else the focus; and the fork row. The name's title says
   who started the thread and when, its base, and the agents line. The
   column's ⋯ offers **Go to where it started**.
5. **The status is a mark**: its dot and, while raised, its word.
6. **Density is in the column's ⋯**, three choices, the current one checked.

**Consequences.**

- The header loses its ↓, its base label and its toggle; the base's news is
  said once, in the changes row.
- Accepting and resolving are beside the box you write in.
- A column keeps no open-or-closed state for its details.
- Who started a thread is in a tooltip, less found than before.
- Density is two presses away.
- A card that exists is queued with a command in one `queue-card` request,
  as one made in the queue always was: the wire, the session and the
  host's plan carry the command for either, so the drain can never pop the
  message before its command lands.

**Alternatives rejected.**

- **A details card behind the status button**: easy to miss, and what is
  left is short or rare.
- **The changes in the queue header's one line**: a stopped thread with
  changes ready needs two buttons.
- **The resolve button taking your draft when there is one**: one button,
  two meanings.
