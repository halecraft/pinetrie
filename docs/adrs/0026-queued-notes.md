# ADR-0026 — Everything queued is a note; the queue waits at a note someone has open

**Status:** Superseded by ADR-0048 (step 3) and ADR-0055, never built:
`PLAN-2026-09-26-queued-notes` was replaced by
`PLAN-2026-10-01-queued-cards`. A queued message is a queued card, which
anyone can edit or unqueue; the take is one synchronous step on the host
(S69). The hold while someone types in a queued card is built by ADR-0048's
step 7 (`PLAN-2026-10-05-queue-control`) as presence `typingIn`, set by each
keystroke and lapsing 3 s after the last, with no release: the host pops no
top card someone types in. A thread's own hold, which anyone sets and
releases, is step 7's too. Was: amends ADR-0020 (the outbox) and ADR-0025 (the lifecycle, and
how done is enforced). Evidence: S20, S21, S26, S28.

**Context.** A message waiting for a busy lane sits in `pinetrie.outbox` as a
frozen copy of its text. It cannot be cancelled or changed, and someone who
wants a waiting instruction to take something into account can only send
another message, whose place relative to that instruction depends on timing.
People are also to leave work queued and walk away: a series of instructions,
shaped together, later with conditions ("if the tests pass, write the plan").
That calls for a queue whose items can be edited while they wait.

**Decision.**
- **Everything that waits is a note.** A message that must wait for its
  thread's lane (the lane runs, or already has messages waiting; ADR-0020)
  becomes a note in state `queued`, with its lane and its sender. This holds for
  plain and compelled messages alike, whether sent from a composer or as a
  draft. Its text is the note's Yjs document, which anyone can edit while it
  waits, with edits attributed as in ADR-0025. `pinetrie.outbox` is removed. A
  message sent to an idle thread is written at once, as today, and is not a
  note. A queued note is not a draft, so a lane may have many queued notes, and
  "one draft per thread end" still holds.
- **To inform a waiting instruction, edit it.** Items are taken in queue order.
  Someone who wants a step to see something edits that step; a new message
  joins the end of the queue.
- **The queue order is stored,** not derived from ids, so steps can later be
  reordered.
- **Taking.** When the lane is idle, the host takes queued notes in order. It
  reads each note's text at that moment and sends it: appended if it is plain,
  run if it is compelled. The message is the sender's, with the note's
  contributors (ADR-0025). The note is then done, linked to its message by the
  send's id, as a sent draft is.
- **The queue stops at a note someone has open.** The host does not take a note
  that anyone is editing (presence `editing`, ADR-0024), nor anything queued
  behind it. The host cannot know that a note was left open by mistake.
  Besides the end of a run, a change to `editing` also triggers a drain step;
  presence changes, decay included, reach the host as events (S28).
- **Anyone can release the hold.** A release is written to the note's record,
  with who made it, not to presence. It lasts until the note is taken, and until
  then the host ignores presence for that note. The person editing is told
  who released it, and may keep typing until the note is taken.
- **Anyone can cancel a queued note.** It leaves the queue, keeps its text, and
  records who cancelled it (state `cancelled`). Cancel and take both run in the
  host's serial executor, so a cancel that arrives after the take is told the
  note was already sent.
- **The host refuses no write to a note that has a record.** Taking a note
  freezes its message, not the note itself. A write that arrives after the take
  is accepted, stays in the note, and marks it changed since done. The same
  holds for a write that crosses a "mark done" in flight. The screen offers no
  editor for a done note, but the host no longer refuses such a write. A write
  to a `note:` document with no record is still refused. Reason: a refused
  write cannot be recovered from. The writer's later writes wait on the host,
  never integrated, and a fresh replica under the same peer id collides with
  them and corrupts the text (S28).

**Consequences.** The lifecycle becomes: draft, then queued, then done; queued,
then cancelled; open, then done, then reopened. Draining has a third trigger,
presence, and a lane can now be idle while its queue waits on someone editing.
The composer's "queue" promise (running, or with messages waiting) still holds.
A hold is only as reliable as presence. Today the client refreshes `editing`
only on focus and input, so a focused note left untouched lapses after the
decay (30 s). The client must refresh it for as long as the editor has focus.
Browsers throttle timers in hidden tabs beyond that decay, so a hold kept only
by a hidden tab still lapses. Presence is empty when the host starts, so the
host waits one presence refresh (10 s) before taking anything, which gives
someone still in a note time to be seen. Presence is untrusted: any client can
claim to be editing and so hold a lane, which a release undoes. Every queued
message now has a Yjs document, which is never compacted (S24) and which the
host holds for as long as it runs. The storage cost grows with use of the
queue until Kyneta can compact live Yjs. A note's editor must accept no input
until the note has synced, or a reload followed by fast typing corrupts it
(S28); this was already true of every note. ADR-0025's "done is enforced by the
host" becomes "done is shown, and writes after it are marked". A client
that writes directly can change a done note's text, and the note then reads
"changed since done". What these notes make possible, but does not decide: a
condition as a field on a queued note, checked by a run in the lane that ends
with a structured verdict, with both runs in the tree; and Stop pausing an
unattended queue rather than letting it drain.

**Alternatives rejected.** Cancel as removal from `pinetrie.outbox` (the text
stays frozen at send, and it would be replaced at once). Two lists, one for
ordering and one for a plan of steps (the order between them would have to be
chosen, while editing a step is the direct way to inform it). Returning a
cancelled message to the canceller's composer (anyone can cancel, so it may be
someone else's message). Taking an open note after an idle timeout (a person,
not a clock, decides that it was left open by mistake). Taking the notes
behind an open one (later steps may depend on earlier ones). Refusing writes
once a note is taken and having the client recover by fetching the note again
(S28: this corrupts the text).
