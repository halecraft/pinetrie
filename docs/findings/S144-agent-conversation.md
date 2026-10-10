# S144 — One agent can read another thread at each request, but what it reads should be copied into its own thread; a token budget can stop a run before its next request; lanes run at once and an ask need not wait

- **Status:** Answered
- **Led to:** ADR-0128

**Question.** Before deciding how agents in different threads talk
(ADR-0128), what does pi do for each part of it?
1. Can thread B's agent read thread A's entries, which live in another
   root's document, without copying them into B: drawn in at every request?
   What does that do to the prompt cache, and to compaction?
2. Does pi report tokens per model request, per lane, and can the host stop
   a run when a budget is spent? By how much can a run overrun it?
3. Can two lanes of one root's harness run at once, so `@B @C` runs both
   together?
4. Can a tool in A's run start B's run without waiting for it? What does a
   run started on a lane that is running return?

**Kill criterion.** Any of these:
- no way to put A's entries into B's context except by copying them;
- no per-request usage, or no way to stop a run before its next request;
- lanes of one harness serialized;
- a tool that starts another lane's run deadlocking, or a second run on a
  running lane queued silently instead of refused.

**Throw away.** The probe, `docs/findings/S144-agent-conversation/probe.test.ts`,
run as `packages/pi/s144-probe.test.ts` against pi 0.87.1 with pi-ai's faux
provider (which estimates usage, and its prompt cache by common prefix, per
lane). It is kept as the record of what ran, since a plan builds on it.

## Answers

**1. Either way of drawing A in works per request, but compaction keeps
neither, so B should hold a copy.** Two ways were run, both reading A's
entries from another session by id:
- **An entry projector.** pi's `entryProjectors` option maps a custom
  entry's `customType` to messages, awaited, at every context build
  (`buildSessionContext`, `harness/session/context.js`; called by
  `readBoundedContext` for each generation). B appended a
  `pinetrie.heard` custom entry holding A's entry ids, then was prompted.
  Both requests of a two-request run held A's text. The projector was
  called 3 times for 2 requests, so it must be cheap and give the same
  messages every time.
- **A custom message expanded by `toProviderMessages`**, which may be async.
  The pointer went into the prompt itself, as the `before` messages do
  today, with short stored `content` and the ids in `details`. Both
  requests held A's text; it was expanded once per request.
- **The prompt cache holds** for both: the second request read all of the
  first's prompt from cache (`cacheRead` 66 of 66).
- **Compaction keeps neither.** pi's compaction serializes stored messages
  with `convertToLlm` (`harness/compaction/compaction.js`) and skips custom
  entries (`getMessageFromEntry`). With a small window, the summary request
  never held A's text: the projected entry gave it nothing, and the pointer
  message gave only its stored `content`. So after B's first compaction,
  what it heard in A is gone, unless pine·trie's `before_compaction` hook
  (`packages/pi/agent.ts`) expands it first.
- Read from source: a chat's stored `content` is its attributed text,
  frozen at send "so a rename later cannot rewrite what the agent already
  saw" (`attributed`, `packages/rules/chat.ts`). A pointer would also need
  A's root document loaded at every request of B's, and the host lets go
  of roots no open task holds (ADR-0116).

So the way that works with pi rather than around it is a **copy**: a heard
entry whose `content` is A's entries as attributed text, and whose details
name the thread and entry ids it came from, so a column can draw it folded,
with a link. Tokens are spent on what B reads either way; only storage
grows, by each of A's entries at most once per agent that hears it.

**2. Usage comes per request and per lane, and aborting from
`before_request` stops the next request from being sent.**
- pi emits a `usage` event per model request, with `lane`, a `row` (`input`,
  `output`, `cacheRead`, `cacheWrite`, `totalTokens`) and the lane's
  running `totals`.
- `lane.abort()` called, without being awaited, from a `usage` listener
  after the second request: the second request's tool still ran, and no
  third request was sent. The run ends `status: "aborted"`.
- `lane.abort()` from a `before_request` hook on the third request: that
  request was never answered (2 answered). A budget checked there overruns
  by at most the one request that crosses it.
- Read from source: requests made outside a lane are not counted.
  `complete` (`packages/pi/config.ts`), which asks for the verdict, the
  digest and the title, returns text only and drops the reply's `usage`.

**3. Lanes of one harness run at once.** B's request was held open; C's
run, started 50 ms later in the same harness, finished while B's waited.
Lanes in different roots have harnesses of their own
(`packages/pi/TECHNICAL.md`, "Roots never wait on one another").

**4. A tool can start another lane's run without waiting, and a second run
on a running lane is refused.**
- A tool in A's run called `prompt` on B's lane and returned "queued" at
  once: A's run went on and completed, and B's ran.
- The same tool awaiting B's run also completed. Waiting is safe one way,
  but two agents asking each other while each waits would never finish, so
  asks should not wait.
- `prompt` on a lane with a run going returns
  `{ ok: false, error: { _tag: "LaneBusy" } }`, which the host already
  maps to `busy` (`laneErrCode`, `packages/pi/thread-lanes.ts`).
