# S105 — a Stop can park a run as a pi deferred suspension, and Resume continue it

- **Status:** Answered
- **Led to:** ADR-0082, ADR-0106

ADR-0082 chose a new run with a host message over a parked run.

Measured in a lane (Linux, Node 24, pi 0.87.1) with a disposable script,
`sandbox/s105-park/probe.ts`: pi's harness over its `MemoryStorage`, and a
provider of the probe's own over pi-ai's faux core.

**Question.** Stop ends pi's operation, so `lane.resume()` has nothing to
resume, and a new run must add a message. pi can also suspend a run, holding
its operation open, when a provider answers with a deferred handle
(`stopReason: "deferred"`, polled later through `fetchDeferred`). Can a Stop
park a run that way, so that Resume continues the same run with no new
message? What does the lane do while parked, and across a restart?

**Kill criterion.** pi refuses a deferred answer that no real request
produced, or a resumed run's request differs from the stopped one's, or a
parked lane cannot be stopped for good.

**Throw away.** The probe and its provider.

## Answers

1. **A provider can park a run on demand, and pi accepts it** (measured). The
   probe's provider wraps the real stream. On "park" it aborts the request
   in flight and ends its stream `done` with `reason: "deferred"`, an empty
   message, and a handle of its own (`{ provider, modelId, api, id, data }`).
   pi checks only that the handle's provider, model and api match the
   lane's model (`deferredHandleIsValid`, `runtime/drive/response.js`). It
   commits the empty message as the run's entry, sets the operation
   `deferred.suspended`, and `prompt()` returns
   `{ status: "suspended", deferred }`. If the park comes when no request is
   in flight, the provider answers the run's next request deferred at once,
   without calling the model.

2. **A Stop during a tool needs the tool stopped apart from pi** (measured).
   A tool cannot defer. The probe's tool watched the park signal and threw
   "Command stopped". pi recorded that as the call's result, as an error,
   and the next request was parked. In pine·trie that means aborting the lane's
   running calls (`lane-env.ts`, `{ abort }`) without `lane.abort`.

3. **While parked, the lane is open** (measured).
   - `inspectExecution().current` has `status: "open"`.
   - `prompt` is refused `LaneBusy`.
   - `appendMessage` is taken. Its message is written into the run when it
     resumes, and the model answers it in the same run: it acts as a steer.
   - `nextRun` queues for the run after.

4. **Resume continues the run with the stopped request's own context**
   (measured). `lane.resume()` polls once (`pollDeferred: true`) and calls the
   provider's `fetchDeferred(handle)`. The probe's provider re-sends the
   stored context, and the model gets exactly what the stopped request had
   (`system, user`). The run then goes on and ends `completed`.
   - After a Stop mid-reply, the partial text is gone, as after today's
     Stop.
   - After a Stop mid-tool, the model sees the call and "Command stopped".
   - **The empty deferred entry is never sent to the model**: not in the
     resumed run, and not in the runs after.

5. **A parked run can still be stopped for good** (measured). `lane.abort()`
   while parked returns ok, calls the provider's `cancelDeferred` once, and
   leaves the lane idle. The empty deferred entry stays, and is not
   rewritten as aborted. The next prompt runs, and its context drops the
   parked turn: two user messages in a row, as after today's Stop.

6. **A restart keeps the parked run** (measured).
   - A new harness over the same storage lists it in `open`. pine·trie's
     `Agent.interrupted()` would list it too, so `planStartup` would resume
     it on its own unless parked runs are told apart from crashed ones.
   - A new provider has no memory of the handle, so `fetchDeferred` must
     rebuild the request from `handle.data`. With the context there, resume
     on the new harness completed.
   - The cost is the whole transcript copied into the deferred entry: 851
     bytes in the probe, but images and long threads in practice. Storing a
     reference instead (the host's blob store) avoids that. Not measured.

7. **Not measured, read from source:**
   - **Wrapping the real model is possible, but untried.** `Models` has
     `getProvider` and `MutableModels.setProvider` (`pi-ai/dist/models.d.ts`).
     A wrapper must keep the provider's id and api, or pi rejects the handle.
     Whether `ModelRuntime`'s models are mutable is not checked.
   - **No pi-ai provider implements deferral today** (`fetchDeferred` appears
     only in faux and the lazy wrapper). The mechanism is pi's, but every
     deferral here would be pine·trie's own.
   - **pine·trie would treat a parked run as ended.** `thread-lanes.ts`'s `turn`
     treats any `ok` result as ended: it records the turn and the host ends
     the run (verdict, queued cards, the lane's container stopped).
     `SuspendedRun` would have to be an outcome of its own.

**Decision.** Parking is feasible and gives a true resume: no new message,
one run, the same request re-sent. Its cost lands in pine·trie:
- a wrapping provider;
- a per-call tool stop that does not go through pi's abort;
- a "parked" outcome through the host, its startup and asks (ADR-0056);
- a durable copy of, or reference to, each parked request.

It also changes what Stop promises: queued cards wait behind a parked lane
until Resume or a second Stop. ADR-0082 chose a new run with a host message
instead, for its simplicity.
