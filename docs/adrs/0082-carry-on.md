# ADR-0082 — After a Stop, Resume carries on with a new turn that a host message starts

- **Status:** Accepted
- **Area:** `docs/06-interface.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S70, S105
- **Amends:**
  - ADR-0056: a carry-on message, written when someone resumes after a Stop,
    starts an ask, and names who resumed.
- **Amended by:**
  - ADR-0048: a held queue does not hide Resume. Its cards wait for a release,
    not for this turn; cards queued and not held still do.
  - ADR-0113: Resume is in the dock's queue header; with a held queue there,
    sending the queue is the header's button and Resume is in its ⋯.

**Context.** Stop ends a thread's turn and records who pressed it
(ADR-0056). To go on, someone had to write a message to the agent, even
when all they had to say was "carry on".

pi cannot continue a run that Stop ended. Its `resume` continues only an
operation still open, as after a crash, and Stop closes the operation. A
new run must append at least one message. The model never sees a stopped
reply either: pi-ai leaves `aborted` and `error` assistant messages out of
every request. After a Stop mid-reply, the model sees its prompt and
nothing after it. After a Stop mid-command, it sees the call and "Command
aborted" (S70).

**Decision.**
- **Resume starts a new run with a host-written message**, as a split's
  stack message does (ADR-0038). It is a pi custom message,
  `pinetrie.carry-on`, holding the lane and who resumed. The model reads
  that the person asked it to carry on from where it was stopped, and that
  what it was writing then was not kept. A column shows "↻ resumed by
  <name>".
- **That run is an ask of its own**, after the stopped one. The stopped
  ask keeps its outcome.
- **Resume takes Stop's place in the column.** It shows while the thread is
  idle and the ask at its end ended stopped. Anything written at the
  thread's end hides it:
  - a message to the agent, whose run shows Stop;
  - a message to a person, which leaves no stopped ask at the end;
  - a card queued or taken, which makes the thread busy.

  An update message is not an ask, so a catch-up leaves Resume showing. It
  never expires.
- **One rule decides it for the host and the page:** `carryOnState`
  (`packages/rules/stop.ts`). `planCarryOn` gives the host's decision, the
  message or a refusal. The host runs it in one step on the documents'
  keeper, so two presses at once start one run, and refuse the other as
  busy.
- **In code it is "carry on"**, the `carry-on` command. "Resume" already
  names the host continuing a run a crash interrupted (`RunStart`'s
  `resume`). Only the button says Resume.

**Consequences.**
- After a Stop, one click carries on. Nobody writes a message no one meant.
- The thread holds one more line per resume, and the rail one more ask.
- A resumed run starts its reply again from the stopped request's context,
  plus the carry-on message. After a Stop mid-command, it sees that command
  aborted.
- The run reads the thread's pinned cards, as a split's does. Its start
  cannot be cancelled, as a split's cannot (`Runs.cancel`), so a Stop
  pressed during that brief read does nothing.

**Alternatives rejected.**
- **Park the stopped run and resume it**, through pi's deferred responses
  (S105). It works, and gives one run with no new message. It costs a
  provider wrapping the model's, a stop for tools outside pi's abort, a
  parked state through the host, its startup and asks, and a stored copy
  of each parked request. A parked lane also holds every queued card
  until someone resumes it or stops it again.
- **A plain "continue" chat.** It would be a person's message nobody wrote.
- **Fold the new run into the stopped ask.** An ask is one prompt and the
  run it started (ADR-0056).
- **The composer's send button reading "resume" on an empty box.** Carrying
  on is the column's, as Stop is: it sends no card and no text, and would
  go through a card's machinery for nothing.
