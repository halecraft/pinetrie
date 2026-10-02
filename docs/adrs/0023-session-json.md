# ADR-0023 — The session is authoritative JSON, compacted; CRDTs only where people type together

**Status:** Accepted. Evidence: S24, S25. Amends ADR-0008, ADR-0016, ADR-0022.
Amended by ADR-0048: clients write cards, the cards document and each card's
text, directly; the host writes pi's tree, and a card only to spend it.
Amended by ADR-0059: the host writes cards' places again (`places`, `json`),
through handoffs clients ask for; clients write cards' texts and their own
inventories.

**Context.** The session document was on Loro, a CRDT: every replica could write
it and merge. None does. The host alone writes the session document (pi's
entries, values and lists, streams, lanes, the outbox), and clients send
commands over the Line (ADR-0007, ADR-0018). Meanwhile the document only grew:
Loro keeps every operation, compacting it means either keeping all history or
refusing peers that fell behind (S24), and Kyneta cannot yet compact a live Loro
document. A tool run adds its output many times over (S22). And the browser
loads 3.2 MB of Loro wasm to read it.

**Decision.**
- **The session document is on `json.bind`,** Kyneta's authoritative target:
  plain JSON with serialized writes. The host is its only writer, which is
  already true and is now a rule. A second host for a session would be a
  replica, not a co-writer.
- **It is compacted:** when a run ends, and when the host starts. Compaction
  replaces the store's records with the document as it stands, and trims the
  in-memory operation log, which otherwise grows with every edit (S25). A client
  behind the compacted point receives the whole document once.
- **What is kept is what matters.** The tree is explicit and immutable (ADR-0004,
  ADR-0008), so no conversation is lost; what compaction discards is the history
  of edits to transient state: streams, cleared values, the outbox.
- **Collaborative documents are Yjs, one per document, when they exist.** Notes
  anchored in the tree and shared drafts are written by people at the same time,
  and need merging. Yjs compacts without refusing peers that fell behind (S24).
  Presence is `ephemeral`. Nothing uses Loro.

**Consequences.**
- The browser loads 142 kB gzipped, not about 1,235 kB (S25). The host and
  browser drop `loro-crdt`, and the environment gate its Loro floor.
- The store and the host's memory are bounded by the session's current state
  plus what one run adds, not by its history.
- ADR-0016's rule is moot for the session document, and binds Yjs documents.
- An existing Loro store cannot be opened; a session starts a new file.
- Live Yjs compaction needs Kyneta support before collaborative documents grow
  large.

**Alternatives rejected.** Loro with shallow snapshots: it refuses late peers'
edits, Kyneta cannot yet compact it live, and the wasm stays. Yjs for the session:
a CRDT's merging is unneeded with one writer, and live compaction is also
missing. Loro without compaction: the store and memory grow for good.
