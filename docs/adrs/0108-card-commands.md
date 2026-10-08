# ADR-0108 — A command acts on a card, and is named last; the host carries it out when it pops the card

- **Status:** Accepted
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Evidence:** S69, S103
- **Supersedes:**
  - ADR-0055: restated whole, with ADR-0059, ADR-0060, ADR-0061, ADR-0072,
    ADR-0080, ADR-0083 and ADR-0100 folded in.

Restates ADR-0055 as amended by ADR-0059, ADR-0060, ADR-0061, ADR-0072,
ADR-0080, ADR-0083, ADR-0100 and its own revision of 2026-10-02; decides
nothing new. ADR-0055's changes to ADR-0036 (a second kind of command) and
ADR-0038 (catching up is a card's command) stand as ADR-0055 made them, and
it supersedes ADR-0026 with ADR-0048.

**Context.** Everything that waits for a busy thread is a queued card
(ADR-0048), and `pinetrie.outbox` is gone. Bringing a thread's copy up to
date waited in the outbox, in order with the messages around it, so you
could queue "run the tests", catch up, and queue "check that yours still
fits". That click needed somewhere to wait, in order. Slash commands
(ADR-0036) name the command first and explain after; people often want to
write the context first and choose what to do with it last, as vim's `:w
!cmd` writes the buffer you already have into a command.

**Decision.**

- **A command acts on a card, and is how the card is sent.** A card's text
  is always its text, with no syntax. Its command is a field of its place
  record in the host's places document, set by a request and empty for a
  plain message (ADR-0059). A plain card is said; a card with a command is
  carried out, then its text, if any, is said.
- **One command per card. The queue is the script.** Several steps are
  several cards, taken in order.
- **The host carries out a card's command when it pops the card**
  (ADR-0083), at the boundary with pi. A card with a command is always
  queued, even on an idle thread, where it is popped at once. Anyone may
  change or clear a queued card's command, as they can its text, until it
  is popped (S69: the pop reads it in the step that deletes the record). A
  queued card is *unqueued*, never stopped: "stop" is a run's word
  (ADR-0056).
- **The commands:**
  - **`catch-up`** brings the thread's base into the thread's own copy:
    accepted work, or its WIP, named on its button (ADR-0060, ADR-0061,
    ADR-0104).
  - **`catch-up-with-parent`** merges the thread it branched from
    (ADR-0072).
  - **`continue-on-line`** moves a thread whose WIP is gone onto accepted
    work, by a catch-up (ADR-0060); it is a person's, never the agent's
    (ADR-0080).
  - **`split`** rewrites the thread's offer as a stack, with the card's text
    as its brief (ADR-0080).
- **What a catch-up does with the card:**
  - clean: the catch-up is written in the thread as a fact, then the card's
    text, if any, is sent as its queuer's message; a card with no text
    starts no run;
  - conflicted: ADR-0033's resolution run, with the card's text as the
    person's intent;
  - nothing new: the card's text alone is sent;
  - refused (a thread without its own copy, a base that cannot be read):
    the card goes back below the line, marked with why (S69, answer 5).
- **A button queues its command at once.** "catch up" and "split" each
  queue a new card with the command and no text, which the host pops when
  the thread is free, and your composer is left as it was (ADR-0061). A
  card that already carries a command says above its box what sending it
  does, and its button names the command ("catch up and send").
- **The agent has the same acts as tools** (ADR-0080): `catch_up`, acting
  only when there is new work and refused as the button's command is, and
  a request for a split. A merge's result is carried in the tool's own
  result (S103).
- **Typed commands stay as ADR-0036 has them,** expanded at send and frozen
  in the message. No menu chooses a card command yet: each is set by its
  button.

**Consequences.**

- Nothing waits for a thread but a queued card: a catch-up waits in order
  with the messages, can be unqueued or edited while it waits, and follows
  the pop and unqueue rule (S69).
- A clean catch-up with text costs one run; with no text, none.
- The catch-up's own entry keeps its revision, so a branch below it starts
  with the merged files.
- The startup sweep, which deletes cards with no text, keeps cards that
  have a command.

**Alternatives rejected.**

- **`/pinetrie:pull` typed in the text.** It puts the command first, gives
  the text a syntax to learn, and makes one command something the host
  carries out rather than expands.
- **`:` lines at the top of a card, run in order.** A card that ran some
  lines and not others would be partly spent. The queue already orders
  steps, with an edit box on each.
- **A record of held commands of its own**, beside the queued cards: a
  second queue, whose order against the messages would be decided again.
- **Refusing a catch-up while the agent runs.** The click is lost, and so
  is "after this message, before that one".
- **"pull", "update from my work" or "bring up to date" as the name.**
  Git's word reads as a pull request, where work moves the other way; "my
  work" assumes the project is on your machine. "Catch up" is the word for
  both your files and a thread (ADR-0100).
