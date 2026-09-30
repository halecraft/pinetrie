# `@pineta/schema` — technical notes

The Kyneta document shape. Imports Kyneta only, never pi. That pi-free property
is what let spikes S7, S8 and S12 test convergence with no harness in the
picture, and it is worth protecting.

## The entry row (ADR-0015)

`entries` is a `Schema.record` of `Schema.struct.json({...})`: six typed columns
plus one sealed `payload`.

| column | why it is typed |
|---|---|
| `id` | entry identity; ADR-0009 makes uniqueness a safety invariant |
| `parentId` | the tree edge — ADR-0004, ADR-0008, ADR-0010, ADR-0012 |
| `type` | every projection filters on it |
| `timestamp` | ordering diagnostics |
| `fromId` | the merge node (ADR-0004), needed by fold (ADR-0010) |
| `payload` | **not** typed: pi's variant data, sealed |

Everything Pineta reasons about is a column. Everything pi owns is in
`payload`. We type what we traverse.

### Why `type` is an unconstrained string

A new pi `EntryType` then requires **no schema change here at all**. A
`discriminatedUnion` would demand one every time pi adds a variant, and its
discriminant must be a *constrained* literal (`Schema.string("message")`), so
the union is both more brittle and more coupled. Tolerance was the goal.

### Why `.json()` and not plain `struct`

Kyneta classifies a `.json()` node as `register` in `stateTreeRole`: stored as
one leaf tuple, not decomposed into per-field state. Entries are written exactly
once and never edited (ADR-0004, ADR-0009), so per-field CRDT merge is machinery
we would never use. Measured: byte-identical to the `Schema.any()` blob it
replaced.

A consequence to know before reaching for it: **nothing inside a `.json()`
subtree can ever be a Kyneta container.** Path folding short-circuits at the
boundary and navigates the rest with plain property access. Making part of
`payload` collaborative later is therefore not possible without moving it out.

## Gotchas

**`Schema.record` is a barrier to the migration walk.** Kyneta's
`computeSupportedHashes` descends product-to-product fields only. Probe S17/P1
measured it: a plain product inside a record is unreachable, and so is a sum,
with or without a record. Since `entries` is a record, **no change to the row
shape is migratable.** Any such change is a coordinated upgrade, not a
migration. Probe P1c showed the bounded consequence: a new schema still reads
old data locally, filling absent fields with schema defaults; it is peer
negotiation between differing builds that is exposed.

**`null` and absent are different facts.** Kyneta keeps its tombstone marker in
an out-of-band tuple slot precisely because `null` is a legitimate value under a
nullable schema and no in-band sentinel is safe inside a `.json()` blob. Our
`parentId` and `fromId` are nullable while several pi fields are optional, so
the split and rejoin must not collapse one into the other. See `toStoredRow` /
`fromStoredRow` in `packages/pi/`.

**The typed columns make ADR-0013 structural — but only the columns.** An
undeclared `seq` cannot reach a typed column. `payload` is `Schema.any()`, so a
`seq` that got *into the payload* would persist and replicate. `toStoredRow`
names `seq` in `NEVER_IN_PAYLOAD` for exactly this reason. A unit test caught
this during implementation; it is not hypothetical.

**`usageRows`, `values` and `lists` are still `Schema.any()`.** They are pi's
bookkeeping for its `Storage` port, not Pineta's domain model, and nothing of
ours traverses them. The asymmetry with `entries` is deliberate.

## `activeRuns`: one stream per lane

`activeRuns: Schema.record(Schema.string())` maps a lane name to the run it is
streaming. A **missing key means idle**; `endRun` deletes the key rather than
setting `""`, so no sentinel survives inside the structure. It replaced a single
`activeRunId` register, which allowed only one stream in the whole document.

This is a change to a **root product field**, and root product fields ARE
reachable by Kyneta's migration walk (S17's control row). So unlike a change to
the entry row, this one is migratable, as a drop plus an add at the root. It was
deliberately not migrated: the value is a transient stream pointer and there
were no users. Recorded precisely so it does not blur S17's finding that
`Schema.record` and sums are the barrier, not root fields.

## Streams: replies and tools alike (ADR-0022)

`streams` (a record per stream: lane, `reply` or `tool`, call, `under`) and
`streamText` (a `Schema.text()` per stream) replaced `pendingText`, which held
one text per run. Keys are fresh uuidv7s (ADR-0016), written only by the host.

