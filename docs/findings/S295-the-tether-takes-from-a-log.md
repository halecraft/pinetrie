# S295 — can the tether take a thread's intent log into pi, and can the page draw the log and the record as one thread?

- **Status:** Open

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
