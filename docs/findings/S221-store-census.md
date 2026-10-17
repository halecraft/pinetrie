# S221 — Duane's store is 38% bookkeeping: shared-file tracking of scratch folders and pi's per-message diagnostics, both in the documents the host reads most

- **Status:** Answered
- **Led to:** ADR-0176

Read from a copy of Duane's `pinetrie.db` (2026-10-17, 1.0 GB), opened
read-only with Python's `sqlite3`; each document's compacted record
(`"kind":"entirety"`) parsed as JSON and measured as compact JSON. The
probe was not committed.

## Brief

**Question.** What does the session's store hold, by document, by
namespace, and inside a root: conversation, records, or something else?
The host's stalls are loading, checking and compacting documents (S220),
so their sizes decide what to fix first: a metadata document, a memory
budget, lazy loading, or the data itself.

**Kill criterion.** If the conversation is nearly all of every root and
the session is small, the data is as it must be, and the fixes are in how
it is loaded and kept.

**Throw away.** The copy of the store (`sandbox/pinetrie.db`).

## Answers

1. **The file:** 1.0 GB. The documents' records are 832 MB, the images
   153 MB (387 blobs). SQLite's journal is the default (`delete`).
2. **The session document is 109 MB, and 97 MB of it is shared-file
   lineages** (`pinetrie.shared`): 140,100 paths, 308,388 versions,
   392,001 `read` entries. Most are scratch folders inside `.plans/`,
   `sandbox/` and `media/`:

   | folder | paths | MB |
   |---|---|---|
   | `sandbox/basews` | 25,720 | 8.1 |
   | `sandbox/speedy-sparrow-base` | 22,567 | 5.6 |
   | `sandbox/.pnpm-store` | 18,124 | 24.1 |
   | `.plans/.pnpm-store` | 17,817 | 6.5 |
   | `media/noun-icons` | 16,923 | 10.2 |
   | `.plans/noun-icons` | 16,922 | 24.6 |

   The rest of the session is under 3 MB: `pinetrie.base` 1.75 MB, every
   other namespace under 0.3 MB. This is the 2.6 s stall at a host's
   start (S220), and every compaction of the session writes all 109 MB
   again.
3. **The 212 roots are 723 MB. The conversation's entries are 547 MB:**
   assistant messages 370 MB, tool results 137 MB, custom 29 MB, pi's
   compactions 7 MB. Revision records are 86 MB, usage rows 23 MB.
4. **Inside assistant messages, `diagnostics` is 161 MB,** more than
   their content. Each is pi's `anthropic_input_transformations`: a list
   naming every earlier thinking block the request dropped
   (`thinking_dropped`, reason `prefix_binding_mismatch`). The list grows
   with the conversation, so its total grows with the square of a
   thread's length. Thinking signatures are 81 MB, tool-call arguments
   51 MB, thinking text 21 MB, text 8 MB. Not answered here: why every
   request drops earlier thinking.
5. **Revision records are 86 MB, and 64 MB of it is the shared files a
   turn touched** (`disk.shared`; `read` alone 60 MB). Single records
   reach 2.4 MB. A refresh's first-prompt read checks all of a root's
   revision records (S220).
6. **One root holds 24,088 records not compacted** (19.9 MB), a lane
   running through many turns: loading it replays each one. Three others
   hold 2-3.
7. **About 320 MB of the 832 MB is bookkeeping, not conversation:**
   shared-file tracking (97 MB in the session, 64 MB in revision
   records) and diagnostics (161 MB).

## What it points to

- **Scope what is tracked as shared, before any caching:** a package
  store, a copied workspace or an icon set in a shared folder becomes
  thousands of lineages that live in the session forever, and thousands
  of paths in each turn's record.
- **Store an assistant message without pi's diagnostics,** or the newest
  only. Whether the dropped thinking costs the model anything is a
  question of its own.
- **Then size the remaining architecture questions against what is
  left:** the session would be about 3 MB, and the roots about 75% of
  their size today.
