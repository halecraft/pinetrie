# S184 — A kept state costs 2 ms and about 35 KB beyond what its save changed, so a folder's history can be kept as long as its content is wanted; a document rewritten whole costs its whole size each save, until its states go

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** ADR-0142 keeps a folder project's states as snapshots:
every merge base a live lane can need, and the folder's history for a
time this spike sets.
1. With a tree of real size (pine·trie's own, `node_modules` included,
   and a folder of large media files), what does each of 200 snapshots
   cost, each one save after the last: in time to make, in space, and in
   time to delete?
2. How long does the walk take to diff two snapshots 1 save apart, and
   200 saves apart?
3. What does it cost to take a state whose large file was rewritten
   whole (a PSD saved again): is the whole file's size added each time?

**Kill criterion.** If a kept snapshot costs more than the content its
save changed, by space or by time, history is kept only for the states a
record names, and the "time" in ADR-0142's live set is zero.

**Throw away.** `docs/findings/S184-keeping-states/probe.sh`, on this
lane's btrfs disk.

Run on this lane's btrfs disk (the Mac's VM) by `probe.sh` over a copy of
pine·trie's tree with `node_modules` (44,309 entries) and a 100 MiB
"document", with 200 saves: each appends to a small file, and every 20th
also rewrites the document whole, by a temporary file and a rename, as an
app's save does. The output is `results.json`; `df`'s used bytes, read
after a `sync`, measure space.

## Answers

1. **A state costs about 2 ms and 35 KB beyond its save's own data.**
   - The first snapshot of the tree: 7 ms, 32 KB.
   - Each later one: 2 ms on average, and about 35 KB of metadata, whether
     the save changed one line or the whole document.
   - The data a save writes is the save's cost, kept or not. A state only
     keeps it from being freed.
2. **A walk's diff costs the same however far apart two states are,**
   because it reads both trees whole: 2 changes, adjacent or 200 saves
   apart. Here it took 2.1 s a tree (44,308 entries) and 14 ms to compare,
   not the 80 ms `packages/lanehost/TECHNICAL.md` cites from S146. That is
   the walk's own cost, one awaited `lstat` at a time, and a question for
   the walk, not for keeping states. Where `btrfs send` runs (the disks
   role on the Mac, and Linux hosts), a diff costs what changed (S146).
3. **A document rewritten whole costs its whole size per kept state.** The
   200 states kept 1.07 GB beyond the first: the ten rewrites of the
   100 MiB document. Deleting the 199 states between the first and the
   last freed 969 MB, about 20 s after the deletes returned (btrfs frees a
   deleted subvolume's extents in the background), and the deletes took
   528 ms.

**Kill criterion:** not met. A kept state costs nothing in proportion to
the tree, so the history's length is a matter of how much rewritten
content to keep, not of how many states. ADR-0142's live set keeps the
folder's history for a time; this sets the policy's shape:
- every state for as long as the space it holds is small;
- past a budget of the VM's disk, the oldest states that no record names
  go first;
- the history page says how far back it reaches.

The budget is a setting with a default, for the plan to choose. The
sweep's view of freed space lags its deletes by seconds.
