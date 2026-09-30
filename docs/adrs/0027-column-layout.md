# ADR-0027 — Open columns are kept per tab, with the device's latest as a fallback, and never in the document

**Status:** Accepted. Evidence: S29. Implemented by `PLAN-2026-09-26-persist-columns`.
Amended by ADR-0028, proposed (a stored layout holds the focused piece of
work), and by ADR-0029, which replaces that: a stored layout holds
the active root tab and each root's columns; and by ADR-0030: it
also holds your open roots. ADR-0037 makes a person their email, so a tab is
no longer a writer.

**Context.** Which columns are open is view state, never written (ADR-0024's
reasoning: which paths a person reads is theirs). Nothing else kept it either,
so a reload closed every column but one, and a new tab started from one.

**Decision.**
- **Two slots under one key** (`packages/client/tab-state.ts`): the tab's, in
  `sessionStorage`, which survives a reload; and the device's, in
  `localStorage`, which a new tab starts from. Every save writes both. This is
  the shape of Kyneta's `persistentPeerId` without its lease, since columns
  need no uniqueness.
- **Every change is saved,** `sync` moving a column on included. A column
  restored from an older anchor could follow a newer branch below it.
- **A stored layout decodes whole or not at all,** through a TypeBox schema
  with a version. An older one is dropped, not migrated.
- **A message waiting to be sent is never stored.** Restoring it would send it
  again; a "branch here" column comes back empty.
- **Anchors the document lacks are dropped once, after `whenSettled`.** Before
  then a missing anchor may only not have arrived yet. Entries are immutable
  and compaction keeps them, so an anchor can only be missing at load.

**Consequences.** Two tabs open at once keep their own layouts across reloads.
A new tab, or the browser reopened, gets the layout of the tab that last
changed, and with two tabs open that can be either, since both move their
columns as messages arrive. Duplicate Tab copies a layout. A layout does not
follow a person to another device: it is view state, kept per device, though
since ADR-0037 the person is the same on every device.

**Alternatives rejected.** `localStorage` alone (two tabs overwrite each
other). `sessionStorage` alone (a new tab starts empty). The session document,
per writer (it breaks "which paths a person reads is theirs", the host refuses
client writes, and a writer is a tab). The URL (long, noisy, and nothing for a
new tab). Saving only a person's own changes (stored anchors lag). Salvaging
the good columns of a malformed layout (only this build writes it). Pruning
at `"populated"` or `useDocReady` (both come with the first data).
