# S240 — A record migration's write is in the store's file once `exchange.flush()` resolves, and not before: a ledger row written after the flush, on the store's connection, never lands without the write it records

- **Status:** Answered
- **Led to:** ADR-0174

**Question.** A record or store migration decides from what it reads
whether it is due (`apps/pinetrie/host/migrations/index.ts`), so while
one is registered every start reads what it covers: with 217 roots, the
store's migrations took 18 s of a start that changed nothing. A ledger
of the migrations a store has run, as a table in the store's own SQLite
file, would let a start skip them. The ledger is safe only if its row
never lands before the write it records. Specifically:
- Is a write made through the Exchange (`applyRecordWrites`) in the file
  once `exchange.flush()` resolves, so a process killed right after a
  ledger row written then keeps both?
- Is it in the file before the flush, in the same tick as the write?
- Does compacting and unloading the document before the row change that?
- Does a table of ours beside Kyneta's survive Kyneta's open, and does
  the store's backup (`VACUUM INTO`) copy it?
- Does `readStored` tell a new file (no stored documents) from one in use,
  before the first `get`?

**Kill criterion.** If a write is not in the file once `exchange.flush()`
resolves, a ledger row can record a migration whose write a crash lost,
and the ledger cannot be trusted without a transaction shared with
Kyneta's store, which it does not offer.

**Throw away.** The probe, `docs/findings/S240-migration-ledger/probe.ts`
(run from `apps/pinetrie/host/`, beside `store.ts`, whose
`openDatabase` it uses), and its output, `output.txt` there. It opens a
file the way `openStore` does, adds a `pinetrie_migrations (name, ran)`
table on the same connection, gets the session's document, writes one
record with `applyRecordWrites`, writes a ledger row at a point each mode
sets, and kills itself with SIGKILL, so nothing closes the store. A
second process then reads the record and the ledger. Linux lane, Node 24,
`node:sqlite`.

**Answers.**

1. **Once `exchange.flush()` resolves, the write is in the file.** Killed
   after a row written past the flush, 20 of 20 fresh files held both
   the record and the row. Kyneta's `Runtime.flush` waits for its
   pending loads and local-change drains, for every document to settle,
   and for the store to be idle (`#quiesce`, Kyneta's
   `packages/exchange/src/runtime.ts`); the SQLite store's `append`
   commits each record and its meta in one transaction
   (`packages/exchange/stores/sqlite/src/index.ts`).
2. **Before the flush it is not.** A row written in the same tick as the
   write landed in 20 of 20 files, and the record in none. Kyneta drains
   a document's local changes once a microtask, later than the write. So
   the order is required: write, flush, then the row.
3. **One macrotask's wait happened to be enough** (`lateflush`: the record
   and the row both landed), but nothing promises it: only the flush
   waits for the drain.
4. **Compacting and unloading after the flush changes nothing.** 20 of 20
   files held the record and the row.
5. **The file's settings make each commit durable in order.** The store's
   connection reports `journal_mode` `delete` and `synchronous` 2 (FULL),
   SQLite's defaults: each commit is synced before the next begins, and
   both the record and the row commit on the one connection, so the row's
   commit follows the record's.
6. **A table of ours sits beside Kyneta's.** After Kyneta's open the file
   held `kyneta_doc_meta`, `kyneta_records`, `kyneta_store_meta` and
   `pinetrie_migrations`, as it holds `pinetrie_blobs` today
   (`apps/pinetrie/host/blobs.ts`). `VACUUM INTO` on the store's
   connection copied the ledger with the rest.
7. **`readStored` tells a new file from one in use.** It found no stored
   document on a new file and one on the same file's second start, both
   before the first `get`. Kyneta decides the same thing for its own
   metadata from `kyneta_doc_meta` (its `storeHasData`).

**Read from source, not run.** Kyneta's `SqliteStore` creates its tables
with `IF NOT EXISTS` and touches no other table; its `storeMeta` table is
Kyneta's, keyed by its own names, and is not ours to write.
