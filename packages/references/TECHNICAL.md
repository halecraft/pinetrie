# `@pineta/references` — technical notes

A reference is a semantic pointer: from the entry it was attached at (the
author's lane tip) to an entry or a span of one. ADR-0006, realised by ADR-0017.

## Storage

A pi value in `pineta.reference`, keyed by the reference's own id, written only
by `Agent.addReference` through `Session.setValue`. Values stay out of pi's
causal graph and out of every model's context; only custom entries can be
projected into context. References therefore travel in pi's JSONL.

## The schema is the single authority

`ReferenceSchema` (TypeBox) is the only definition of the shape. Pineta owns it,
so this is not a mirror of anything pi owns. `decodeReference` is **total**: a
stored value that does not match is dropped, never thrown, because values are
`Schema.any()` in the document and one bad value must not break every render.
Decoding is also where `ReferenceId` and `EntryId` are branded.

## Gotchas

- **Backlinks are derived, never stored.** `indexReferences` builds both
  directions in one pass, each list ascending by id. A stored list per target
  would be a child container created lazily under a key two writers share: the
  S18 shape, which lost a writer's value in 40 of 40 trials.
- **Spans are UTF-16 code units over `messageText`.** That is the string the
  client renders, so a DOM selection maps onto it directly. A surrogate pair is
  two units; the unit test pins it.
- **Only committed entries are citable.** A streaming message is not an entry,
  and its text is still changing, so an offset into it would not be stable.
- **Absent and textless are different facts.** `CitedEntry` keeps them apart:
  citing a compaction whole is allowed; a span on it is `invalid_span`.
- **It ships to the browser.** The client decodes references, so TypeBox is in
  the bundle: +42 kB raw, +12 kB gzipped when added.
