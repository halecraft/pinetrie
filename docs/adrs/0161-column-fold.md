# ADR-0161 — A column's header ends in ⋯ and one button: ⇤, which folds it for you, or × on a thread not yet started; Move to trash ends every ⋯

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`
- **Amends:**
  - ADR-0134: a column's header ends in ⋯ and ⇤, or ⋯ and × on a thread not
    yet started; Fold leaves ⋯, and Move to trash ends it.
- **Amended by:**
  - ADR-0198: the fold toggle is first in the header, not last; ⋯ ends it
    alone; one value, `columnHead`, decides a header and its strip.

**Context.**

- **The one-click control in a started column's header trashed it.** ×
  moves the column to the task's trash for everyone, at once, with no
  question, and stops a running thread. It is undone with the undo key or
  from the task column's trash.
- **Folding took two clicks.** Fold was the first item of ⋯. A fold is
  yours alone, nobody else sees it, and people fold far more often than
  they trash, to make room.
- **The pair was lopsided.** A folded strip unfolds from one click
  anywhere on it (⇥), but the column folded back only through ⋯. The task
  column already ended its head in ⇤.
- **A thread not yet started is the other way round.** A branch, a new
  tab or a copy before its first send has nothing written in it. Dropping
  one opened by mistake is common and loses nothing; folding one has
  little use, since it is about to be sent or dropped.
- ADR-0134 put × on every column because the controls had varied by
  column ("people read the missing × as a fault"), and because a started
  thread could leave a canvas only through an inventory.

**Decision.**

- **Every unfolded card column's header ends in ⋯ and one button**, at the
  far right:
  - **⇤** on a started thread and on a note column, for every reader. It
    folds the column for you alone, as Fold did, and moves as a fold you
    ask for does (ADR-0137).
  - **×** on a thread not yet started, for a reader who may write. It does
    what × did: the column to the task's trash, and a new tab's task out
    of your sidebar with it. A reader who may not write sees no button
    there.
  - No column has both. The task column is unchanged.
- **⋯ holds what changes the canvas for everyone**, and no longer lists
  Fold. On every column it ends in **Move to trash**, for a reader who may
  write. The rule is who an act touches: ⋯ is everyone's, and the head's
  button is yours or loses nothing. Fold is yours, so it leaves ⋯. Trash
  is everyone's, so it stays in ⋯ even on a thread not yet started, where
  × repeats it, and ⋯ reads the same on every column.

**Consequences.**

- Folding a started column takes one click.
- Trashing a started column or a note column takes two, from ⋯.
- A thread not yet started still closes in one, and does not fold.
  Someone else's thread not yet started that you unfolded stays unfolded
  until it is sent or dropped. It is short-lived, and it folds once
  started.
- ⇤ and ⇥ now read the same on card columns and the task column.
- The controls vary again, which ADR-0134 warned against, but in a
  narrower way: every column has ⋯ and one button in the same place, and
  which button it is says what the column holds. ⇤ means written work you
  can fold away; × means nothing written yet, so closing it loses
  nothing.

**Alternatives rejected.**

- **× nowhere, trash only from ⋯.** Uniform, but dropping a branch or new
  tab opened by mistake is common and loses nothing; two clicks for it is
  friction with no safety gained.
- **× on every column, as before, with ⇤ beside it.** Two buttons on every
  head, and the shared one-click trash of written work one slip away from
  the fold.
- **⇤ and × both on a thread not yet started.** Folding a column about to
  be sent or dropped has little use, and two buttons there would move ⇤
  off the far right on those columns alone.
- **Fold kept in ⋯ as well as ⇤.** ⋯ would hold one act that is yours
  among the shared ones.
- **Move to trash left out of ⋯ where × is.** ⋯ would then differ by
  column, and a reader who learned trash is last in ⋯ would not find it
  there.
- **⇤ at the header's left, so a fold leaves the strip under the
  pointer.** The header's left holds the mark and name the fold turns
  onto the strip, and the task column's ⇤ is at its head's right end. A
  strip unfolds from a click anywhere on it.
