# S282 — A host stopped mid-run leaves pi's operation open, as a crash does, and a resume answers what was appended meanwhile

- **Status:** Answered
- **Led to:** ADR-0197

**Question.** A thread's run was in flight (waiting on the model) when its
host was stopped with Ctrl-C. After the restart, every message sent to the
thread was accepted and never run. The store held pi's operation open on
the lane (`pi.lane.state`'s `currentOperationId`), with the messages as
`pi.pending.entry` items in its inbox. `pinetrie:live` named no running
lane: the run's end had carried out `end-run` as the agent closed.
1. Does closing an agent (`Agent.close()`) while a run waits on the model
   leave the lane's operation open in the document, so that the next
   agent's `interrupted` lists it?
2. Is a `run` on that lane then refused with `busy`?
3. What does an `append` on that lane do?
4. Does `resume` then drive the operation, what becomes of what was
   appended, and is a later `run` admitted?
5. In what form does a close reach a run or a resume: in flight, before it
   is called, and on an agent that never built the root's harness? Which of
   them leave the operation open?
6. What does a Stop (pi's `abort`) do to a resume in flight?

**Kill criterion.** If closing an agent ends pi's operation, the field
report has another cause, and a fix that keeps the lane marked running
across a shutdown would resume nothing.

**Throw away.** The probe, a test added for the run to
`packages/pi/lanes.test.ts`'s `lanes in a harness` and then removed. It
used that block's `setUp`. A run was held on the model
(`ScriptedModel.hold`) until the request arrived, then
`first.agent.close()`. A second agent was started with `startPi` over the
same document, as the block's crash test does. Each answer below was read
from its output.

**Answers.**

1. **Yes.** The first run's promise rejects with `HarnessClosed: AgentHarness
   was closed while the operation was active`. The second agent's
   `interrupted([root])` lists the lane. pi's `Harness.close`
   (`pi-agent-core/dist/harness/runtime/harness.js`) seals each lane and
   closes the session, and writes nothing to the operation. To pi, a clean
   stop and a crash leave the same state.
2. **Yes:** `{ kind: "refused", code: "busy" }`, through `laneErrCode`'s
   `LaneBusy`.
3. **It is queued, not written.** The append returns `appended` with an
   entry id. pi's `appendMessage` on a lane with an operation open puts the
   message in the operation's inbox (`pi.pending.entry`) and changes no
   entry. That is where the field report's messages were.
4. **`resume` returns `ok`.** It drives the operation, and the interrupted
   request leaves an empty assistant entry, which the resumed reply follows.
   **The appended message is answered as a follow-up turn of the same
   operation:** it is written after the resumed reply, and a second model
   request reads it as its last user message. After that, `interrupted`
   lists nothing, and a `run` on the lane is admitted (`ok`).

The tree after the probe, parent first:

```
system → "probe-hold" → assistant [] (the interrupted request)
  → reply-1 (the resume) → "probe-queued" (appended while open)
  → reply-2 (its follow-up) → "probe-third" (a run after) → reply-3
```

So a message a person sent into the open operation is answered once the
operation is resumed, as a follow-up turn, without the context a run is
given (pinned cards, the canvas, the base's news). Only one appended
message was measured. With the harness's `followUpMode: "one-at-a-time"`,
several should each be a turn of their own, but that is not measured.

A second probe, built the same way, answered 5 and 6:

5. **Only a drive in flight sees `HarnessClosed`, and only it leaves the
   operation open.**
   - A `run` or a `resume` waiting on the model when its agent closes rejects
     with `HarnessClosed`. After a resume closed this way, the next agent's
     `interrupted` lists the lane again.
   - **`Agent.close()` closes the harnesses, not the agent.** A later call on
     a root whose harness it closed rejects with `HarnessFault`, for `run`,
     `resume` and `append` alike, and opens nothing. The next call builds a
     new harness over the session the old one closed. A later call on a
     root it never built a harness for builds one and runs (`ok`).
   - No case returned pi's `Closed` result.

   From pi's source (`pi-agent-core/dist/harness/runtime/lane.js`): `seal`
   calls `closeGate` on the lane's active drive alone, which rejects that
   drive's completion with the harness's `HarnessClosed`. A call admitted
   after the close meets `assertOpen` or the closed session first.
   `HarnessClosed` is exported from `@earendil-works/pi-agent-core`'s
   index.
6. **A Stop ends the resumed operation.** `abort` during a resume makes the
   `resume` return `ok`. `interrupted` then lists nothing, an `append`
   lands in the tree (parented at the aborted reply), and a `run` after is
   admitted. Each request a close cut off leaves an empty assistant entry
   whose `stopReason` is `error`; the aborted one's is `aborted`.
