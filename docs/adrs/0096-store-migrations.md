# ADR-0096 — A starting host checks each stored document's schema before it opens any, and migrates or refuses

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Evidence:** S120

Formalizes the carry-overs of ADR-0066 and ADR-0085, which ran at startup and
were deleted once they had run, and replaces the one-off script of ADR-0063
(`scripts/split-session.ts`).

**Context.** S120 measured what a changed schema does to a stored document.
It opens without complaint, and Kyneta rewrites the document's recorded
schema hash as it does. An added field reads as empty. A dropped field's data
stays in the store only until the next compaction, which deletes it. The
host compacts every document at startup (ADR-0023). So a host whose schema
drops a field, started on a store that still holds data there, deletes that
data on its first start, and nothing says so.

Nothing else stops it:

- **Kyneta's migration chain moves no data.** `.migrated()` and `.epoch()`
  decide which peers on other builds may sync (`supportedHashes`); data
  transforms are left to the application (Kyneta's `docs/migrations.md`,
  §9). Declaring one changed nothing observable locally (S120).
- **A one-off script must be remembered.** `scripts/split-session.ts` was
  run by hand before the new host started, then deleted.
- **The carry-overs moved record contents**, not a document's shape, and
  ran after the documents were open.

Kyneta does record which schema last wrote each document, and its `Store`
reads that before anything opens it (`listDocIds()`,
`currentMeta(docId).schemaHash`).

**Decision.**

- **The check comes first.** `startHost` reads every stored document's
  schema hash after it opens the store and before its first `get`, and
  compares it with the hash of the schema the code opens that document
  with (`schemaOfDoc`, `apps/pinetrie/host/policy.ts`).
- **A migration is registered from a hash.** One file each in
  `apps/pinetrie/host/migrations/`: the hash it migrates from, which
  documents, and what it does, as gather, plan (pure) and execute. It reads
  under a frozen schema of only the fields it needs, never the current one.
  A change that moves no data, such as an added field, is a migration with no
  steps: its registration is the acknowledgement that nothing is lost.
- **`planOpen` decides**, pure: open as they are, run these migrations, or
  refuse. A stored hash with no migration from it refuses the start, naming
  the document and both hashes. An id the code has no schema for is
  reported and left alone: nothing opens it, so nothing compacts it. A
  command Line (`line:`) is left out, since the host deletes every stored
  one at start (ADR-0037).
- **A run is guarded.** The store's file is copied to
  `<file>.before-<hash>` first. A record that fails to load while a
  migration reads stops it before anything is compacted, since compaction
  would lose that record for good (S120). Kyneta reports such a record only
  as a warning (`[runtime] stored entry … could not be loaded`), so the
  runner watches for that warning while it hydrates.
- **No backwards compatibility past one step.** A migration is deleted once
  Duane's store has passed it. A store still on its hash is then refused,
  and the refusal names the hash, so the migration can be restored from the
  revision that deleted it.

**Consequences.**

- Every change to a stored document's schema needs a registered migration,
  or the next host refuses to start on an existing store. The refusal comes
  at the first start, with the store untouched.
- A change to a record's contents still needs no migration: its
  `RecordSpec` decodes old contents, and the host rewrites the record
  (`setIfChanged`, the directory's refresh).
- An in-memory store is new, so the check finds nothing and no backup is
  made.
- The check depends on the hash Kyneta stores being the bound schema's
  `schemaHash`. S120 found them equal for every document in the real store
  whose schema `@pinetrie/schema` declares.

**Alternatives rejected.**

- **A version number in the store** (`PRAGMA user_version`), raised by hand,
  with a unit test pinning each schema's hash to it. The test catches a
  forgotten migration only in CI, the number is one more thing to keep, and
  it says nothing about which document is behind.
- **Kyneta's migration chain.** It moves no data, and a removal ends the
  backward walk anyway.
- **One-off scripts**, as ADR-0063 did. A host started before the script ran
  deletes the data the script was for.
