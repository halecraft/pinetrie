# S10 — Does the document shape scale?

- **Status:** Answered (by S14 and S84; not run itself)

Answered by S14 (writes) and S84 (snapshot size and sync payload), whose
measurements set off the change of shape its kill criterion named (ADR-0063).

## Brief

**Size:** M · **Depends on:** S2 · **Raised by:** S7 residual #2

**Question.** S7's largest trial was ~40 entries. Real sessions run to tens of
thousands. How do `exportSince` size, snapshot time, and memory behave for a
`Schema.record` with 10k+ entries and large tool-result blobs?

**Kill criterion.** If snapshots or sync payloads grow unacceptably, we need
per-entry document granularity or shallow snapshots — a document-shape change,
so better known before the adapter is built on the current shape.

## Answers

Answered on 2026-10-17 from other spikes' measurements, with nothing run
for this one.

1. **Writes scale.** S14 measured linear writes to n=50 000 on fixed
   Kyneta: 626 ms for entries, 739 ms for lists.
2. **The snapshot did not scale, and the kill criterion fired.** S84 read
   Duane's store on 2026-10-03. The session was one document of 22,310
   entries. Its entirety was 124 M characters, 4.3× under V8's string
   limit. Each run's end compacted all of it to drop under 1 MB, and each
   tab load made the host build and send all of it. ADR-0063 made the
   change of shape this spike's kill criterion asked for: a document per
   root, one for the session's records, and one for what is streaming.
   Split that way, the largest of S84's 57 roots was 2,114 entries
   (13.6 MB), the 90th percentile 5.6 MB, and the median 0.9 MB.
3. **Sync payload.** A tab opens only the documents of the roots it shows
   (ADR-0063), not the session's history. The per-message residue S4
   measured (9.6 KB per 2.7 KB message) is gone, because every document is
   compacted (ADR-0023, ADR-0014 as amended).
4. **Large tool results** are blobs, kept by SHA-256 outside the
   documents. The documents hold only a reference (ADR-0042, ADR-0051).

What is left is the cost of each root the host holds in memory. It is
a cost of how many roots are loaded, not of the document's shape.