- A reply stream opens on its message's first text, recording the lane's tip
  as `under`. It is the lane's current reply while the tip is still there
  (`isCurrentReply`). The commit that writes its entry moves the tip (S55), so
  the next message's text opens a stream of its own, and a reader stops
  drawing the first in the change that adds its entry (ADR-0044). Per run, one
  stream would have shown the first message's committed text again.
- A tool stream opens with the tool. Its output arrives as whole snapshots of
  a tail-kept view and is written with `tailEdit` (`@pineta/core`).
- **Nothing happens when a message or a tool ends.** A stream stays until its
  entry is written, so a reader never sees neither. `closeStreams` is the one
  way a stream is deleted, and each caller knows the entry is written:
  - a reply opening closes its lane's streams: a message's tool results are
    written before the next request (S55);
  - a tool opening closes its lane's replies that are no longer current: a
    message's entry is written before its tools start (S55);
  - `endRun` closes the lane's streams with its `activeRuns` key: a run's
    entries are written before it ends, a stopped reply's partial message
    included (S55);
  - `clearStreams`, at a host's start, closes every stream and every text.
- So a lane has at most one reply stream at a time.
- `planStream` is the pure decision per event, and `applyStreamOps` the one
  writer (`applyOps` inside a caller's batch). `readStreamRecords` is the one
  parser of the row, and reads no text: a `useTracked` over it does not re-run
  on a delta (S55). `readStreams` adds each text, and `readStreamText` reads
  one.
- `under` is the storage shape's `""` for a tool or a tipless lane, and
  `StreamRecord` is a union. The row is inside a `Schema.record`, so adding
  `under` was not migratable (Gotchas). A store written before it still opened
  (S55), since a starting host clears every stream.
- `activeRuns` keeps one meaning: this lane is running.
- `checkpointText` holds pi's tool-output checkpoints' text, keyed by
  `physicalKey`, written by `KynetaStorage` (`packages/pi/TECHNICAL.md`).

This package depends on `@pineta/core` (for `tailEdit` and `StreamEvent`), which
the dependency direction `core → schema → pi → app` allows. It still imports no
pi.

## Presence (`presence.ts`, ADR-0024)

`pineta:presence` is a Kyneta `ephemeral` document: never stored, last writer
wins per field. Its records are flat, and every key starts with its seat's
`seatKey`, `${writer}:${seat}` (ADR-0037): `reading` is keyed
`readingKey(seatKey, columnKey)` (every column of the tab a person is on
reports its thread's end), `typing` and `editing` by `seatKey`. A person on
two tabs is two seats, so one tab never overwrites or clears another's.
`writerOfKey` takes the writer from before the first colon: a writer holds
none (`normalizeEmail`), a seat is hex, and a column key holds none. The
writer must be in the key, because a client sees only the host among its
peers and cannot look another tab's person up from its seat. Each field is a
`Schema.string().nullable().decay(ms)`: decay reverts a field to its zero, and
a nullable's zero is `null`, so absence is `null`, never a sentinel string. Kyneta refuses `.decay()` below a register, so these are
plain records of scalars.

Measured before building (the plan's Phase 0):
- a field with no fresh write reverts to `null` on the next tick (Kyneta's
  Exchange ticks every second); **the key stays**, so readers skip nulls;
- a peer that shuts down is not removed; its values decay like any others, so
  leaving is silence. A closed column's key is deleted outright;
- documents bound with different decays sync (their schema hashes differ, and
  Kyneta reads across them), which is how e2e uses a 300 ms decay.

## Notes (`note.ts`, ADR-0025)

A note's text is a Yjs document, `NoteDoc` (`{ text: Schema.text() }`), with id
`note:<note id>` (`noteDocId`, and `noteIdOfDoc` back). It is the one place
people type together, so it is a CRDT (ADR-0023); the record is a session
value.

- **A `clientID` names a seat, and the seat's principal the person**
  (ADR-0037). `noteAuthors(seats)` maps each seat's `clientID`, Kyneta's own
  `yjsClientId(peerId)` (53 bits of FNV-1a-64), to `writerOfPrincipal` of its
  principal; a seat whose principal is no email, the host's included, is
  nobody. `note.test.ts` pins it to real documents' `clientID`s. The host
  calls it with the seats connected when an edit arrives, since by its serial
  step the sender may have gone.
- **A deletion moves its writer's clock.** Kyneta's Yjs substrate ticks a
  `kyneta.clock` text after a transaction that only deleted, and a Kyneta
  delete carries its author's tick, so a deletion is attributed like an
  insertion.
- **A note's document is never compacted.** Kyneta cannot compact a live Yjs
  document (S24); at note sizes its history is small.
- **Yjs costs the page about 36 kB gzipped.** It is plain JavaScript: no wasm.

## Persistence

The host keeps the session in a Kyneta exchange store: `@kyneta/sqlite-store`
over `node:sqlite`, `.pineta/pineta.db` by default. It holds every document the
host serves, one append-only record stream per document: the `SessionDoc`,
which is also pi's storage, each note's text, and each connected client's
command Line. It is not a pi session file.

- **The store owns its file** (S47, `apps/pineta/host/store.ts`): exclusive
  locking mode, taken when it opens, so a second process is refused, and so
  is any reader. Read a running host's store through the `Store`, as the e2e
  suite does. Kyneta's SQLite store issues the same seat on every open, so
  the host keeps its peer id across restarts.
- **Images are beside the documents, not in them** (ADR-0042). The same file
  holds `pineta_blobs` (`apps/pineta/host/blobs.ts`), on the store's own
  connection, since the store holds the file's lock: one row per image,
  keyed by its SHA-256, with its type, size, bytes and when it was last
  stored. A chat holds only references, so compaction never rewrites an
  image. `openStore` returns the `Store` and the `BlobStore` together.
- **A command Line lives only while its client's seat does** (ADR-0037). A
  client keeps no store and does not reconnect, so the host destroys a
  departed seat's Line, and deletes every stored one when it starts.

**A root schema change cannot open an existing store**: Kyneta refuses a schema
that cannot read what is stored. Migrate (root fields are migratable, S17), or
move the file aside. A Loro store from before ADR-0023 cannot be opened at all.

## Authoritative JSON, compacted (ADR-0023)

`SessionDoc` is `json.bind`: plain JSON, serialized writes, one writer (the
host). No replica writes it, so it needs no CRDT merging, and the browser loads
no Loro and no wasm. Its in-memory op log grows with every edit until
compacted (S25), so the host compacts it between runs (`apps/pineta/host/settle.ts`:
after a run ends, and at startup): the store's records become the document as it stands,
and the log is trimmed. What is lost is the history of edits to transient
state: streams, cleared values, the outbox. The tree is explicit and
immutable, so no conversation is lost. A client behind the compacted point
receives the whole document once.

Every host has a store, an in-memory one when no file is given: Kyneta compacts
only a document with a store.

**Nothing was written before the startup compaction.** `exchange.compact`
advances the document's base to the least common version of the synced peers,
or, with none, to the current version. A write compacted with no client
connected moves the base past offset 0; a client then syncs reporting the
genesis version (`kyneta.genesis:0`), and every later compaction targets it
and threw in `advance()` ("target offset 0 is behind base offset 1"). Found
when the host wrote its project record at startup. Kyneta v4 fixed it
(`planAdvance`: a target behind the base trims nothing), so the ordering is
no longer needed for correctness; the host still writes the project record
after the startup compaction, and only when it changed, which saves a write.
Only the session is compacted: a client's command Line is half written by the
client, and Kyneta cannot compact a replica of a document another peer
writes.

## Telling "no lane" from "a lane at the root"

`readLaneTip` returns null for both. `hasLaneRecord` separates them: pi writes
the `pi.branch.tip` key when it creates a lane, even before its first entry.
See `packages/pi/TECHNICAL.md` for why this matters. `writeLaneTip` writes that
value as pi does, for tests and fixtures; in the host, only pi writes it.

## Never race a child container (S18)

Moot for the session since ADR-0023: it has one writer, so two replicas never
create a container concurrently. The rule stands for any collaborative (Yjs)
document, and keeping the session's keys unique costs nothing.

A child container created lazily under a record key LOSES one writer's contents
when two replicas create it concurrently: nested `values[ns][key]` kept both
writers' values in 0 of 40 trials, against 40 of 40 for the flat layout. Once
the container exists, merging inside it is fine; the hazard is creation.

`streamText` and `checkpointText` (a `Schema.text()` per stream or checkpoint)
and `lists` (a `Schema.list()` per pi operation) do create child containers
lazily. They are safe only because each is
keyed by a globally unique id and only the host replica writes. **Do not key a
lazily created container by anything two replicas could share**: a namespace, a
lane name, a user id. See `docs/findings/S18-nested-values.md`. The rule is ADR-0016.

`values` therefore stays flat, one leaf register per address, keyed by
`physicalKey(namespace, key)`. The (namespace, key) address is pi's; folding it
into one key with a NUL is ours, mirroring pi's reference storage. The key is
an identity, never parsed: readers use each stored value's own `namespace` and
`key` properties. `physicalKey` is the single definition, used by the writer in
`packages/pi` and by point lookups here.
