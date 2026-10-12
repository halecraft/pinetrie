# S168 — Almost every fixed wait in the e2e suites stands in for a state, or for a clock a test cannot move

- **Status:** Answered
- **Led to:** ADR-0139

**Question.** The e2e scenarios hold fixed waits: `waitForTimeout`,
`sleep(ms)`, `setTimeout` in a promise, and tool commands that run
`sleep N` so the page can be watched mid-run. What does each wait for,
and what would let a scenario wait for that state instead of for time?

**Kill criterion.** A wait whose state no scenario can observe, and which
no seam in pine·trie's own code could make observable, stays a wait. If
that were most of them, there would be no plan.

**Throw away.** The probes: scenario files edited in place and put back,
and a FIFO tried in a shell. Nothing was kept.

**Answers.**

1. **Some waits guard nothing.** Each was removed, its scenario run, and
   the mutations proving the checks after it run:
   - `browser/page.scenario.ts`, 1.6 s after the pointer leaves the rail:
     no step on that page puts the pointer over the rail, so the hold the
     wait outlasts never starts. `page` passed twice without it, and "the
     rail does not follow a column's outline" and "the rail follows a
     column's outline under the pointer" were both killed.
   - `browser/tools.scenario.ts`, 400 ms after a ring appears: the ring's
     colour is `rgba(232, 192, 122, 0.3)` from its first frame. `tools`
     passed without it.
   - `host/cards.scenario.ts`, 200 ms after Ada leaves: `cards` passed
     twice without it, and "the host writes no seat records" was killed.
   - `host/images.scenario.ts`' two 100 ms waits before a shutdown, and
     `host/presence.scenario.ts`' one: passed twice, and four times.
     They were copied from a restart check, where the scenario now waits
     for the host's copy itself (`waitFor(… cardText …)`) before it closes.
   - `browser/page.scenario.ts`, 1.5 s after a message for a person: the
     check that once followed it ("a message to a person starts no run")
     is gone. Two `$$eval` calls whose results nothing reads remain.
2. **A refused write sends nothing.** `refusedWrite` (`e2e/harness.ts`) is
   true only when the write threw `NotAWriterError` before it was made, so
   the 500 ms after one in `host/cards` (the places) and `host/presence`
   (the session) waits for a write that was never sent. Where the write
   goes through, `refusedWrite` is false and the check fails on that
   alone.
3. **Kyneta has no per-write acknowledgement, but `whenSettled` is the
   barrier a negative read needs.** `sync(doc).peerStates`' `synced` means
   only that nothing is left to *receive* from a peer
   (`@kyneta/exchange`, `types.ts`). `whenSettled(ref)` resolves once the
   document's authority has answered (`settle.ts`: "settled exists to make
   the negative verdict trustworthy"). In `host/cards`, Bea's copy of
   Ada's inventory settled `via: "peer"` in 0 ms and held nothing; under
   the mutant "every inventory is shared with every peer" it settled in
   1 ms already holding Ada's slot 3, and the check failed.
4. **The host's clock is one value, but a suite cannot set it.**
   `startHost` builds `Basics` with `now: Date.now`
   (`apps/pinetrie/host/index.ts`), and the blob stores default their own
   `now` to `Date.now` (`blobs.ts`). `planSweep` is pure in `now` and
   `grace`. So `host/banners`, `host/images` and `host/tool-images` wait
   out a real grace, which `startHost`'s `blobGraceMs` shrinks to a second
   or so for them alone. The host's other ages are 7 days or more
   (`TRASH_KEEP_MS`, `TRACE_MAX_AGE_MS`, archived histories): moving a
   clock past the 24 h blob grace sweeps nothing else. No host code
   compares a uuidv7 id's time with `now`.
5. **Playwright's clock is the wrong seam for the page.**
   `page.clock.install` (Playwright 1.56, `clockSource.js`) replaces
   `requestAnimationFrame`, `performance`, `Date`, every timer and
   `Event.timeStamp`. The browser suite's checks are geometry read in real
   frames (`twoFrames`), which would then run on a fake frame loop. The
   page's time rules are already pure in `now` where it matters
   (`runningFor`, `railScroll`), except the ring: `ToolRow` sets
   `revealed` from a `setTimeout(REVEAL_MS)` in an effect, so "a call
   shorter than `REVEAL_MS` is never ringed" can only be seen by running
   a short call in a browser.
6. **A scripted reply can be released a delta at a time.** pi-ai's faux
   provider streams on its own timer (`scheduleChunk`, `tokensPerSecond`).
   `scripted.ts` already wraps each request's `stream` and `streamSimple`
   (`perRequest`), and pi-ai's `AssistantMessageEventStream` is a queue
   with `push` and an async iterator (`utils/event-stream.js`), so a
   wrapper can forward each event and hold each delta until the suite
   releases it.
7. **A tool command can be held, and fed, by the suite.** In a shell, a
   command that opens a FIFO read-write and echoes each line it reads
   prints nothing until a line is written to the FIFO, prints each
   written line in order, never blocks a writer (it holds the FIFO
   open itself), and exits on an agreed end line. A suite writes into a
   lane with `inLane` (`e2e/lane-hosts.ts`). Today the suites pace tools
   with `sleep 2`, `sleep 3`, `sleep 5` and loops of `sleep 0.1`–`0.25`;
   on one run of `browser/tools` the page missed the first live row of
   `sleep 2; echo waited` within its 15 s, before any edit.
8. **One wait hides a Kyneta bug.** `host/presence.scenario.ts` sleeps
   20 ms so a write and a deletion of one key fall in different
   milliseconds: equal timestamps tie and the write wins on other peers
   (`docs/pinetrie.md`, "Open, non-blocking"). The fix is Kyneta's: a
   peer's later operation must beat its own earlier one.
