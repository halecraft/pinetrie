# `@pinetrie/schema` — technical notes

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

Everything pine·trie reasons about is a column. Everything pi owns is in
`payload`. We type what we traverse. Two readers lift what pine·trie reads out
of it, and nothing else looks inside: `rowMessage` (a message entry's
message) and `rowRetainedTail` (a compaction's retained tail, where pi's
compaction hook carries the pinned cards, ADR-0048).

One thing pi wrote is not in `payload`: a message's image bytes. An image
part there is a reference, `{type: "image", mimeType, sha256, width,
height}`, to the host's blob store, and `KynetaStorage` restores the bytes
when pi reads the entry (ADR-0051). A part stored before that holds its
bytes as `data`.

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
bookkeeping for its `Storage` port, not pine·trie's domain model, and nothing of
ours traverses them. The asymmetry with `entries` is deliberate.

## `pinetrie:live`: what is streaming now (ADR-0063)

`LiveDoc` holds `streams`, `streamText` and `activeRuns`, apart from pi's
storage. No restarted host needs them (`clearStreams`), and they churn with
every token and tool update, so compacting them at a run's end rewrites only
what is running. Every stream and run function below takes a
`LiveDocHandle`. A reply's `under` is still compared with the lane's tip,
read from pi's storage: the commit that moves the tip writes the entry with
it, so the handover (ADR-0044) needs no change across the two documents.
Dropping these root fields from the session's schema needed no migration:
a store written with them opens under the schema without them (S86).

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
  a tail-kept view and is written with `tailEdit` (`@pinetrie/core`).
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

This package depends on `@pinetrie/core` (for `tailEdit` and `StreamEvent`), which
the dependency direction `core → schema → pi → app` allows. It still imports no
pi.

## Presence (`presence.ts`, ADR-0024)

`pinetrie:presence` is a Kyneta `ephemeral` document: never stored, last writer
wins per field. Its records are flat, and every key starts with its seat's
`seatKey`, `${writer}:${seat}` (ADR-0037): `reading` is keyed
`readingKey(seatKey, columnKey)` (every column of the tab a person is on
reports its thread's end), and so is `readingRoot` (the root entry of that
thread, ADR-0063, for a window that does not hold the root); `typing` (a
thread end) and `typingIn` (the card typed in: the host pops no queued card
while someone types in it, ADR-0048 step 7) are keyed by `seatKey`, and
decay after `typingMs`. A person on
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

## Typed text (`text.ts`, ADR-0048)

A card's text is a Yjs document, `TextDoc` (`{ text: Schema.text() }`), with
id `card:<card id>` (`cardDocId`, `cardIdOfDoc`, in `places.ts`). People type
together there, so it is a CRDT (ADR-0023); a card's record is in the places
document.

- **`seatOf(peerId, principal)` is the one place a seat becomes a person**:
  its `clientID` (Kyneta's `yjsClientId`) and its writer, or null for a
  principal that is not an email, the host's among them. The host's seat
  records (`pinetrie.seat`) come from it, and every text's writers from those.
- **`textClients(doc)`** is every `clientID` that wrote in a text, deletions
  included, from its Yjs store. Kyneta writes a structural seed under
  `clientID` 0 before anyone types, which is nobody's and left out (S58).

- **A `clientID` names a seat, and the seat's principal the person**
  (ADR-0037). `seatOf` maps a seat to Kyneta's own `yjsClientId(peerId)` (53
  bits of FNV-1a-64) and `writerOfPrincipal` of its principal; a seat whose
  principal is no email, the host's included, is nobody. `text.test.ts` pins
  it to real documents' `clientID`s. The host writes a record of each seat
  as it connects, so a card's writers are named from the records after
  they have gone.
- **A deletion moves its writer's clock.** Kyneta's Yjs substrate ticks a
  `kyneta.clock` text after a transaction that only deleted, and a Kyneta
  delete carries its author's tick, so a deletion is attributed like an
  insertion.
- **A card's document is never compacted.** Kyneta cannot compact a live Yjs
  document (S24); at a card's size its history is small.
- **Yjs costs the page about 36 kB gzipped.** It is plain JavaScript: no wasm.

## Places (`places.ts`, ADR-0059, ADR-0066)

`PlacesDoc` holds every card's record, keyed by card id: `yjs.bind` of a
record of flat string rows (`owner`, `kind`, `root`, `at`, `lane`,
`column`, `order`, `by`, `seen`, `command`, `unsent`, `placer`,
`holder`, "" for none), decoded in `@pinetrie/rules` (`decodeCard`),
and `rev`. Its id is `pinetrie:card-places` (`PLACES_DOC_ID`). Only the host
writes it, through `applyPlaceSteps` (`apps/pinetrie/host/places.ts`).

