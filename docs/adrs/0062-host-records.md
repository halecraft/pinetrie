# ADR-0062 — Each host record is one spec; its address holds its key, and pi only carries the writes

**Status:** Accepted (Duane, 2026-10-03). Implemented by
`PLAN-2026-10-03-agent-records`. Sits beside ADR-0003 (only `packages/pi`
imports pi) and ADR-0016 (a value's physical key is an identity, never
parsed). Amended by ADR-0092: the scribe (`Scribe.writeValues`) carries
the writes, not the agent; what is written, and the guard on its
namespace, do not change.

**Context.** The host keeps its own records as pi values under `pinetrie.`
namespaces: a root's archive state, an entry's mark, a lane's offer, the
integration line, and 12 more. They are written through pi's session,
because `KynetaStorage` owns the write tokens and arrival order (ADR-0013).
Each record was defined in three places with nothing tying them together:

- its namespace, a constant in its marginalia module;
- its write key and encoding, chosen either by `encodeWorkRecord` (10 kinds)
  or by one of 12 `Agent` methods (`setArchive`, `setMark`, `removeMark`,
  `setStop`, `setDigest`, `setSeat`, `removeSeat`, `setParticipantName`,
  `removeOffer`, and the legacy `removeHeld` and `removeHave`);
- its read key, a `…Records` function that keyed decoded values by a field.

So `packages/pi` imported pine·trie's record list, though it only passes the
writes on, and every new record grew `Agent`. Host tests asserted which
method was called, not what was written.

A pi value has an address, `(namespace, key)`, and contents. The address
decides which value a write replaces and a delete removes. Ten records
repeated the address key inside their contents (`MarkRecord.entry`); three
stored contents only (`pinetrie.stop`, `pinetrie.digest`, `pinetrie.participant`)
and their readers cast the address key; three (line, project, commands)
have one fixed key. A seat was addressed by its Yjs
`clientId` as text, a number Yjs derives from the seat's Kyneta peer.

**Decision.**

- **One `RecordSpec<R, K>` per record**, in marginalia (`records.ts`):
  `namespace`, `keyOf(record)`, `encode(record)`, `decode(contents, key)`.
  `setRecord`, `deleteRecord`, `recordsOf` and `setIfChanged` all go
  through it, and `@pinetrie/reads` derives each named reader from it
  (`readRecords(doc, spec)`).
- **The address holds the key, and the contents never repeat it.** `encode`
  leaves the key out. `decode` checks the address (`isLaneName` for a
  lane, non-empty for an entry) and puts the key back, so the in-memory
  record is whole. A write and a read cannot disagree on a key.
- **The host builds `ValueWrite`s** (`@pinetrie/core`: `set` or `delete` at
  a `HostNamespace`, `pinetrie.${string}`) with `setRecord` and `deleteRecord`.
- **pi carries them**: `Agent.writeValues(writes)` writes them in one
  session commit, and throws, writing nothing, for a namespace outside
  `pinetrie.`. `packages/pi` imports no namespace and no record encoder.
- **A seat is addressed by its `peerId`**, the seat's identity as presence
  has it (`seatKey`). Its `clientId` stays in the contents: a text's
  operations carry it, and marginalia cannot derive it from the peer.
- **Whether a record changed ignores key order** (`setIfChanged`): a
  decoder may build fields in another order than the code that made the
  new record.
- **The cleanup of `pinetrie.outbox` and `pinetrie.have`**, values left by
  hosts before queued cards and before ADR-0060, is deleted.

**Consequences.**

- Nothing stored is lost. A value written before this keeps its copy of the
  key until it is next written, and decodes as before: typebox's
  `Value.Check` accepts extra properties, every old writer took the
  address from the same field, and `decode` sets the key after the
  contents, so the address wins. An old seat reads with its clientId text
  as its `peer`, which is its address, so deleting it by `peer` works.
  Values `setIfChanged` finds unchanged are never rewritten, so old
  values may keep their copy indefinitely; it is never read.
- A new record is one spec and one reader line; `Agent` does not change.
- Host plans and tests deal in records and `ValueWrite` values:
  `expect(writes).toEqual([deleteRecord(MARK, entry)])`.
- Several writes can be one commit: the startup sweep's stale seats, new
  seats, and the startup project and commands records are one write each.
- `StopRecord`, `DigestRecord` and `SeatRecord` gain their key field
  (`prompt`, `prompt`, `peer`) in memory; their stored contents do not
  change.
- A guard at run time replaces a type rule for pi's own namespaces: type
  stripping does not check `HostNamespace`, so `writeValues` checks the
  prefix.

**Alternatives rejected.**

- **One setter per record**, as before. Precise at each call site, but
  every record grows `Agent`, and pi keeps importing the record list.
  `setRecord(MARK, record)` is as precise, and `HostNamespace` plus the
  guard keep pi's own values out of reach.
- **A raw `writeValues` with no specs.** It uncouples pi, but host code
  would then carry `{ namespace, key, value }` itself, and a record would
  still live in three places.
- **A tagged union of every record, encoded by one `switch`**
  (`encodeWorkRecord` grown). Looking a spec up by tag hits TypeScript's
  correlated-union limit and needs a cast, unless each kind gets its own
  case again. Typed constructors over specs need neither.
- **Every record repeats its key in its contents** (change stop, digest
  and participant to match the others). Consistent, but it stores each key
  twice beside an address that already holds it, and the three changed
  records would stop decoding: old asks would lose who stopped them and
  their digests, and people would set their names again.
- **Address a seat by its clientId as text and parse it back.** That parses
  an address, and keeps a derived number as the seat's identity. Two peers
  whose clientIds collide now get two records, and `writersOf` names both.
- **Read every record namespace in one pass.** `readValues` scans every
  value per namespace, about 18 scans for the page's projection. The
  specs would allow one pass, but the cost is unmeasured.
