# ADR-0025 — Notes: a message opened for everyone's editing, or a draft of the next one

**Status:** Superseded by ADR-0048 (step 3): notes on messages are removed,
with their records, done and reopen, the notes index and the rail's
squares; what you write is a card. Removed by
`PLAN-2026-10-01-notes-removed`. Was: Accepted. Implemented by
`PLAN-2026-09-27-notes`. Amended by
ADR-0026 (a queued state; the host refuses no write to a note that
has a record), and by ADR-0037 (a `clientID` names a seat, and the seat's
principal the person). Amended by ADR-0043 (a note is drawn below its
message, and one opened on a message starts empty). Amended by ADR-0048:
shared drafts and "compose together" are withdrawn; the next message is
drafted in a card, which everyone at its thread's end sees and can edit.

**Context.** People could only append messages. There was no shared text to work
on together (a spec, a plan, the next instruction written jointly), no way to
take up an agent's reply and refine it, and nothing marked work as finished.
The roadmap's "shared composition" was the same want, started earlier.

**Decision.**
- **A note is a message opened for editing, or a draft of a thread's next
  message.** Anyone in the session can open any message, the agent's replies
  included; opening it again gives the same note. "Compose together" at a
  column's composer starts its thread's draft, or joins the one it has.
- **Entries stay immutable (ADR-0004), and the model reads them as sent.** A
  note's living text is its own document; it reaches the agent only when sent
  (a draft) or folded (`PLAN-2026-09-27-fold`).
- **Where each part lives (ADR-0023).** The text is a Yjs document per note
  (`note:<id>`), the one place people type together. The record (state, what it
  is the text of, contributors) is a host-written `pineta.note` session value.
  Who is editing now is presence (ADR-0024).
- **The lifecycle: draft, open, done.** A draft is sent through the one send
  path, so a busy lane queues it and a raced reply is a conflict that keeps the
  draft; sent, it is done and linked to its message by the send's id. Mark done
  and reopen are deliberate; a reopened note, once edited, reads "changed since
  done".
- **One draft per thread end.** A draft keeps its place as a send carries it
  (where it started, and its column's lane) and is resolved by `threadOf`
  whenever it is needed, so it follows its thread as the thread grows. Each
  person's own composer stays private.
- **Authorship from the operations.** Kyneta gives each peer's Yjs `clientID`
  from its seat (S26 addendum, ADR-0037), so the host attributes each edit by
  matching the `clientID`s whose clocks moved against the seats connected when
  it arrives, each the person its principal names. A deletion counts: Kyneta
  ticks a Yjs clock for it. A sent draft is its sender's message, "with" its
  other contributors. This is as trustworthy as principals, which are
  unverified.
- **Done is enforced by the host.** Its write policy accepts a note's document
  while the note is a draft or open, and refuses it once done or when no record
  names it. With presence, that keeps clients to note and presence documents.

**Consequences.** A note's Yjs document is never compacted: Kyneta cannot
compact a live Yjs document (S24). At note sizes its history is small; it is
recorded as an upstream item. A write the host refused stays in that client's
replica, and that client's later edits to the note build on it, so they do not
reach the host either, even after the note is reopened (measured; S26 addendum
2). The screen never offers a done note for editing, so only a client writing
directly can do this. Pineta computes a seat's `clientID` with Kyneta's own
`yjsClientId`; a test pins it to a real document. Yjs adds about 36 kB
gzipped to the page.

**Alternatives rejected.** A note as a separate record anchored beside a message
(a note *is* the message, opened; the conversation about it is its branch).
Editing the entry itself (breaks ADR-0004 and the model's reproducible view).
Contributors reported by the client (the operations already carry their
authors, correctly under relays). Several drafts per thread end (a second draft
is a split; each person has their private composer). Deriving "changed since
done" when read (it would open every note's document to filter the index).
