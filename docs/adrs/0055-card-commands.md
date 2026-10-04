# ADR-0055 — A command acts on a card, and is named last: "bring up to date" is the first

**Status:** Accepted. Evidence: S69. Amends ADR-0038 ("Update from my work"
becomes a card's command, and its prefill goes) and ADR-0036 (a second kind
of command, which is not typed). Part of ADR-0048's step 3. Implemented by
`PLAN-2026-10-01-queued-cards`. Amended in place (2026-10-02): a queued card
is *unqueued*, not stopped; "stop" is a run's word (ADR-0056). Amended by
ADR-0059: a card's command is in the host's place record, set by a
request, and the cards document goes.
Amended by ADR-0060: "bring up to date" is always with the thread's base,
named on its button, and "continue on the line" is a second command, for a
thread whose WIP is gone.
Amended by ADR-0061: "bring up to date" is worded "catch up"; its button
queues a card with the command and no text at once, rather than giving
your card the command to send; a card with a command says above its box
what sending it does, and its button names the command.
Amended by ADR-0072: a third command, `catch-up-with-parent`, merges the
thread a thread branched from.

**Context.** ADR-0048 makes queued messages queued cards, and removes
`pineta.outbox`. The outbox holds two kinds of thing: messages, and "Update
from my work" (ADR-0038), parked when the thread's agent is running and
taken in order with the messages. So you can queue "run the tests", click
the button, and queue "check that yours still fits", and they happen in
that order. Removing the outbox needs somewhere for that click to wait, in
that order.

The button has more problems:
- **Its wording assumes a laptop.** "My work" is your working copy only
  because the host runs beside it. On a hosted Pineta the work comes from
  the project's repository, and "my" or "Ada's" is wrong.
- **What it brings in is said after, by a prefill.** A clean update fills
  your composer with "I've merged my latest work… check that yours still
  fits", which you then send. A parked update's prefill is dropped when the
  host drains it.
- **It is a one-off.** Splitting an offer into a stack (ADR-0038) is
  refused while the agent runs, where an update waits. Engineers will want
  more such commands, and keys for them (vim-style bindings are planned).

Slash commands (ADR-0036) name the command first and explain after: a
template's arguments follow its name. People often want to write the
context first and choose what to do with it last. Vim has this shape:
`:w !cmd` writes the buffer you already have into a command.

**Decision.**

- **A command acts on a card, and is how the card is sent.** A card's text
  is always its text: context and intent, with no syntax. Its command is a
  field on its record, `command`, empty for a plain message. A plain card
  is said; a card whose command is `bring-up-to-date` brings the thread up
  to date, then is said.
- **One command per card. The queue is the script.** Several steps are
  several cards above the line (ADR-0048), each with its own text and
  command, taken in order. A card does not hold a list of commands or a
  little language. If pipelines are wanted, `command` can become a list.
- **The host carries out a card's command when it takes the card**, at the
  boundary with pi, where it already acts (ADR-0048). A card with a command
  is always queued, even on an idle thread, where it is taken at once. Any
  writer can change or clear a queued card's command, as they can its text,
  until it is taken (S69: the take reads it in the same step as it deletes
  the record).
- **The first command is `bring-up-to-date`**: the project's work comes
  into the thread's own copy (ADR-0038's update, `prepareUpdate`).
  - "The project" names the source by its role (ADR-0032): your working
    copy, uncommitted edits included, on a laptop; the hosted repository's
    trunk elsewhere. It pairs with an offer: an offer takes the thread's
    work to the project; bringing up to date brings the project's work to
    the thread.
  - Clean: the update is written in the thread, as ADR-0038 has it, then
    the card's text, if any, is sent as its queuer's message. A card with
    no text starts no run.
  - Conflicted: ADR-0033's resolution run, with the card's text as the
    person's intent, after the conflict material.
  - Nothing new: the card's text alone is sent.
  - Refused (a thread without its own copy, a project that cannot be read):
    the card goes back below the line, marked with why (S69, answer 5).
- **It is worded "bring up to date"** on the button and on the card ("→
  bring up to date"). The button makes a drafting card with the command
  set, at the thread's end, focused, so you write what the agent should do
  with the new work and send it. The prefill goes: the card's text is the
  intent.
- **Typed commands stay as ADR-0036 has them.** `/<package>:<name>` is
  expanded at send and frozen in the message. Whether templates and skills
  become card commands, named last with the card's text as their
  arguments, is a later decision.
- **No menu chooses a command yet.** `bring-up-to-date` is set only by its
  button. A menu, a `:` command line, or a key comes with the vim
  bindings: commands that act on the screen (switch tab, close a column)
  and commands that act on a card can share one list, each marked with what
  it acts on, as vim's `:q` and `:w !cmd` share one command line.

**Consequences.**

- `pineta.outbox` goes with nothing in its place: everything that waits
  for a thread is a queued card. An update waits in order with the
  messages, can be unqueued or edited while it waits, and follows the
  take/unqueue rule (S69).
- A clean update with text costs one run, as sending the prefill did. A
  clean update with no text costs none.
- The update's own entry keeps its revision (ADR-0038), so a branch below it
  starts with the merged files.
- The startup sweep, which deletes cards with no text (ADR-0048), keeps
  cards that have a command.
- The `update` command on the wire, its `updated` outcome and
  `updatePrefill` go. The resolution prompt's wording stops saying "your
  work" and names the project.
- The column's waiting row ("merging your work") goes. A queued card with
  the command shows it on the card.
- Splitting an offer could become a command the same way, and so wait while
  the agent runs. That is not decided here.

**Alternatives rejected.**

- **`/pineta:pull` typed in the text**, expanded or carried out by the
  host. It puts the command first, gives the text a syntax to learn, and
  makes one command something the host carries out rather than expands.
- **`:` lines at the top of a card, run in order like a shell script.**
  A card that ran some lines and not others would be partly spent, which
  ADR-0048 has no place for. The queue already orders steps, with an edit
  box on each.
- **A tool the agent calls to pull.** It lets one run do the merge and what
  you asked next, but a clean merge would always cost a model run. ADR-0038's
  "only when you ask" would need the tool offered only to runs that a pull
  card started. ADR-0033's resolution would move inside a tool result, and
  the merge's revision would be committed with the rest of the agent's turn
  rather than as its own entry. Possible later, beside this one.
- **A record of held updates of its own**, beside the queued cards. It
  keeps a second queue, and the order between an update and the messages
  around it has to be decided again.
- **Refusing an update while the agent runs.** Simple, but the click is
  lost, and so is "after this message, before that one".
- **"pull" as the name.** Git's word, which reads as GitHub's pull request,
  where work moves the other way. "Update from my work" assumes the
  project is on your machine. "Catch up" is kept for a summary of what
  happened while you were away (ADR-0048, step 8). "Share my work" suggests
  making something visible rather than merging it, and collides with
  shared directories (ADR-0035).
