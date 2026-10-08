# S120 — the host's records can live apart from pi's values, and a schema change that drops a field loses its data silently

- **Status:** Answered
- **Led to:** ADR-0095, ADR-0096

Measured in a lane (Linux, Node 24), Kyneta read at `kyneta/workspace/pineta`,
on synthetic documents and on a copy of a real store (397 MB, 108 roots). The
probe code was not committed.

## Brief

**Question.** Can the host's records live in
`records: Schema.record(Schema.record(Schema.any()))` (namespace, then key,
then the record's contents) under `json.bind`, written by the host directly,
in each root's document and in the session's, with nothing lost? Five parts:
the shape (writes, reads, identity, op-log size, compaction, sync); opening a
store written under today's `StorageDoc`; moving a real store's records;
whether anything reads a host record's `wid` or arrival; and whether a direct
write can land before a pi write it depends on.

**Kill criterion.** A nested record cannot be compacted or synced, or the
session cannot be opened or moved without losing a record.

**Throw away.** The probe scripts and the copied store.

## Answers

1. **The shape works.** One host writes, a namespace's first write creates
   its child record (`records.set(ns, {key: value})`), later writes set a
   key in it (`records.at(ns).set(key, value)`), and a namespace's last
   delete removes it.
   - **Reads keep identity.** `records.get(ns)` returns the same object
     after a write to another namespace, and a record keeps its identity
     after a write to a sibling key, which the client's reads rely on
     (S54, S59).
   - **Each write logs about 30% less.** For a lane record, the op log took
     262 bytes per write against 376 for today's flat write with pi's
     wrapper (`{namespace, key, value, wid}` under `namespace\0key`).
   - **Compaction and sync behave.** A client synced the writes in 4 ms,
     and writes made after compaction in 5 ms: a new namespace, an
     overwrite and a delete. A client joining after compaction received the
     whole document in 6 ms, and a reopened store held the same records.
   - **S18's rule still holds, by its own condition.** S18 lost a writer's
     values when two replicas created the same child at once. Here the host
     is the only writer (ADR-0023, `writersPolicy`), so no child is created
     concurrently. A second writing replica would break this, as it would
     break `lists` and `checkpointText` today.

2. **Every changed schema opens a store written under today's.** That was
   tested both compacted and not, and with and without a declared Kyneta
   migration (`Migration.add`, `Migration.remove(…).drop()`).
   - **An added field** reads as empty.
   - **The store's recorded `schemaHash`** is rewritten to the new
     schema's on open. Nothing refuses the change.
   - **Declaring the migration changed nothing observable locally.** A
     chain only decides which peers on other builds may sync
     (`supportedHashes`, Kyneta's `docs/migrations.md` §7), and a removal
     ends that walk.
   - **A dropped field's data is lost at the next compaction, without a
     word.**
     - Opened compacted, the session under a schema of `records` alone had
       no `entries` or `values` at all.
     - Opened before compaction, the old fields were still in the state,
       replayed from the log, until the next `compact`.
     - After that compaction, the store held none of the old data.
   - The host compacts every document at startup (ADR-0023). So a host
     whose schema drops a field, started on a store that still holds data
     in it, deletes that data on its first start.
   - Kyneta runs no data transforms (`docs/migrations.md` §9, "No runtime
     data transformation"): moving data is ours.

3. **A real store's records move with nothing lost.** On the copy:
   - **Gather.** The session was read under today's `StorageDoc`, and each
     root under `StorageDoc` plus `records`.
   - **Plan.** Every value whose namespace starts with `pinetrie.` is a
     move; anything else stays.
   - **Execute.** The session was destroyed and made again under its own
     schema, as `scripts/split-session.ts` did (ADR-0063). Each root moved
     in place and dropped the moved values. Then everything was compacted,
     and reopened under the new schemas.

   | | session | roots |
   |---|---|---|
   | records moved | 880, in 16 namespaces | 23,637 |
   | values left that are not the host's | none (and no entries, usage rows, lists or checkpoints) | `pi.branch.tip`, `pi.lane.config`, `pi.lane.state` (151 each), `pi.result` (1,185), `pi.op.*` (7) |
   | stored bytes, before and after compaction | 890,885 → 670,161 | 252,622,769 → 239,649,287 |

   - **Every record decodes as before.** Each of the 22 `RecordSpec`s in
     `@pinetrie/rules` decoded the same records from `records` as from
     `values`, in the session and in every root.
   - **Each root's counts are unchanged:** its entries, and its pi values.
   - **No `pinetrie.` value was left** in any root's `values`.
   - **Timing:** writing every move took 3.0 s and compacting every
     document 5.3 s, after loading.

4. **Nothing reads a host record's `wid` or arrival.**
   - `KynetaStorage`'s arrival index (`packages/pi/arrivals.ts`) indexes
     every value in the document, ours included, so each host write costs a
     reconcile there today.
   - pi reads only its own namespaces.
   - Every reader of a host record goes through `readRecords`
     (`packages/reads/index.ts`), which reads contents and addresses only.
   - `setIfChanged` (`packages/rules/records.ts`) compares contents.

5. **No direct write can land before a pi write it depends on.**
   - Every `writeValues` call in `apps/pinetrie/host/` is awaited.
   - Each record that names an entry is written after the host has read
     that entry from the document. `turnDone`
     (`apps/pinetrie/host/work/turns.ts`) reads the tip from the tree
     first, and `appendToTree` resolves after pi's commit.
   - A direct write is synchronous, so it can land earlier than today's
     queued write, but never before something already in the document.
   - The host's subscriptions must follow the records: `directory.ts`
     subscribes to a root's `values` to refresh its directory record.

## Also found

- **A copy of a live store can tear at its tail.**
  - The store was copied while the host ran: the second attempt passed
    `quick_check`.
  - Three log records at the end of one root failed to load ("stored entry
    … could not be loaded"). They follow a record missing from the copy.
  - The same three failed under today's schema with nothing moved, so this
    comes from copying, not from the move.
  - But compaction wrote that root without them. A move that compacts makes
    any record that fails to load lost for good, so it must run on a store
    no host holds (`openStore` takes the lock, S47), and stop before
    compacting if any record failed to load.
- **Kyneta stores the bound schema's hash.** Every document in the real
  store whose schema `@pinetrie/schema` declares (each root, the session,
  `pinetrie:live`, the places, card texts, and each person's inventory,
  attention and open roots) recorded the same hash as the code's
  `schemaHash`. The store also held command Lines under three hashes, and a
  `pinetrie:cards` from before ADR-0059 that no code opens.
- **Only a write rewrites a stored hash.** A document opened and read
  under another schema, with nothing written, kept its stored hash
  (measured once Phase 5 needed it). So a migration that reads, then stops
  on a failed load, leaves the store to be planned the same way next time.
- **The session's pi session carries nothing pi reads.** It holds no pi
  field and no value of pi's: ADR-0092's "a session and no harness" exists
  only to write our records.

## Consequences for the plan

- Phase 5 of the plan can go ahead: the shape, the opening and the move all
  hold.
- A schema change that drops or moves a field needs its data moved before
  any host compacts under the new schema. The probe showed nothing in
  Kyneta or the host stops one that has not. `scripts/split-session.ts`
  was a one-off a person had to remember to run, so a guard is needed: see
  the plan's migration phase.
