# S291 — a merge after a partition reaches a subscriber as its net change; intents appended to a list all survive it

- **Status:** Answered
- **Led to:** ADR-0202

Asked with Duane, for ADR-0202: whether the tether can act on the
operations Kyneta delivers rather than on a comparison of states. When
peers are connected, each write arrives as its own changeset. The
question was what arrives after a partition.

**Question.**

1. When one side writes several times while partitioned and the two
   then merge, does the other side's subscriber get each write, or only
   the net change?
2. If each write's batch also appends an intent record to a list that
   is only ever appended to, does every intent survive the merge?

**Kill criterion.** Acting on delivered operations alone is not enough
for the tether if a merge drops writes that cancelled out or were
overwritten while partitioned.

**Throw away.** `probe.ts` in this spike's folder: two Yjs documents
from `createDoc` in one process, merged with `exportSince` and `merge`.

**Answers.**

1. **Only the net change.** One side, partitioned, added message `x`,
   removed it, then wrote `y` and edited it, each as a commit of its own.
   The merge reached the other side's subscriber as one changeset, with
   `replay: true`, holding one op: `set y = "edited"`. The message added
   and removed, and the first version of `y`, were not in it. So the kill
   criterion is met: acting on the operations a merge delivers loses
   what a partition netted away.
2. **Every intent survives.** With each batch also appending
   `{ kind, key, author, seq }` to a list, the merge's one changeset held
   the net state of the messages and the insert of all four intents, in
   order: `create x`, `retract x`, `create y`, `edit y`. A list that is
   only ever appended to has nothing to cancel out.

The output is in `output.txt`.

**Consequences.**

- What an authority acts on is an **intent log**: records appended to a
  list, never edited or deleted in place, each naming its kind, its
  author, a per-author sequence number, and whatever it needs that the
  merged state may no longer hold.
- The changefeed is a trigger, and the list is the source of truth. The
  authority keeps a cursor of the intents it has taken, and reads the
  whole list on a restart or a load from its store, so it misses none
  that arrived while it was not subscribed.
- Kyneta's authors gave the same advice to Duane, with the same result on
  Yjs and Loro, and added: list order converges but is not causal (sort
  by the record's own fields); your own appends arrive with
  `replay: false`; a live Yjs document cannot trim its history, so how
  long a log is kept is a decision of its own; pruning is deliberate, as
  `Line` prunes by its acknowledged sequence.
- Not measured here: Kyneta's `Exchange` and a store, a Loro document,
  and a subscriber that attaches after a document has loaded.

**Method.** Node 24 in a Linux lane, `@kyneta/schema` and
`@kyneta/yjs-schema` 4.0.0 and `yjs` 13.6.33, installed outside the repo.
Section 1 wrote each change with a single write, section 2 each change and
its intent in one `batch`. The receiving document was subscribed before
the merge.
