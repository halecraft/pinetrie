# ADR-0037 — A person is their email; each tab is a seat

**Status:** Accepted. Implemented by `PLAN-2026-09-28-kyneta-v4`. Evidence:
S29, S47. Amends ADR-0024 (presence keys per seat), ADR-0025 (authorship by
seat), ADR-0027 and ADR-0030 (your other tabs are you). Amended by ADR-0048:
the host writes a record of each seat's person (`pinetrie.seat`) as it
connects, so a text's writers can be named after they leave.

**Context.** pine·trie chose each client's Kyneta peer id and made its writer
from it: a browser tab took one from Kyneta's `persistentPeerId`, a Node
client made one up. Kyneta v4 takes that choice away. A CRDT replica may
write under an id only if no other live replica writes under it and it
holds everything written under it, which a caller cannot promise: a
duplicated tab shared one id (S29). So Kyneta now issues each Runtime its
peer id, a *seat*, from its store or fresh per session, and the caller names
only a *principal*: who the peer says it is, shared by any number of seats,
carried in `establish`, unverified. A writer needs a new source, and so do
the host's address, note authorship and presence keys.

**Decision.**
- **A principal is a person, and a person is their email.** A browser asks
  for email and name on its first visit (`identity-form.tsx`) and keeps both
  per device (`localStorage`, `pinetrie-identity`). The email, normalized
  (`normalizeEmail`), is the principal; the writer is `w-<email>`
  (`writerOfPrincipal`). A reload, a second tab and a second device with the
  same email are one person, each tab its own seat.
- **The name is a seed.** It is sent with `setName` on joining a session
  that has no name for you; afterwards the session's name is yours, renamed
  in your profile (the avatar at the header's right). A person with no name
  is shown by the part of their email before the `@`, which a mention
  reaches. *Amended by `PLAN-2026-09-29-profile`:* each device also keeps
  the session's name for you as its seed, so a session that has none learns
  the name you go by now. One decision, `reconcileName`, sends the stored
  name or stores the session's.
- **The host identifies the sender by transport, as before**: the principal
  of the seat a command's Line comes from. A principal that is not an email
  names nobody, and its every command is refused (`invalid_identity`).
- **The host is found by its principal,** `pinetrie-host`, which is not an
  email, so no person can claim it. A client addresses its Line to the seat
  `whenPeer` finds.
- **Presence is per seat, shown per person.** Every key starts
  `${writer}:${seat}`, so one tab never overwrites or clears another's; the
  view shows a person once. The writer must be in the key: a client sees only
  the host among its peers, so it cannot look up another tab's person.
- **Note edits are attributed by seat.** A seat's Yjs `clientID` is
  Kyneta's `yjsClientId(seat)`; the host maps the `clientID`s an edit moved
  to the principals of the seats connected when it arrives.
- **A command Line lives only between its ends, and only while its seat
  does.** The host shares a Line's documents with, and accepts them from, its
  two ends only; a departed seat's Line is destroyed, and a starting host
  deletes every stored Line: a client keeps no store and does not reconnect,
  so none can resume.

**Consequences.**
- Duplicate Tab is harmless: two tabs share a person, never a seat.
- Everyone in a session can read everyone's email: writer ids are in every
  message and replicated to every client. The model reads only display
  names.
- Unauthenticated, as before: anyone can type anyone's email. An email and a
  generated token will verify it later without changing this model.
- Two unnamed people with one local part share a label, and a mention
  reaches one of them: the same collision as two people choosing one name.
- A store-less client is a new seat on every load, so each session that
  writes a note's Yjs document adds one version-vector entry to it.
- Your tabs and your inbox are kept per device (ADR-0027, ADR-0030); only
  who you are follows you.

**Alternatives rejected.**
- A handle (`duane`) as the principal: a second namespace to keep unique,
  which an email login would replace.
- A principal per tab, in `sessionStorage`: your second device would be a
  stranger, and a duplicated tab would still share a writer.
- A Web Locks lease per tab: unneeded once a principal is a person.
- The handle as the display name, with no `setName`: no friendly name, and a
  rename would be a new person.
- Presence keyed by writer: one tab would clear another's typing, editing and
  columns.
- Leaving Line documents stored: harmless per visit, unbounded over time, and
  never read again.