A card's history and its traces are not here (ADR-0048 step 6): they are
session records (`pinetrie.card-history`, `pinetrie.trace`). This document
grows for good with each write (S90), and a field every event changed
would refuse each whole undo of a move (S82).

- **A place does not merge** (S75): one writer, in arrival order, through
  handoffs the host applies or refuses (ADR-0059). It is Yjs anyway, so the
  host's undo stacks can undo a move whole or refuse it (ADR-0066, S82).
- **It grows about 25 bytes a move, for good** (S90): Kyneta compacts its
  storage, and gives none of it back, since Yjs keeps every item's id. 250 KB
  over 10,000 moves, accepted.
- **A new id, not the old one** (ADR-0066), so a store's `json` places and
  the Yjs schema never meet under one id.
- **A fresh row names its root and its branch point** (`root`, `at`, "" at
  for a new tab), as a drafting one does (ADR-0066). One without a root does
  not decode.
- **A pinned row carries `order`**, as a queued one does, and no `by` or
  `seen`: `kind`, `at` and `lane` are a drafting row's. No new field.
- **A client cannot write it.** Every peer registers `writersPolicy`
  (`@pinetrie/protocol/writers`), Kyneta's `canWrite`, so a client's write
  throws before it is made, and the host refuses the same operations from
  any sender. Made anyway, a write would leave the writer's copy forked for
  good (S28, S76). The client keeps the document private: the page reads
  `SessionClient.cards`.
- **`rev` is raised after every write, in a batch of its own.** A reply to
  a move carries it, and a client draws its move until its copy's `rev`
  reaches it (`packages/session/card-moves.ts`). A write that skipped `rev`
  would leave a client drawing a move over a record that had changed.
  Raised inside an undo step, every later write would change it, and every
  whole undo of the step would be refused (S82).
- **A row is one leaf** (`Schema.struct.json`): the host writes a record
  whole. Kyneta gives an unchanged row the same object across writes, which
  `readPlaces` relies on.
- **Its storage is compacted after each run** (`planCompaction`); nothing
  in memory is trimmed (S90).
- **`newPlacesDoc()`** is one with no Exchange, for tests.
- **A store from before ADR-0059 holds a `pinetrie:cards` document**, and one
  from before ADR-0066 a `json` `pinetrie:places` document, that no code
  opens; delete them by hand. The startup sweep removes the texts no record
  names.
- **`holder`** is whose inventory holds a card (`CardPlace` `inventory`);
  rows written before it existed do not decode, and no stored session held
  any.

## A person's documents (`inventory.ts`, `attention.ts`, `open.ts`, ADR-0059, ADR-0077, ADR-0085)

A person has one document of each kind in `PERSON_DOC_KINDS`, at
`<kind>:<writer>` (`personDocId`, `ownerOfPersonDoc` in
`@pinetrie/protocol/writers`): each a Yjs document written only by that
person's tabs.

- **The host stores and relays them, and never writes them.** Its policy
  shares each only with peers whose principal is its writer
  (`holdsPersonDoc`, `apps/pinetrie/host/policy.ts`), and `resolveDoc` names
  its kind so the host interprets it with its schema.
- **Who may write one is the protocol's** (`mayWrite`): its person, and the
  host, which relays it between that person's tabs. `ownerOfPersonDoc`
  names a writer only for an id `personDocId` makes, so a hand-written
  `inventory:ada@x` names nobody.
- **One document per kind, not one per person**: each is written at its own
  rate and keeps its own history (S101).
- **A tab writes one only after the host's copy has reached it**
  (`personDoc` in `packages/session/person-doc.ts`): a value written earlier
  can win over a later one from another device when the two merge (S101).

`InventoryDoc` is a document of slot index ("0"–"17") to card id. The host's
places say whose inventory a card is in; this says which slot holds it, and
each tab repairs it from the host's record (`planSlots`, `@pinetrie/session`).
A slot naming a card that is gone stays until written over: the repair
clears only a slot whose card it has seen not held for a while, and the
panel draws a slot whose card is not held as empty.

`AttentionDoc` is what the person has dealt with (ADR-0077), read whole by
`readAttention`:

- `since`: where they started, set once by the first write and never moved:
  a verdict that ended, or a mention written, at or before it is not new to
  them. "" until then, which nothing is raised against.
- `mentionsSince` and `seen`: the inbox (`packages/interface/inbox.ts`). The
  inbox's watermark moves as mentions are seen, so it is a field of its own:
  verdicts read only `since`.
- `read`: per lane, the furthest entry read, which only moves forward
  (`readStep`).
- `dismissed` and `dismissedOffers`: per lane, the ask whose verdict, and
  the `ledger.source` whose offer, was marked "not needed".
- A key that is no lane name is left out when read.

`OpenDoc` is the roots the person has open, their list (ADR-0085): each
root's `RootId` to an order key, read by `readOpenKeys` (a key that is no
root is left out) and ordered by `orderOpen` (by key, then id). A record,
not a list: two devices reordering at once merge per root, and a list could
hold a root twice.

