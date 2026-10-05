# S55 — the order a turn's streams and entries are written in

**Status:** Answered. With S35, led to ADR-0044.

**Question.** S35 found that live work closes before its entry arrives. To
hand a stream over to its entry on screen in one render, the reader must be
able to tell, from one moment's document, whether a stream's entry is written.
Does the order in which the host writes a turn allow that?

**Answers.** Every assumption held, on the host's document and on a Node
client's, across three turns: a reply, a `bash` call, a `read` call and a
reply; a `bash` call stopped while it ran; and a reply stopped while it was
written.

1. **A1: a message's entry comes before its tools.** No tool stream was ever
   present without the assistant entry that holds its call. The entry was
   written 2–4 ms before the tool stream opened.
2. **A2: a message's tool results come before the next reply.** Whenever a
   reply stream opened, every tool call in the document had its result. Only
   one tool call per message was run: the scripted model issues one.
3. **A3: a reply's tip holds until its entry.** From a reply's first text to
   its entry, the lane's tip did not move. The entry was the tip's child and
   arrived with the tip (S35 item 3). The stream's last text equalled the
   entry's text, so no delta arrives after its message ends. This held for a
   stopped reply too: pi writes the partial message (60 characters of 2000)
   as an entry, and the stream held exactly those characters.
4. **A4: a run's entries come before `endRun`.** No entry arrived after a
   lane stopped running. A stopped `bash` call's result (`Command aborted`) was
   written 1 ms before `endRun`.
5. **A5: a client sees the host's batches in order.** A1–A4 held on the
   client's document too, change by change.
6. **A6: reading stream records is not reading their text.** A `reactive`
   (`@kyneta/reactive`, what `useTracked` runs) reading only `doc.streams()`
   kept its version through five `streamText` edits and advanced when a
   stream opened. One reading `readStreams`, text included, advanced on each
   edit.
7. **A7: a store opens after the stream row gains a field.** A store written
   with the old row, shut down mid-reply so that a stream record was in it,
   opened with the row that has `under`. The host cleared the old record at
   start, as it clears every stream.

## Consequences

- **The tip is the hand-over.** A reply is its lane's current reply while the
  lane's tip is where it opened (`isCurrentReply`, `packages/schema/index.ts`).
  The commit that writes the entry moves the tip, so the stream stops being
  current in the same change that adds the entry.
- **A stream can wait until the next one to go.** A reply opening deletes its
  lane's tool streams: by A2, their results are written. A tool opening
  deletes its lane's replies that are no longer current: by A1, their entries
  are written. `endRun` deletes the rest: by A4, the run's entries are
  written, and a stopped run writes its partial message.
- **App can read the records in its one `useTracked`** without re-rendering on
  every delta (A6).

## Not tested

- Two tool calls in one message. The scripted model issues one per message.
  A2 is still expected to hold, since the next request needs every result in
  its context.
- A real model, and a lane of its own (container). The order is pi's harness's
  and the host's, not the model's, so neither should change it.
- A peer of a different build than the host (S17 P1c).

## Method

- `sandbox/s55-live-handover/s55-probe.ts`: a scripted host with tools, and a
  Node client, each logging its document at every change: entries (parent,
  role, calls, result, text), each lane's tip, streams (kind, call, text) and
  running lanes. The checks for A1–A4 run over both logs.
- `sandbox/s55-live-handover/a6.test.ts`: two `reactive`s over a session
  document, one reading records only and one reading text too, and their
  versions after edits.
- `sandbox/s55-live-handover/s55-store.ts`: `write` runs a host on a store
  file and shuts it down mid-reply; `read`, with the new row, opens it.
- Each was copied into `apps/pinetrie/e2e/` (or `packages/client/`) to resolve
  the workspace's packages, and deleted afterwards.
