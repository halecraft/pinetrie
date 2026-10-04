# S101 — A person's read marks fit in a Yjs map without compaction for now; a write before the stored copy arrives can move a mark back

**Status:** Answered. Served `PLAN-2026-10-05-attention` (ADR-0077).

**Question.** ADR-0077 keeps, per person, the furthest entry read on each
thread in `attention:<writer>`, a Yjs document. Each read overwrites a key.
How large does the document grow, and how long does it take to load? And
must a tab wait for the host's copy before writing a mark, or can Yjs's
merge be trusted with a mark written early?

**Kill criterion.** 50 threads, each mark overwritten 2,000 times: over
1 MB encoded, or over 50 ms to load into a fresh document. Then throttling
alone is not enough, and compaction joins the plan.

**Throw away.** The probe (`.plans/s101-probe/probe.ts`, not checked in).

## Answers

**Size and load: under the criterion, close to it.** Yjs, the version
Kyneta's Yjs substrate bundles, `encodeStateAsUpdate` and `applyUpdate` on
a map of 50 keys, each set in turn, with ids shaped like uuidv7:

| writes per key | encoded | load (mean of 20) |
|---|---|---|
| 1 | 2.9 KB | 0.3 ms |
| 100 | 47 KB | 1.5 ms |
| 2,000 | 986 KB | 29 ms |

- An overwrite costs about 10 bytes, for good: a replaced value is
  collected, but its struct stays, so the document grows linearly with
  writes.
- One transaction per write, as throttled writes are, gives the same size.
- Six clients (a person's tabs and devices) taking turns give slightly
  less (903 KB): runs of one client's structs merge.
- With writes throttled to one per thread per 5 s, 2,000 writes on a thread
  is nearly three hours of reading that thread at its end. A person's
  document stays far under 1 MB for a long time, but nothing bounds it.
  Compaction stays a separate question, as ADR-0077 says, and is not part
  of this plan.

**A write before the stored copy arrives can move a mark back.** Client A
sets `lane` to `e100` and B, which has not yet received A's copy, sets it to
`e050`. Merged both ways, the higher client id wins:

| A's client id | B's client id | both end with |
|---|---|---|
| 1 | 2 | `e050` (moved back) |
| 2 | 1 | `e100` |

Written after B received A's copy, comparing first and writing only
forward, the mark stays `e100`. So a tab writes a read mark only after the
host's copy has arrived (`sync(doc).readyFor(host)`), the wait the
inventory already makes (S79), and only forward. This is the person
document shell's one write rule.
