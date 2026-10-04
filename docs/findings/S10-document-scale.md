# S10 — Does the document shape scale?

**Status:** Open, not blocking. Partly discharged by S14: writes stay linear
to n=50 000 (`docs/findings/S14-revalidate-fixed-kyneta.md`). Snapshot size
and sync payload remain.

## Brief

**Size:** M · **Depends on:** S2 · **Raised by:** S7 residual #2

**Question.** S7's largest trial was ~40 entries. Real sessions run to tens of
thousands. How do `exportSince` size, snapshot time, and memory behave for a
`Schema.record` with 10k+ entries and large tool-result blobs?

**Kill criterion.** If snapshots or sync payloads grow unacceptably, we need
per-entry document granularity or shallow snapshots — a document-shape change,
so better known before the adapter is built on the current shape.
