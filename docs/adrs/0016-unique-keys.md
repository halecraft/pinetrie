# ADR-0016 — Never race a child container: lazily created containers need globally unique keys

**Status:** Accepted. From probe S18 (`docs/findings/S18-nested-values.md`).
Same family as ADR-0009: a per-key register whose violation is silent. Amended by
ADR-0023: the session document has one writer, so the race cannot arise there;
the rule still binds any collaborative document.

**Context.** Kyneta records are per-key last-writer-wins maps on Loro. A leaf
under a record key is one register. A *child container* under a record key (a
nested record, a list, a text) is created on first write. The question came up
concretely: could pi's values be stored nested, `values[namespace][key]`,
instead of flat under `namespace + "\0" + key`?

S18 measured it. Two replicas each write a different key into the same new
namespace, then sync:

| layout | kept both writers' values |
|---|---|
| flat, one leaf register per address | 40/40 |
| nested, namespace container **created concurrently** | **0/40** |
| nested, namespace container already existed | 40/40 |

Creating the same child container concurrently loses one writer's contents,
every time, with no error. Once it exists, merging inside it is fine.

**Decision.**

1. **A child container may be created lazily only under a key no two replicas
   can create concurrently**: in practice, a globally unique id.
2. **Where writers can share an address, store one leaf register per address.**
   pi's `values` stay flat, keyed by `physicalKey(namespace, key)`.
3. **That key is an identity, not a format.** `physicalKey` in
   `packages/schema` is its only definition; the writer and point lookups use
   it, and nothing parses it. Readers use the `namespace` and `key` properties
   every stored value carries. Verified: changing the encoding inside
   `physicalKey` leaves unit, conformance and every e2e check green.

**Consequences.**

- The current document complies, and the reason is now written down:
  `pendingText` (a text per run id) and `lists` (a list per pi
  `operationId:responseEntryId`) are the only lazily created containers, and
  both are keyed by globally unique ids.
- **Two things would break it silently:** keying a lazily created container by
  anything two replicas could share (a namespace, a lane name, a user id), or a
  second writing replica (multi-host, S8) meeting a container keyed by anything
  that is not unique. Both belong in review checklists.
- A namespace scan stays O(all values). Accepted: it is the price of a layout
  with no creation race.
- Before this change, the separator was defined twice, once in
  `packages/pi/storage.ts` (the writer) and once in `packages/schema` (the
  readers). Changing either alone would have made every lane read as "no lane",
  which `planAttach` then turns into a silent misattachment. One definition
  removes that by construction.

**Alternatives rejected.**

- *Nested `values[namespace][key]`.* Loses a writer's value when a namespace is
  created concurrently (S18, 0/40). pi's namespace set is open, since plugins
  add their own, so namespaces cannot be fixed struct fields created up front.
- *Rows with an opaque generated id.* Two writers of one address would create
  two rows and need conflict resolution the substrate already provides for a
  single key.
- *Pre-create every namespace at document creation.* Works only for a closed
  set, and pi's is open.
