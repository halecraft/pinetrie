# ADR-0215 — 0.1.0 starts the stored migrations again from none, and from then a hash migration is kept until a release retires it

- **Status:** Accepted (Duane, 2026-10-26)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0174: the numbering starts again at `0001` a second time, at 0.1.0;
    every migration before it is deleted with its name, none retired.
  - ADR-0096: a hash migration is no longer deleted once Duane's store has
    passed it, but kept until a release retires it.

**Context.**

- **pine·trie is published for the first time at 0.1.0** (ADR-0189). Until
  now every store was Duane's: a migration was written for his store and
  deleted once it had run there (ADR-0096), or kept with its name in the
  ledger (ADR-0174). At 0.1.0 the build carried 32 migration files: four
  hash migrations and 36 one-time record migrations, with the helpers they
  shared (`migrations/rewrite.ts`) and their mutations.
- **Duane's store had run every one** (2026-10-26, a read-only probe
  through `planStoredStart`): 317 documents, each on its current schema's
  hash, all 36 names in its ledger. It is the only store from before 0.1.0
  that matters (Duane).
- **After 0.1.0 a store is anyone's.** Someone who installed 0.1.0 and
  updates later has a store no one else has seen.

**Decision.**

- **Every migration is deleted, and its name with it.** `MIGRATIONS`,
  `RECORD_MIGRATIONS`, `STORE_MIGRATIONS` and `RETIRED_MIGRATIONS` are
  empty at 0.1.0, and the next migration is `0001-…`. The machinery stays:
  the start's one plan (`planStart`), the ledger, the schema-hash pins.
  `OLD_SHAPES` is empty with them.
- **Duane's store is brought to 0.1.0 by hand.** With no host running, it
  is copied (`pinetrie.db.before-0.1.0`) and its ledger emptied (`DELETE
  FROM pinetrie_migrations`), so the new build neither refuses it nor
  logs 36 names it does not know. A store from before 0.1.0 that did not
  run every migration is not supported.
- **From 0.1.0, a hash migration is kept until a release retires it,** at
  a minor version, not deleted because one store has passed it. A store
  still on a retired one's hash is refused in `refusalLine`'s words. A
  one-time migration is retired as ADR-0174 says: its name moves to
  `RETIRED_MIGRATIONS`.

**Consequences.**

- About 3,000 lines go: the migrations, their tests, `rewrite.ts`, 32
  mutations, and the exports only they imported (six history messages'
  `*_TYPE` constants are private to their modules now).
- A migration that needs one of the deleted rewrite helpers restores
  `migrations/rewrite.ts` from the revision before 0.1.0.
- The words and tag checks take their list of old shapes as a parameter,
  so their tests no longer depend on one existing.

**Alternatives rejected.**

- **Retiring every name instead** (`RETIRED_MIGRATIONS`): safe for a
  store that missed one, but no store but Duane's exists, and the names
  would be carried forever for it.
- **Leaving the ledger's old names in Duane's store:** every start would
  log them as from a newer build, which they are not.
