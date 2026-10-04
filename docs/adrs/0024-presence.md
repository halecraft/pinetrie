# ADR-0024 — Presence is ephemeral, per open column, written by each client

**Status:** Accepted. Implemented by `PLAN-2026-09-27-presence`. Amended by
ADR-0029: only the columns of the root tab you are on report; and by
ADR-0037: every key is per seat, so a person here from two tabs has two sets
of entries, shown once. Amended by ADR-0048 (step 3,
`PLAN-2026-10-01-notes-removed`): `editing`, the note a seat was editing, is
removed with notes. Amended by ADR-0077: presence's verb is *reading*; a
person follows a thread they have written on, and a column follows its end.

**Context.** Several people share a session, each with their own columns, and
nothing showed who else was there. The composer's "seen by" was removed because,
without presence, any list was a guess. Notes will need "who is editing this".

**Decision.**
- **Presence is a Kyneta `ephemeral` document** (`pineta:presence`): never
  stored, last writer wins per field, and every field decays to `null` without a
  fresh write. Leaving needs no message: a person's entries go quiet and decay,
  which is also what a crashed tab does.
- **Thread-level, and per open column.** Pineta has no focused column: every
  open column reports the end of the thread it follows (`reading`, keyed
  `${writer}:${seat}:${columnKey}` since ADR-0037), refreshed every 10 s while
  the page is visible and deleted when the column closes. `typing` and
  `editing` are one per seat (`${writer}:${seat}`).
  What is on screen, message by message, waits until thread-level proves too
  coarse.
- **Written by each client, and untrusted.** A client writes only its own keys,
  but nothing can enforce that, just as the principal a client names is
  unverified (ADR-0037).
- **The host refuses client writes to the session document.** A policy
  (`host/policy.ts`) accepts presence and refuses the session; until now nothing
  stopped a client writing the session directly.
- **Shown where there is room.** The rail's 8 px dots take a ring in the
  person's colour, with a count when several share one; the column header
  names others following that thread (the "seen by" that returned); the
  composer says who is typing. You never see yourself.

**Consequences.** A decayed key stays in the record holding `null` (Kyneta
keeps it), so readers skip nulls: fields are nullable, so absence is never a
sentinel string; a crashed tab's keys stay empty until the host
restarts. Documents bound with different decays still sync, so a suite runs
presence with a short decay.

**Alternatives rejected.** Presence in the session document (stored and
compacted for data that lasts seconds, and clients cannot write the session).
Heartbeats with explicit leave messages (the leave is what a crash never sends).
Initials on the rail's dots (no room). A focused column (Pineta has none).
