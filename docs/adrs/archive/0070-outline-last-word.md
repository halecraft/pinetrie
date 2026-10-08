# ADR-0070 — Outline shows the last word of the column's last ended ask

- **Status:** Superseded
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0056: in outline, the column's last ended ask shows its last word.
- **Superseded by:**
  - ADR-0106: its one change, the last word in outline, is stated here.

**Context.** ADR-0056 hides every ask's last word in outline, leaving the
ask's message and one line. That suits the history. But when a run ends,
the agent's last reply is usually what the reader needs next: what it
found, what it changed, what it asks. In outline, reading it takes a click
on the line or a switch to story.

**Decision.**
- **In outline, the column's last ended ask shows its last word**, drawn
  where story draws it. Every other ask stays one line. `lastEndedAsk`
  (`packages/client/ask-view.ts`) decides which, over the column's rows.
- **The running ask is passed over.** While a new run goes on, the reply
  before it stays. When that run ends, its last word appears and the older
  one folds.
- **A stopped or failed ask counts.** Its last word is the partial text, the
  cancelled call's row or the error, which is where the work was left.
- **"Last" is per column**, on its own path: a branch column shows its own
  branch's last ended ask.

**Consequences.**
- When a run ends, an outline column changes in two places: the new last
  word is added, and the previous one folds above it. ADR-0044 forbids a
  following column getting shorter while its agent works, and this happens
  once the run has ended, when story folds its work too.
- `AskView` gains `latest`, and `askView` takes the column's `lastEnded`.

**Alternatives rejected.**
- **The last ask, running or not.** A new run would hide the reply before
  it, the column would get shorter mid-run (ADR-0044), and the reply would
  go just as the reader is reading it to decide what to say next.
- **Every ask's last word.** That is story density.
