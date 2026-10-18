# ADR-0174 — A store records each one-time migration it has run, by name, in a table of its own file; a start runs only those it lacks, and refuses a store that lacks one since deleted

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S240
- **Amends:**
  - ADR-0096: a one-time record or store migration is skipped on a store whose
    ledger names it, and one deleted from the build leaves its name, so a
    store that never ran it is refused instead of opened.

**Context.**

- **A one-time migration decides from what it reads whether it is due.**
  A record migration (`RecordMigration`) changes records' contents, so
  it moves no schema hash, and ADR-0096's check, keyed on the hash Kyneta
  stores for each document, cannot tell it is done. Each one reads what
  it covers at every start, and returns no write once nothing is in the
  old shape. A store migration (`StoreMigration`) lists every stored id
  each start in the same way.
- **That read is the whole cost of a start while one is registered.**
  `0022-turn-shared-reads` and `0023-lane-forks` each read every root;
  `migrate` then compacted every document they opened. On Duane's store
  of 217 roots, with all three registered and none due, the store's
  migrations took 18 s of the start, against none once they were deleted
  (a host that starts opens no root, ADR-0162).
- **Deleting a migration once it has run is decided for one store.**
  ADR-0096 deletes a migration "once Duane's store has passed it". Duane
  has a store per session (`~/.local/share/pinetrie/sessions/<name>/`).
  A session not opened between a migration's landing and its deletion
  opens afterwards with records in the old shape, and nothing says so:
  a schema hash is refused, a record's contents are not.
- **The file can hold a table of ours.** The host's blobs are tables in
  the store's SQLite file, on the store's connection, beside Kyneta's
  (`apps/pinetrie/host/blobs.ts`). A write made through the Exchange is
  in the file once `exchange.flush()` resolves, and not before; a row
  written after the flush on the same connection never lands without it
  (S240).

**Decision.**

- **The ledger is a table in the store's file,** `pinetrie_migrations`,
  one row per migration run (its name and when), on the store's
  connection, as `pinetrie_blobs` is. A host with an in-memory store
  keeps it in memory. `VACUUM INTO`, the store's backup, copies it
  (S240).
- **It covers one-time migrations:** record migrations and store
  migrations, keyed by name (the file's, as now). ADR-0096's hash
  migrations are not in it: a document's stored hash already records
  which schema wrote it, read without opening the document.
- **A start runs only the ones its store's ledger lacks.** One the ledger
  names is neither read nor opened, so a start that has nothing to run
  opens nothing. Which are due is a value, planned from the build's
  migrations and the ledger, before anything runs.
- **A row is written after the migration's write is in the file.** For
  each migration run: its write, `exchange.flush()`, then its row (S240:
  before the flush the write is not in the file). One that found nothing
  to write gets its row too. A host that dies between a write and its
  row runs the migration again at its next start, which finds nothing to
  write, since a migration already returns no write for its own output.
- **A new store is current.** A store with no stored document when the
  host starts (`readStored` finds none, before the first `get`, S240)
  records every migration the build carries, and every deleted one's
  name, before anything is written to it, and runs none.
- **A deleted migration leaves its name.** The build keeps the names of
  the one-time migrations deleted since the ledger began. A store that
  is not new and whose ledger lacks one is refused at the start, naming
  the migration, as ADR-0096 refuses a hash no migration starts from:
  restore it from the revision that deleted it, or run the build that
  last opened the store. So a migration is deleted when its author
  chooses, not once every store has run it. Migrations deleted before
  the ledger leave no names: no store recorded them.
- **The numbering starts again at `0001`.** Every migration numbered
  before the ledger (`0001-live-row` to `0024-run-end-report`) has run on
  Duane's store and been deleted, and none left a name, so the first
  migration with the ledger is `0001-…`. A ledger keys a migration by its
  whole name, number and slug, so a new name never matches an old one
  in any case. The old ones' history is in their ADRs; the living docs
  no longer name them.
- **A name the build does not know is reported, not refused.** A ledger
  written by a newer build can name a migration this build has never
  carried. The start logs those names and goes on.

**Consequences.**

- **A start with nothing due reads no migration's documents.** The cost
  of a registered migration is paid once per store, at the start that
  runs it.
- **A migration's name is permanent.** Two migrations may never share
  one, and a deleted one's name stays in the build. A rename would make
  every store run it again, and a store that ran it under the old name
  refused once it is deleted.
- **The first start of a build with the ledger, on a store in use,**
  creates the table empty: the store is not new, so it runs every
  one-time migration registered then (none, today) and records each.
- **A power cut can keep a row and lose its write, on macOS.** S240
  measured a killed process, where the order held. SQLite's default sync
  on macOS does not flush the drive's cache (`PRAGMA fullfsync` is off),
  so a power cut during the start that runs a migration can keep its row
  and lose its write, and the migration is then skipped for good. The
  window is that one start; the risk is accepted rather than paying for
  `fullfsync`.
- **A store copied from before a migration ran,** such as a backup
  restored by hand, runs it at its next start, as now.
- **Restoring a deleted migration to open an old store** means adding its
  file back beside its name; a store whose ledger names it skips it.
- **The rule "each is deleted once Duane's store has run it"** in
  `apps/pinetrie/host/TECHNICAL.md` changes for one-time migrations: a
  store that missed one is refused, not opened in the old shape.

**Alternatives rejected.**

- **A version number** (`PRAGMA user_version`, or a high-water mark in the
  table). Migrations are written in parallel threads and accepted in any
  order, so a higher number can land before a lower one, and a store
  past the higher one would skip the lower. ADR-0096 rejected a number
  for schemas too: it says nothing about which migration is behind.
- **The ledger as records in the session's document.** It must be read
  before any document opens, as the stored hashes are. In the session
  document it would be a CRDT relayed to every client, and its row could
  land only through the same flush as the migration's own write, in a
  document the startup's sweep of undeclared records also writes.
- **A ledger file beside the store, or in a cache.** It would describe one
  store from outside it: a backup (`VACUUM INTO`) or a restored copy
  would not carry it, a moved or copied store would lose or share it,
  and a cleared cache would forget it. Its write would not share the
  store's journal either, so it orders against the migration's write no
  better than a row does.
- **Kyneta's `kyneta_store_meta` table.** It holds Kyneta's own keys,
  which its open plans from; writing ours there couples them to Kyneta's
  format.
- **Each migration recording itself as a record of its own** (a done
  marker in what it writes). Every migration would need one, written in
  the same document as its write, and the start would still have to open
  each document to find the markers.
- **Refusing a store whose ledger names a migration this build does not
  know.** Going back to an older build to compare would be refused for a
  migration that changed nothing the older build reads. A schema the
  older build cannot open is already refused by its hash (ADR-0096).
- **Keeping one-time migrations decided by what they read,** and deleting
  each soon after it lands. The read stays the cost of every start until
  someone remembers, and a session not opened in that time still opens
  unmigrated.
