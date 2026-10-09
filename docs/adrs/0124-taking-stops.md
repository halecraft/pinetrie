# ADR-0124 — A thread taken into an inventory stops, and its holder sees it there, read only

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `docs/06-interface.md`
- **Amends:**
  - ADR-0117: taking a running thread stops it, and the inventory previews a
    thread read only; a thread moved between tasks keeps running.
  - ADR-0034: archiving keeps the snapshot nearest each thread's end, not only
    each lane's newest.

**Context.**

- **ADR-0117 kept a taken thread working.** "Taking a thread moves its card,
  not its run", and it rejected refusing to take a running thread, since
  where a card is and where its run is are separate layers. But an
  inventory is a place to put something away: nobody else can see the
  thread there, its notes stayed with the task, and its queue is held. An
  agent working where nobody can watch it, and nobody else can stop it, is
  work nobody asked for.
- **ADR-0117 put a taken thread out of sight.** "To read or write in it,
  put it on a canvas." Its holder then knew it only by its card, and
  putting a thread down to read it moves it for everyone.
- **A copy's files can be gone.** Archiving deletes every snapshot but each
  lane's newest (ADR-0034). A thread with no agent of its own has its files
  at its parent lane's nearest turn, often an older one, so a copy of it
  from the archive would find no snapshot, though the revision records
  still name one.

**Decision.**

*There is no agent or runner in an inventory.*

- **Taking a running thread stops it**, at once, as Stop does. The stop is
  the taker's own: "Bea stopped it". The thread's card says who holds it.
- **A send in a thread in an inventory is refused**: "put it on a canvas
  first". Its queued cards stay queued, held (ADR-0117).
- **A thread moved between tasks keeps running.** Only taking it stops it.
  It is told it moved, as canvas news is told (ADR-0116), and its next
  run reads its new task's canvas list.

*The holder sees it; nobody else does.*

- **Each slot of the inventory previews what it holds**, like a game's: a
  thread's name and banner, its first line, the first line of where it
  ended, and its status (stopped, cards queued), so it is known at a
  glance.
- **Opening it shows its path read only**: no composer, no queue, no run.
  To work in it, put it on a canvas.
- **A link to your own held thread opens its preview**; anyone else's says
  "Bea has it" and opens nothing (ADR-0117).
- **An unsent branch forking inside a thread someone else holds is kept**:
  its column says "Bea has it" in place of the holder's entries, and a send
  there is refused. Its text stays where it is, so its writer can move it;
  once the thread is on a canvas again, the branch works again.
- **The canvas it left shows no mark.** A thread card's moves are in its
  card's history (ADR-0048), each naming its task, so a task's history can
  be drawn later. No trace is left: traces stay at queued and pinned places.

*A copy finds its files.*

- **Archiving keeps the snapshot nearest each thread's end**, so a copy
  from the archive starts from the files of the end's turn (ADR-0117). A
  snapshot that is gone, as in a root archived before this, is read as
  missing: the copy starts from its base, and its fork row says its files
  were not kept.

**Consequences.**

- **A take is one step that writes the card's place and the stop**, so no
  command can move a running thread into an inventory and leave it
  running.
- **The stop record keeps its shape**: who and when, no reason. No stored
  stop changes.
- **Archiving keeps more snapshots**: one per thread whose end is at a
  turn no lane's newest snapshot holds.

**Alternatives rejected.**

- **A taken thread keeps working** (ADR-0117). An agent nobody else can
  see or stop works for nobody.
- **Refuse to take a running thread** (ADR-0117 rejected it too). Taking
  is how you put work away; making the person stop it first is a step
  that taking can do.
- **A stop record with a reason** ("taken by Bea"). Every stored stop
  would stop decoding, and migrating them means opening every root. The
  taker's own stop says as much.
- **Drop an unsent branch inside a held thread.** It loses its writer's
  text, and their inventory may be full.
