# ADR-0175 — A column's header says what its thread's last run needs from you, until the next run starts

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0077: a run-end report that asks something of you shows in its
    thread's column too, and reading past it or dismissing it quiets it there
    rather than clearing it.

**Context.** A run's end leaves a run-end report (ADR-0077, ADR-0166):
needs you, worth a read, or done, with a reason. Only the sidebar's dot on
a canvas, the board and the inbox show it, and reading the thread to its
end clears them. The column says nothing. Someone switching to a column
reads to its end to learn whether the last run asked them something, and
a canvas's dot does not say which of its columns raised it.

A column at its end on a page you can see marks its thread read
(ADR-0077). So a line that cleared on reading would go as soon as the
column was looked at, when it is wanted most.

ADR-0173 put a thread's focus on a row of its own under the agent's row.

**Decision.**

- **A thread you follow whose last run needs you or is worth a read says
  so on a row of its header**, under the focus and above the fork's row:
  "needs you: asks whether to drop the v1 table", "worth a read: Bea
  stopped it". The level is the sidebar's (`attentionLevel`): a failed or
  unclassified run needs you, and a stop is done for whoever stopped it.
  The reason is the inbox's (`attentionWords`).
- **It stays until the next run starts.** Read past or dismissed, its
  amber turns to the header's grey: amber means "not dealt with" in the
  sidebar and the column alike. While the lane is busy, its report pending,
  or its canvas archived, the row is gone.
- **A press brings the run's last entry into view.**
- **One rule decides for both**: `standingRunEnds` gives each thread's
  report that asks something of you, and whether it is still raised. The
  sidebar's items are the raised ones, and a column's row is any, so the
  two cannot disagree.
- **Nothing shows** for `done`, for a reader who does not follow the
  thread, for a chat or a column whose agent is not named yet, or on a
  folded strip.

**Consequences.** `useAttention` returns the standing reports beside the
items, and every column reads them. The row adds one line to a header
whose last run asks something of you, and none otherwise.

**Alternatives rejected.**

- **Hide it on reading, as the sidebar does.** A visible column at its
  end marks itself read, so the line would rarely be seen.
- **A fading ✓ for `done`.** The column's end already shows the answer,
  and the header would move with nothing to say.
- **Show it to every reader.** ADR-0077 shows a report only to the
  thread's followers.
- **Check that the report's ask is the thread's newest.** A new ask makes
  the lane busy, and its end makes the report pending, then replaces it,
  so a busy lane or a pending report already hides every stale one.
