# S295 — can the tether take a thread's intent log into pi, and can the page draw the log and the record as one thread?

- **Status:** Answered

For ADR-0202: a thread's members append messages to its intent log (a Yjs
list, never edited in place, S291); the machine a lane is tethered to
judges each intent it has not taken against its own record and turns the
valid ones into pi entries; a message written against an older tip is
taken, framed by what its writer had seen. Today the host writes people's
messages straight into the root's tree (`Scribe.appendToTree`,
`ThreadLaneHandle.append`, `packages/pi/TECHNICAL.md`).

**Question.**

1. A tether reads a thread's log (a Yjs `Schema.list` of
   `{ id, kind, author, seq, parent, text }`) and appends each valid
   intent through pi, with `@pinetrie/pi`'s scribe and a scripted model:
   does a lane created at those entries read them as its context, and
   does the model's request hold them in order?
2. The tether's cursor is the set of intent ids in its record. Stopped
   mid-log and started again from its store, does it take each intent
   exactly once?
3. Two messages appended at once against the same tip, and one written
   against an older tip after an agent reply: as a pure plan over (the
   record, the log), what does the tether take, in what order, and with
   which framing case (ADR-0202's four)? Does the model's request carry
   the framing as one function words it?
4. An edit appended after the tether took a message: the record keeps
   the original, and a pure projection of (the record, the log) gives the
   page one thread with the message marked edited after the agent read
   it. What shape does that projection take beside today's column view
   (`packages/interface/column-view.ts`)?

**Kill criterion.** The tether does not work as ADR-0202 describes if pi
cannot read intents taken from a log as its context, or a restart takes
one twice or misses one.

**Throw away.** The probe and its pure plan, beside the e2e suites or in
this spike's folder, using pine·trie's packages without changing them.

**Answers.**

1. **pi reads intents taken from a log as its context, in order.**
   Two chats taken while the thread had no lane went into the tree through
   the scribe (`Scribe.appendToTree`), at its end. A lane created at the
   second chat then ran a third, compelled message. The model read the
   three last, in the record's order: `Ada: hello, Bea`, `Bea: hi Ada`,
   `Ada: @agent summarise what we said`. With a lane, each taken message
   but the turn's last went in with `ThreadLaneHandle.append`, and the
   last with `run`.
2. **A restart takes each intent exactly once.** The tether's cursor is
   the record itself: every taken message's `details.sendId` is its
   intent's id, so the ids taken are read from pi's tree. The tether took
   one of three messages and stopped. pi closed, and a new one started
   over a copy of the root document, with nothing kept in memory. The next
   step took the other two, and a step after that took none. In the end,
   each of the log's 12 messages was in exactly one entry. An edit was
   never taken (3 of 3 left as edits).
3. **The plan takes and frames the four cases as ADR-0202 has them**, as
   a pure function of the record and the log (`planTake`, `plan.ts`):
   - **Two messages against the same end** were taken in one turn, one
     run: the first as written, the second framed `same-time`, naming the
     first. The model read
     `(Bea wrote this at the same time as Ada's "…", before you answered.)`
     then her words.
   - **A message written against an older end**, after the agent had
     replied (Bea partitioned), was framed `before-reply`, naming the
     reply and the message it answered. The model read
     `(Bea wrote this before seeing your reply to Ada's "what about the
     deadline?". It may be out of date.)` then her words.
   - **A message written while the agent was replying** was not taken
     (`wait-for-run`). Once the reply was written, it was taken framed
     `before-reply`, naming the message the reply answered.
   - **List order is not the order written**: two messages appended at
     once came back in the log with Bea's first, though Ada wrote first,
     as Yjs orders concurrent inserts. The plan orders each pass by the
     records' ids, so it took Ada's first. Two runs gave the same output.
   One function (`framedContent`) words the framing, into the message's
   `content`, which is what the model reads. The words as written stay in
   `details.text`, unchanged: `PersonMessage` already keeps the two
   apart (`packages/rules/message.ts`), so no package changed.
4. **The page's thread is one pure projection of the record and the log**
   (`projectThread`). It is the record's path in its order, as the column
   draws it now from the tree, with three things added from the log:
   - each person's message as the log holds it now, with
     `agentRead` holding what the agent took when an edit came later
     (`Ada (edited after the agent read it)`);
   - each taken message's framing, recomputed from the record as it stood
     before the message. It matched the plan's at every take, so the case
     needs no storing;
   - the log's messages not taken yet, after the end, as pending. These
     are what queued cards show today.
   What the agent said comes from the record alone. An edit appended to
   the log naming the agent's first reply changed nothing drawn (`R1`),
   and neither did Bea's edit naming Ada's message: an edit is applied
   only when its author is the message's.

**Consequences.**

- The kill criterion is not met. **The tether works as ADR-0202
  describes, through pine·trie's own `@pinetrie/pi` unchanged**: the
  scribe for a thread with no lane, `append` and `run` on a lane, a lane
  created at chats the scribe wrote.
- **The cursor needs no store of its own.** The intent's id is the
  message's `sendId`, so pi's tree is both the record and the list of
  what was taken. The framing is recomputed from the record's order, so
  the record holds only what pi stores now.
- **A take is ordered by the records' ids, not by the list.** A writer's
  id must sort in the time it was written: a uuidv7, as every id the page
  mints is (`packages/session/ids.ts`).
- **A writer's parent is the end their page draws**, pending messages
  included, so a reply to a pending message waits for it
  (`parent-not-arrived` until its parent is in the log or the record).
- **A turn is everything ready at once**: all but the last appended, the
  last run. A message that does not compel the agent is appended with no
  run. Whether a turn should wait a moment for messages written at once
  is a choice for the plan, not measured.
- **The edit check here is by the `author` field**, which anyone can
  forge. Who wrote a log's record is S296's question.
- Not measured: a crash inside a run (its prompt entry is in the record,
  so its intent is never taken again; the run itself resumes as ADR-0197
  has it); the log through Kyneta's `Exchange` and a store rather than
  `createDoc` and `merge`; the column's own code drawing the projection.

**Method.** `probe.ts` and `plan.ts` in this spike's folder, run as
`apps/pinetrie/e2e/s295/probe.ts` with `node` in a Linux lane, twice,
the same output but for entry ids (`output.txt`). pi was
`startPi` over `oneRoot` (`packages/pi/start-pi.ts`, `one-root.ts`) with
a scripted model whose every reply recorded the context it was given. The
log was a Kyneta Yjs document per writer and one for the tether, each a
list of `.json()` records, synced by `exportSince` and `merge`. A
partition was a writer not synced. A writer's parent was the last row
of `projectThread` over the record they last saw and their copy of the
log. A restart was `pi.close()`, then a new root document filled from the
old one's export, and a new `startPi` over it. A run in progress was a
scripted reply held (`ScriptedModel.hold`).

