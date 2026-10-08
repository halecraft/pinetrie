# S24 — compaction by substrate: json, Loro, Yjs

- **Status:** Answered
- **Led to:** ADR-0023, ADR-0025, ADR-0026, ADR-0028, ADR-0048

**Answers.**
1. **`json.bind` (authoritative) compacts a live document, and loses nothing
   that matters.** Kyneta's `compact()` replaced 327 KB of records with the
   current state (under 1 KB). A fresh host rebuilds from it, and a client
   disconnected before the compaction reconnects and converges: its version
   cannot be served as a delta, so it receives the whole document.
2. **Kyneta cannot yet compact a live Loro or Yjs document.** `compact()` throws
   "advance() on a live Loro/Yjs substrate is not yet supported. Use advance()
   on a LoroReplica/YjsReplica instead."
3. **Loro: a full snapshot keeps all history, so compacting to one saves
   nothing** (356 KB, against 312 KB of records). **A shallow snapshot drops the
   history** (49 KB against 289 KB, in pure Loro), and then a peer that was
   behind it cannot send its offline edits: "Import Failed: the dependencies of
   the importing updates are not included in the shallow history". Those edits
   are lost unless re-applied. The host can still bring that peer up to date.
4. **Yjs compacts without that trade-off.** The state as an update, with garbage
   collection on, was 49 KB against a 287 KB update log (pure Yjs). Deleted
   content is dropped; the structure that merging needs is kept, so a peer
   disconnected before the compaction still merges its offline edit, and both
   converge.
5. **Before compaction, the three cost about the same** for the same work:
   json 327 KB, Loro 312 KB, Yjs 300 KB of records. The choice is about what
   compaction can reclaim, and what it costs whom, not about write cost.

## Why it was asked

pine·trie's store only grows: every tool run adds its output, twice (S22), and
nothing reclaimed it. Kyneta's store fix (S22 addendum) reworked `compact`.
The question widened to which substrate each kind of pine·trie document should
use. An authoritative document, written by the server alone, could compact
freely. A collaborative one needs a CRDT, and compaction then trades something
away.

## Result

A workload like a pine·trie tool run, on each of Kyneta's `json`, `loro` and `yjs`
targets:
- a text written as tail edits (120 snapshots of a 50 KB tail-kept view), then
  deleted;
- a 50 KB value set, then deleted;
- small values that remain.

The server wrote with a pause between steps, so records were written as the work
happened, as in the host. A first run without the pauses let Kyneta coalesce the
work into 4 records, written after the deletions, and Yjs's garbage collection
then never stored the deleted content (51 KB). That is real, but it is not the
host's pattern.

| target | records before | live `compact()` | fresh host from the store | client disconnected before, reconnecting |
|---|---|---|---|---|
| `json` | 327 KB, 125 records | ok: under 1 KB, 2 records | same state | converges |
| `loro` | 312 KB, 125 records | throws | same state | converges (no compaction happened) |
| `yjs` | 300 KB, 125 records | throws | same state | converges (no compaction happened) |

What compaction would keep, measured on the native documents, with a peer cut
off half-way that then edited offline (pure Loro and pure Yjs, no Kyneta in
between):

| compaction | size | late peer's offline edit | late peer catches up |
|---|---|---|---|
| Loro full snapshot | 289–356 KB (all history) | merges | yes |
| Loro shallow snapshot | 49 KB (current state) | **refused** | yes |
| Yjs state as update, gc on | 49 KB (current state) | merges | yes |

A Kyneta-level attempt at a hand-built Loro shallow store gave a 277 KB
"shallow" record that a late peer merged with. It contradicted Loro's docs and
the pure-Loro result, was not understood, and is set aside.

## Consequences

1. **An authoritative document belongs on `json.bind`.** It is written by one
   writer, compacts live, and a reconnecting client simply receives the whole
   document. pine·trie's session document is written only by the host: clients
   send commands (ADR-0007, ADR-0018). It fits, and it would drop Loro, and its
   wasm, from the browser.
2. **A collaborative document belongs on Yjs.** It compacts without refusing
   late peers, and needs no wasm. pine·trie's first one is shared composition
   (drafts written by tabs). Live compaction needs Kyneta support first.
3. **Loro's compaction is a choice between no gain and refusing late peers.**
   Nothing pine·trie plans needs Loro's history (time travel, versions).
4. **Open questions for moving the session document to `json.bind`:**
   - pi's storage conformance and pine·trie's suites on the plain substrate;
   - whether the plain substrate's in-memory op log is trimmed, or grows until
     compaction;
   - what triggers compaction, and what a whole-document resend costs a
     reconnecting client;
   - that one host is the session's only writer (S21 Q2's "second host" would
     then be a replica, not a co-writer).

## Method

Disposable probes, not checked in: one through Kyneta (`Exchange`, in-memory
stores, the bridge transport, each binding target), and one each in pure Loro
and pure Yjs for the late-peer cases. Each ran at least twice with the same
results. Kyneta's own tests for its store change could not be run from pine·trie's
sandbox.
