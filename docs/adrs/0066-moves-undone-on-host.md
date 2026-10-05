# ADR-0066 — The host undoes moves, one Kyneta stack per person and root

**Status:** Accepted (Duane, 2026-10-03). Evidence: S82, S90, S91.
Implemented by `PLAN-2026-10-03-moves-undone-on-host`. Amends ADR-0048
(*Undo is Kyneta's*: moves too, on the host; decision 11 of step 4 is
withdrawn), ADR-0052 (one history of moves per root per person, kept by the
host; the place shown as the undo acts), ADR-0059 (a handoff's undo is
Kyneta's, on the host; `places` is on Yjs; `rev` is raised apart from each
move; a keep is one command) and ADR-0063 (a new tab's `RootId` is minted as
it opens; a fresh place carries a `Spot`; `places` is Yjs, not `json`).
Supersedes `PLAN-2026-10-03-history-at-send`.

**Context.** Moves you can undo (ADR-0048 step 4) were built as pine·trie's own
history in each browser tab: an undo sent the reverse handoff (ADR-0059),
planned by the page. To be sound that needed more of pine·trie's own code: a
version check per card, so an undo could not reverse someone else's later
move; a batch command, so a keep over several cards was one step; recording
at send, so an undo right after a move worked. The history was lost on a
reload, was not shared between a person's tabs, and an undo could cross
roots, first switching to the root a move was made in, and asking to
restore an archived one.

Kyneta's undo stacks do all of it, but a stack can undo only the writes its
own runtime made, and only the host writes `places`. Probed:

- `undo({ whole: true })` undoes a step entirely or refuses it, naming the
  parts that no longer stand. Over a card's row, which holds its place and
  its placer, that refuses an undo whenever anyone else moved the card
  since. Without `whole`, a dead step is skipped and an older one undone, out
  of sight (S82).
- `rev` raised inside a step refuses every whole undo of it (S82).
- A stack per person and root, in the host's store, is shared by that
  person's tabs, survives a restart, unloads when idle, and can be destroyed
  without loading it (S91).
- A Yjs `places` grows about 25 bytes a move, for good: compaction gives none
  of it back (S90).
- A client's own stack over its inventory undoes a swap whole beside the
  repair's writes, and refuses one whose slot the repair changed (S90).

**Decision.**

1. **Each root has one history of moves per person**: a Kyneta undo stack on
   the host, `moves:<writer>:<RootId>`, kept in the host's store and shared
   with no one. Cmd+Z outside a text box undoes your newest move in the root
   you are on, from any of your tabs; Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y
   redoes it. ADR-0052's "each card keeps its own history", applied to roots.
2. **Every undo is whole or refused.** A refusal names who moved the card,
   and nothing is reverted.
3. **The host decides which history a move enters**, from the move and the
   cards' records (`historyOf`): a creation or a removal enters none; any
   other move enters the root its card goes to, else the root it leaves. A
   keep's several cards are one move, accepted whole or refused.
4. **The place is shown as the undo acts.** The host's answer names each
   card the undo moved and where it is now; the page brings that place into
   view. A fresh column the layout no longer holds is opened again from its
   place, in its root's tab.
5. **A new tab mints its `RootId` as it opens**, as ADR-0057 reserves a
   lane's id early, so every history key is a `RootId`, and a fresh place
   carries `root` and `at` like a drafting one.
6. **An archived root's histories are kept for 7 days after archiving, then
   retired.** At startup, a history whose root the directory does not name
   (a new tab that never sent) is retired too.
7. **A swap in your inventory is undone by this tab's own stack** over your
   inventory document, while the panel has focus. Text undo is unchanged.
8. **"Restore and undo" goes.** No undo reaches into an archived root.

**Consequences.**

- `MoveHistory`, `HistoryStep`, the reverse handoffs and `planUndo` are gone
  from the page; Kyneta's stack is tested on every substrate.
- `rev` is raised in a batch of its own after every write to `places`
  (`applyPlaceSteps`).
- A keep that closed a new tab cannot be undone: once it closes you are on
  another tab, and that root's history is out of reach. The cards are in
  your inventory, a take away.
- A copy taken into your inventory is a creation, so it is not recorded:
  discarding it removes it.
- Closing a fresh column and undoing a move into it reopens it with its key,
  root and branch point, not its density or its reserved lane id.
- If anyone sets a card's command after your move, its row changed, and the
  undo is refused.
- `places` costs about 25 bytes a move, kept: 250 KB over 10,000 moves.
- Duane's store was carried over once, on 2026-10-03, by startup code
  (`carryPlacesOver`) that read the old `json` `pinetrie:places` into the new
  `pinetrie:card-places` and destroyed it, deleted once it had run. A store
  from before this ADR keeps its old places unread, and its cards' texts are
  swept at its first start; to keep them, restore that code from the
  revision before its deletion.

**Alternatives rejected.**

- **pine·trie's own history in the page, recorded at send**
  (`PLAN-2026-10-03-history-at-send`), with a version id per card and a batch
  command. Every rule of undo would stay pine·trie's to get right: reverses,
  redo clearing, atomic groups.
- **A stack per browser tab.** Lost on reload, and your other tabs could not
  undo in a root you share between them.
- **One stack per person across roots.** Cmd+Z would act out of sight.
- **Undo without `whole`.** It skips a dead step and undoes an older one, out
  of sight (S82).
- **The client naming the history a move enters.** The host would trust a
  key it can work out itself.
- **A new tab's history keyed by its column.** A second kind of key for one
  case.
- **Keeping closed fresh columns to reopen them.** It serves only the browser
  tab that closed the column, and not after a reload.
- **Undoing a keep that closed a new tab.** It would need a history across
  roots, or a "reopen closed tab" outside undo.
- **Showing the place before the undo, by a peek.** A note per step beside
  Kyneta's, and a round trip per press.
- **Trimming `places` by a new document per generation** (S90). Not needed at
  25 bytes a move.
- **Retiring a root's stacks when it is archived.** An archive would end its
  history at once; 7 days lets an archive be undone in practice.
