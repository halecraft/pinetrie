# ADR-0183 — An agent reads a card of its canvas on demand: an image as the image, a media column's or a note column's contents as text

- **Status:** Proposed
- **Area:** `packages/rules/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Amends:**
  - ADR-0116: "reading any card on demand waits for a tool of its own":
    `read_card` reads an image, a media column or a note column of the
    thread's canvas.
  - ADR-0182: the canvas list names each note column and media column by its
    id too, so the agent can read it; an image is read through `read_card`.

**Context.**

- **The agent is told what a canvas holds, not what it says** (ADR-0116,
  ADR-0182): each card's kind, title and who put it there; a media column's
  images by title, id and versions. A card pinned to the canvas is read on
  every run, but a media column cannot be pinned: its images would be in
  every turn's context.
- **An agent asked about an image cannot see it.** The person pastes it
  into the message again, or names it and the agent guesses.
- **A tool's image is already kept as a reference** (ADR-0051): an image part
  of a tool's result whose bytes the blob store holds is stored as its
  blob, and the model reads it as `read`'s images are read.

**Decision.**

- **`read_card(card, version?)`** reads one card of the thread's canvas, by
  the id the canvas list gives:
  - an image: its title, which version of how many, and that version's
    fitted copy as an image the model sees (the newest when no version is
    named);
  - a media column: its title, and each image's title, id and versions;
  - a note column: its title, and each note's text, in order.
  Any other card, or one on no canvas or another canvas, is refused,
  saying why. A thread on no canvas reads nothing.
- **The canvas list names note columns and media columns by id**, so the
  agent has something to pass.
- **It is in every run**, as `put_image` is, and reads, so it takes no
  intent.
- **Nothing is read unasked.** An image read stays in the thread's context
  as any tool's image does, until compaction.

**Consequences.**

- An agent can look at a mockup it was pointed to, compare two versions,
  or read a note column's decisions, at the cost of the tokens it reads.
- The canvas list's lines change for note columns and media columns: a
  run's first list after this differs from the one before, once.
- A model without vision gets the image's placeholder, as for `read`.

**Alternatives rejected.**

- **Pinning a media column:** every image in every turn's context.
- **A text gist of each image instead of the image** (S251, open): it needs
  a vision model the person's setup may not have, and a gist cannot answer
  what it did not say. It can be added beside this.
- **Reading through `save_blob` and `read`:** two calls, a file left in the
  lane, and only for a blob the thread's messages showed: a media column's
  images were never in a message.
