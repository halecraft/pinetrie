# ADR-0179 — A card's header is one line of signals; a command's chip heads its body

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`
- **Amends:**
  - ADR-0111: a command's chip heads the card's body, above its box, not its
    header; the header names who put a queued or pinned card there without its
    place again ("queued · next · by Bea").

**Context.**

- **A queued card's header broke across lines.** In a dock a column wide,
  "queued by you" took two lines and the chip "catch up with accepted
  work" two more, so a card holding one command was as tall as four
  lines of text.
- **It said its place twice**: "queued next queued by you".
- **A command with nothing written showed an empty box**, which read as
  something missing.
- **Its bin was drawn larger than its ⋯**, a 16px icon beside a glyph in
  the header's small type.

**Decision.**

- **Each signal in the header is one line.** Its place, its state and who
  put it there are set apart by "·", and none wraps: a narrow column cuts
  who short first, then the state, each ending in "…", its title holding
  the words.
- **Who is "by Bea" on a queued or pinned card**: its place already says
  queued or pinned.
- **A command's chip heads the body**, above the box, as long as it needs.
  The chip is what the card says, not where it is or how it stands.
- **A queued command with nothing written folds its box away** while the
  card does not hold the focus; focusing the card, at its header, unfolds
  it.
- **The header's ⋯ and bin are one size.**

**Consequences.**

- A card with a command and words is one line taller at rest: the chip,
  then its one line of text.
- A cut name is read from its title, on hover.

**Alternatives rejected.**

- **Let the header wrap whole items to a second line:** ⋯ and the bin,
  pushed right by the space before them, land on whichever line has room,
  and the header's height changes as people are named.
- **Drop "by you" on your own cards:** whose card it is matters in a
  queue anyone here edits, and "by you" is short.
- **A placeholder in the empty box instead of folding it:** still a box at
  rest that holds nothing.