## A document per root (ADR-0063)

A session is a document per root, the session's own, and `pinetrie:live`. The
root and the session share one schema, `StorageDoc`, pi's storage, so
`KynetaStorage` and pi's `setValue` serve both unchanged.

| document | id | holds |
|---|---|---|
| a root's | `root:<RootId>` (`rootDocId`, core) | its entries, usage rows, pi's values and lists for its lanes, checkpoints, and the host records keyed by its entries (revision, mark, stop, digest) |
| the session's | `pinetrie:session` | the records read across roots: the directory (`pinetrie.root`), every lane's record (`pinetrie.lane`, naming its root), names, offers, banners, bases, the board (`pinetrie.workflow`, `pinetrie.board`), seats, participants and the singletons. No entries |
| what streams | `pinetrie:live` (`LiveDoc`) | streams, their text, active runs |

- **Brands keep the two storage documents apart.** `RootDocHandle` and
  `SessionDocHandle` are `StorageDocHandle` with a phantom brand, so a read
  of a root's records cannot be handed the session's document, though both
  have one shape. `asRootDoc` and `asSessionDoc` are the only casts, where a
  document is opened; `newRootDoc` and `newSessionDoc` make one for a test.
  The readers below take a `RootDocHandle`: a root's entries and lanes.
- **A root's id is a `RootId`, not its root entry's** (`r-<uuidv7>`): Start
  Agent creates a lane at the root before pi writes the first entry. The
  directory record maps one to the other.
- **Every document is compacted alone.** A run's end compacts the roots its
  lanes ran in, the session, `pinetrie:live` and the places
  (`planCompaction`, `apps/pinetrie/host/housekeeping.ts`). The largest root
  in the session that motivated this took 182 ms (S84).

## Persistence

The host keeps the session in a Kyneta exchange store: `@kyneta/sqlite-store`
over `node:sqlite`, `.pinetrie/pinetrie.db` by default. It holds every document the
host serves, one append-only record stream per document: each root's
`StorageDoc`, which is also pi's storage, the session's, `pinetrie:live`, each
live card's text, the places document, each person's history of moves per
root (`moves:<writer>:<RootId>`, ADR-0066), and each connected client's
command Line. A tab's undo stack is never stored here: the host rejects it
(`resolveDoc`). It is not a pi session file.

- **The store owns its file** (S47, `apps/pinetrie/host/store.ts`): exclusive
  locking mode, taken when it opens, so a second process is refused, and so
  is any reader. Read a running host's store through the `Store`, as the e2e
  suite does. Kyneta's SQLite store issues the same seat on every open, so
  the host keeps its peer id across restarts.
- **Images are beside the documents, not in them** (ADR-0042). The same file
  holds `pinetrie_blobs` (`apps/pinetrie/host/blobs.ts`), on the store's own
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
A store from before ADR-0063, the session as one document, does not open. Its
one-off migration, `scripts/split-session.ts`, was deleted once it had run:
restore it from the revision before its deletion (ADR-0063).

## Authoritative JSON, compacted (ADR-0023)

`StorageDoc` is `json.bind`: plain JSON, serialized writes, one writer (the
host). No replica writes it, so it needs no CRDT merging, and the browser loads
no Loro and no wasm. Its in-memory op log grows with every edit until
compacted (S25), so the host compacts it between runs (`apps/pinetrie/host/settle.ts`:
after a run ends, and at startup), each root's alone (ADR-0063): the store's
records become the document as it stands, and the log is trimmed. What is lost is the history of edits to transient
state: streams and cleared values. The tree is explicit and
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

## Lane names, tips and runs are branded here

The lane and run functions take and give `LaneName`, `EntryId` and `RunId`
(`@pinetrie/core`), so `endRun(doc, lane, run)` cannot take its two ids
swapped. The readers mint them: `readLaneTip` an `EntryId`, `readActiveRun` a
`RunId`, and `readStoredLanes` the lane names.

- **`readStoredLanes` sets aside a stored name that fails `isLaneName`**, in
  `malformed`, and `readLaneNames` gives only `lanes`, so no reader is
  handed a name like `"main"`, which would become a container's or a
  bookmark's name. The host logs the malformed ones at startup (`recover`).
  Every lane name in a measured store passed (S95).
- **`readStreamRecords` drops a stream whose lane fails `isLaneName`.** Only
  the host writes streams, and `clearStreams` deletes them all at startup.

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
`packages/pi` and by point lookups here. `valuePrefix` is the one other
function that depends on the format: the NUL ends the namespace, so a key
prefix within one namespace is a physical-key prefix (`scanValues`). The
record itself is `StoredValueRecord`, defined here because it is pine·trie's
format, not pi's: `KynetaStorage` writes it with a `wid` per write, and
`writeLaneTip` writes one without.
