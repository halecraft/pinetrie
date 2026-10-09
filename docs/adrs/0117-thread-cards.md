# ADR-0117 — A thread is a card: it has one place, a copy is a branch at its end, and one in an inventory is its holder's alone

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/schema/TECHNICAL.md`
- **Amends:**
  - ADR-0120: every thread has an id, which names its lane.
  - ADR-0021: a copy's lane, like a branch's, is made when its agent is first
    asked.
  - ADR-0057: the id a column mints is the thread's, conversation threads
    included.
  - ADR-0059: a thread card's place is the host's, in a task or an inventory.
  - ADR-0040: a fork row names a copy's source, or a parent thread in another
    task.
  - ADR-0048: a card in an inventory is its holder's alone, and links to it
    say who has it.
- **Amended by:**
  - ADR-0124: taking a running thread stops it, and the inventory previews a
    thread read only; a thread moved between tasks keeps running.

**Context.**

- **A thread has no identity of its own.** An agent thread is known by its
  lane's id and two-word name (ADR-0039, ADR-0057); a conversation thread
  only by its end (`threadOf`). A task holds threads (ADR-0116), so each
  needs an id.
- **ADR-0122 refused to take a root into the inventory**: "a root exists
  once and is everyone's". A thread taken from a task leaves the task, not
  the board.
- **A thread is four things, which a first proposal joined.** It refused to
  take a thread while its agent ran, as archiving is refused. That tied
  where a thread's card is to where its run is.

  | layer | what it is | copied | moved |
  |---|---|---|---|
  | history | its path of entries | free: entries are immutable (ADR-0004) | syncs, as every document does |
  | thread | its id, name, place, queue, pins, followers, offers | as a new thread | by a handoff (this ADR) |
  | lane | its disk: a revision per turn (ADR-0032) | forked at any turn (ADR-0034) | between runs (ADR-0119) |
  | runner | the host, its machine and model | no | between runs (ADR-0119) |

- **Branching at a thread's end already copies it.** The branch shares the
  whole path and has written nothing, and its lane is made, from the end's
  files, only when its agent is first asked (ADR-0021).

**Decision.**

*Every thread has an id.*

- **A column mints a thread's id** as it opens a new root or a branch,
  `t-` and a uuidv7, as it mints a lane's now (ADR-0057). Conversation
  threads have one too. The host records the thread as its first message
  is written: its root, its fork entry, who started it.
- **A thread's lane is named by its thread's id**, so a thread and its lane
  stay one to one (ADR-0120).
- **A thread is its own entries**, from its fork to its end. Its context is
  still its path to its root.

*A thread card has one place.*

- **In a task, or in a person's inventory**, owned by the host as every
  card's place is (ADR-0059). Moving it between tasks, taking it and
  putting it down are handoffs, each refused with where it is now ("Bea
  took this").
- **Taking a thread moves its card, not its run.** A thread taken while its
  agent works keeps working. Its queue and pinned cards go with it; notes
  are the task's, in its note columns (ADR-0116), and stay.
- **A card leaving the queue of a thread in an inventory stays queued,
  held,** saying why: "not sent: …". There is no note column beside it,
  and the holder's inventory may be full.
  Its followers still get its verdict (ADR-0077), which says who has it.
  Only archiving refuses a running thread, since it freezes the thread's
  end.
- **A thread in your inventory is put away.** It shows its status there;
  to read or write in it, put it on a canvas.

*A thread in someone's inventory is theirs alone.*

- **Nobody else opens it.** A copy's link, an inbox row, a mention, a stub
  on a rail each says "Bea has it" and opens nothing. No agent's canvas
  list includes it. The words come from a value, in one function
  (`packages/interface/TECHNICAL.md`, "Words come from values").
- **Its history above its fork is not its own.** A thread that branched
  from it still reads and shows its whole path; only the entries after the
  fork, which are the taken thread's, stay its holder's.
- **This is no security claim**, as an inventory is not (ADR-0048,
  ADR-0059): a peer holding the root's document holds its entries.

*Copying a thread is branching at its end.*

- **Copy makes a new thread forked at the original's end**, put as its own
  card where you drop it: this task, another, your inventory. It has a new
  id and a new name.
- **Its lane is made when its agent is first asked** (ADR-0021), from the
  files of the end's turn.
- **A thread copied while it runs is copied at the end its copier saw.**
- **An archived thread can be copied.** Archiving freezes a thread's end,
  not its history, so a copy is how work in the archive starts again.

*A copy shows where it came from.*

- **Its fork row** (ADR-0040) names the source thread and its task:
  "↰ copied from amber-fox · Fix the sync bug". Pressing it opens that task
  with the source in view.
- **When the source is in someone's inventory**, the row says "Bea has it"
  and opens nothing.
- **A branch whose parent thread is in another task** has the same row.
  One in the same task keeps today's.

**Consequences.**

- **A thread record keyed by its id**: its root, fork entry, starter, and
  its card's place. Finding a thread from its end becomes a read of
  records.
- **Agent threads keep their lane ids**: a lane's id was already minted by
  its column, and is now its thread's.
- **A thread card takes an inventory slot**, and counts toward the
  nineteenth that the host refuses (ADR-0059).
- **A thread's moves are undone as card moves are** (ADR-0066), since its
  place is in `places`.
- **Offers stay in your repo while a thread is in an inventory.** Anyone
  with jj sees its work under `pinetrie-offer/<name>`. Withdrawing offers
  is archiving's job, not taking's.
- **A task's board signals stop counting a thread taken from it.**

**Alternatives rejected.**

- **Refuse to take a running thread.** Where a card is and where its run
  is are separate layers: the run does not depend on the card's place.
- **The inventory holds a link to the thread.** A reference is neither
  unique nor movable (ADR-0122).
- **A taken thread stays readable by others.** A card in an inventory is
  its holder's; one rule for every kind of card is simpler to learn than
  one per kind.
- **A copy duplicates the entries into a new root.** It costs storage, and
  loses the fork row that leads back. Branching shares the path for free.
- **A copy clones the lane's disk at once.** It spends disk on copies
  nobody asks the agent in; asking the agent is the step up (ADR-0021).
- **A thread id apart from its lane's.** Two ids for one to one.
