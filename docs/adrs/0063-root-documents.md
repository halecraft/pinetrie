# ADR-0063 — A root is a document; what is streaming is another

- **Status:** Accepted (Duane, 2026-10-03)
- **Area:** `packages/schema/TECHNICAL.md`, `docs/01-architecture.md`
- **Evidence:** S30, S84, S85, S86
- **Amends:**
  - ADR-0021: a session is a document per root, a session document of its
    records, and one of what is streaming; it is still the boundary of who is
    in it.
  - ADR-0023: the session is a `json` document per root, a session document
    and `pinetrie:live`, each compacted alone.
  - ADR-0029: the archive record is keyed by the root's `RootId`, and the
    Archive tab searches labels only.
- **Amended by:**
  - ADR-0066: a new tab mints its `RootId` as it opens, not at its first send;
    a fresh card's place carries a `Spot`; `places` is Yjs, not `json`.
  - ADR-0077: a root's directory record holds who has written on each of its
    threads (`threads`), and the directory refreshes a root's record as the
    host opens it.
  - ADR-0085: the archive record goes; a root is archived while its board
    place, keyed by its `RootId`, is in the closed state, and the Archive
    tab's search over labels is the closed state's.
  - ADR-0092: a root is released through the scribe, which closes the agent's
    harness over the root's one pi session, then the session; the session
    document has a session and no harness.
  - ADR-0095: the session's document has its own schema, `SessionDoc` (the
    host's records alone), and a root's is pi's storage plus `records`.
  - ADR-0116: a root is the unit of storage, not of work; the host holds the
    roots of open tasks' threads.
  - ADR-0162: the host no longer holds every root that is not archived. A root
    is loaded while a keeper step or a lease holds it, and a starting host
    opens only the roots of lanes a crash interrupted a run in.

**Context.** The session was one Kyneta document, `pinetrie:session`: pi's
storage for every root ever started, the host's records, and what is
streaming now. Kyneta's plain substrate stores and sends a document as one
string, `exportEntirety()`. By 2026-10-03 it was 124 M characters, 4.3× under
V8's string limit of 2^29−24 (S84).
- Each run's end compacted it: 124 MB read back and parsed, and 124 MB
  written with a 125 MB journal, to drop under 1 MB of streams and pending
  lists.
- Each tab load made the host build and send all of it, and every reader held
  all of it.

In Kyneta the document is the unit of storage, compaction, sync and memory.
pine·trie's root is already the unit people work in: a tab (ADR-0029), a tree no
lane leaves (S30).

**Decision.**

- **Three kinds of document.** All are `json`, and the host writes them all.
  - `root:<RootId>`, one per root (`StorageDoc`): that root's pi storage
    (entries, usage rows, pi's values and lists, checkpoints) and the host
    records keyed by its entries (revision, mark, stop, digest).
  - `pinetrie:session` (`StorageDoc` with no entries): the session-wide
    records. These are the directory of roots (`ROOT`), every lane's record
    (`LANE`, naming its root), the other lane-keyed records (name, offer,
    banner, base, landing), the archive and the singletons. The header and
    the tab bar read them across roots, and they are small.
  - `pinetrie:live` (`LiveDoc`): streams, their text and active runs. It is
    needed by no restarted host, and compacted at every run's end.
- **A root's id is a `RootId`, minted by its tab**, as a column mints its
  lane's id (ADR-0057). It is not the root entry's id: Start Agent creates
  the lane at the root before pi writes the first entry, and pi mints that
  id. `ROOT.entry` maps one to the other. Every per-root session record
  is keyed by `RootId`, except the archive: it stays keyed by the root
  entry, which every client already keys tabs and layouts by, and the host
  maps it through `ROOT.entry`.
- **A record names its home in its type**: `RecordSpec<R, K, H>`, with
  `H` either `"session"` or `"root"`. A root-homed write takes its root, so
  a write cannot reach the wrong document.
- **A command or a place that points at an entry carries a `Spot`**,
  `{ root, at }`. A queued card carries its lane's root, from `LANE`.
- **The directory is the only cross-root read.** The host refreshes a root's
  `ROOT` record whenever the root's document changes. The tab bar, the
  Archive tab, the inbox and the header read it. A tab opens only its own
  root's document. What the header opens in a root the tab does not hold
  (a person's thread, a run, an offer) shows that root's tab, and then the
  entry once it has arrived.
- **Presence names a column's root.** `readingRoot` beside `reading`, keyed
  and decaying the same, gives the root entry of the thread a column
  follows, so another window can name and open a root it has not loaded.
  `typing` has none: only a column that shows the root draws it.
- **The Archive tab searches labels**, not every message. Searching every
  message would mean opening every root.
- **The host holds the roots that are not archived.** Archiving `unload`s a
  root, once pi has closed its harness over it, and a client's request loads
  it again. Kyneta does that only for a
  host that declares `{ authority: "self" }` (S86).
- **A client declines every root it has not opened.** Kyneta takes in every
  announced document whose schema a client knows, and every root shares the
  session's schema (S86). Kyneta asks `canShare` as `get` opens a document,
  so a root is allowed before it is opened, or it is never asked for.
- **A run's end compacts what changed**: the roots its lanes ran in, the
  session, `pinetrie:live` and the places.

**Consequences.**

- No document grows with the whole session: the largest root today is
  13.6 MB. Compacting it takes 182 ms, and the median root 18 ms, against
  1,498 ms for the one document (S84).
- A tab load costs its own root. A closed tab holds no root.
- pi runs a session and a harness per root, about 0.35 ms and 49 KB each
  (S84). Lanes in two roots never wait on one another's commits.
- Duane's store was carried over once, on 2026-10-03, by a one-off
  script (`scripts/split-session.ts`, over a pure `planSplit`), deleted once
  it had run. It carried 60 roots, 86 lanes and 388 session records over in
  about 4 s, and dropped 4 usage rows whose entries were gone. A store from
  before this ADR no longer opens; for another such store, restore the
  script from the revision before its deletion.
- A command names its root, so the host can leave a root unloaded and still
  refuse a command at an archived one.

**Alternatives rejected.**

- **Compact less often, or by size.** That cuts writes, but the one document
  still grows toward the string limit, and every reader still pays for it.
- **Move only what streams to its own document.** A fresh client would
  still receive every root as one string.
- **Chunked export in Kyneta.** That treats the string, not the granularity:
  memory, interest and unload stay all or nothing.
- **Key a root's document by its root entry.** pi mints the root entry's id
  after the lane exists.
- **Carry the root on `Position`.** That touches about 98 call sites that
  never leave a root. A `Spot` carries it where it crosses one.
- **Find an entry's root from a map on the host.** The host could then
  never leave a root unloaded.
- **Full-text search in the Archive tab.** It would open every root for one
  search.
