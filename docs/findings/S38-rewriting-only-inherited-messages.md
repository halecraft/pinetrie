# S38 — can the path rewrite be limited to what a lane inherited?

> Overtaken by ADR-0034: a lane runs in a container on its own disk at one
> path, so nothing is rewritten. The measurements stand; the recommendations
> in "What this means for the design" do not.

ADR-0032's `transform_context` hook rewrites every root in `others` (other
lanes' workspaces and the project root) to the lane's own directory, in every
message the model is sent. That also rewrites the lane's own tool calls and
results, and people's messages to it. A lane that read your working copy
deliberately then sees, next turn, a history saying it read its own workspace;
a person who names your working copy is heard naming the lane's. The fix
proposed ("fix 1"): rewrite only messages the lane inherited from its parent.

**Verdict.** The mechanics hold. The rule does not: a person's own message has
to keep being rewritten, or the agent writes to your working copy (item 10).
What holds up is narrower: **never rewrite the lane's own agent turns**
(assistant messages and tool results); keep rewriting what it inherited and
what people write to it.

## Answers

1. **The hook can tell each message's entry, exactly, by object identity.**
   Every message `transform_context` receives is the very object that was the
   `message` of an entry `KynetaStorage.scanBranch` returned for that request.
   A `WeakMap<object, entry id>` filled in `scanBranch` tagged every message in
   every request (e.g. 9 of 9, 0 untagged). pi's `buildSessionContext` pushes
   `entry.message` by reference, and `streamHarnessAssistant` copies the array,
   not the messages (pi-agent-core 0.87.1).
2. **A rewrite limited by owner reaches the model as intended.** Lane B
   branched from lane A's end. In B's requests, A's prompt, tool call, tool
   result and reply arrived with `/PARENT` rewritten to `/CHILD`; B's own tool
   call and result naming `/PARENT` arrived verbatim.
3. **Timestamps cannot stand in for identity.** pi's faux replies share one
   timestamp: three different assistant messages had the same millisecond, and
   matching the retained tail by role and timestamp attributed B's reply to A.
4. **Compaction breaks the rule unless Pineta compacts.**
   - The compaction entry is the compacting lane's, and its `retainedTail`
     holds copies. Inherited messages kept in the tail then read as the lane's
     own, and arrived at the model unrewritten.
   - `transform_context` does not run for the summarizer's request (0 runs
     during `compact`), so the summarizer read A's paths unrewritten. This is
     true of the current rewrite too; it hides it by rewriting the summary on
     every later request.
5. **`before_compaction` fixes both.** Rewriting the inherited part of the
   preparation, calling pi's exported `compact()`, and returning
   `{ compaction }`: the summarizer read `/CHILD`, the tail kept A's messages
   rewritten and B's verbatim. The compaction entry then holds only text true
   for the lane, so reading it as the lane's own afterwards is right.
6. **An inherited compaction is attributed correctly.** Its summary message is
   untagged (pi builds it fresh), but `scanBranch` stops at the first
   compaction, so a request holds at most one and it is scanned first: an
   untagged `compactionSummary` belongs to it.
7. **After a restart, the preparation holds copies, and a recompute restores
   identity.** One process built A and B, started B's compaction, and exited
   inside `before_compaction`. A second process opened the same SQLite store
   and resumed B: 0 of 6 messages in the preparation pi gave the hook were
   tagged; `prepareCompaction` over `scanBranch`'s path produced a preparation
   deep-equal to it (summarized, split-turn, tail, `isSplitTurn`,
   `tokensBefore`) with 6 of 6 tagged, and the rewritten compaction completed.
8. **Revision records give the right owner, until one is missing; the lane's
   creation point never fails.** Through `default@`'s `createAgent`, with
   `turnDone` as the host writes it, compared with who wrote each entry:
   - `nearestRevision` was right for every entry in every request: a run's
     prompt and turns, a plain chat appended to the lane (`appendToLane`, no
     record), and people's chats in a branch before its lane existed
     (`appendToTree`, owned by the lane above). The prompt's record exists
     before the model is asked: `before_request` runs before
     `transform_context`.
   - A prompt whose record failed (the host logs it and goes on: "a missing
     revision only coarsens branching") made that run's entries the parent
     lane's, in that run and every later one: 1, then 2 entries wrong.
   - "Inherited means at or above the point the lane was created at" was right
     for every entry, the failed record included. Lane records do not hold
     that point today; `prepareLane` has it (`at`) when it writes the record.
   - This session's own store (210 entries, 1 lane, 8 revision records): all 6
     runs recorded, the two rules agree on every entry. A root lane: under
     either rule nothing in it would be rewritten.
9. **Anthropic accepts signed thinking with rewritten text** (`claude-haiku-4-5`,
   thinking `low`): B's request carried 2 of A's signed thinking blocks
   rewritten, and succeeded; a lane whose own thinking, inside its active tool
   loop, was rewritten (the current behavior) also succeeded (1 block).
   `claude-opus-5-5`, as pi drives it, returned no thinking blocks at `low` or
   `high`, so there was nothing signed to rewrite. A prompt instructing it what
   to write in its thinking was refused under Anthropic's terms, before any
   rewrite; that variant was dropped.
10. **A person's message left verbatim sends the agent to your working copy.**
    A lane working in `workspace/t-b`, asked by its person to "append a line
    saying hello to `<project>/notes.txt`" with the path unrewritten (fix 1),
    appended to the project's `notes.txt` and left the lane's untouched, with
    both `claude-haiku-4-5` and `claude-opus-5-5`. It used `bash`, which the
    `before_tool` backstop does not see. Today's rewrite is what keeps ADR-0032's
    "your working copy is yours" for what people type.

## What this means for the design

- **Rewrite by who wrote it, not only by lane.**
  - The lane's own assistant messages and tool results: verbatim. They record
    what ran, against which path; rewriting them is what made a lane that read
    your working copy on purpose unable to tell it had.
  - Inherited messages, any author: rewritten, as now.
  - People's messages to the lane: rewritten, as now (item 10).
- **Ownership from the lane's creation point**, stored on its lane record,
  rather than from revision records (item 8).
- Tag messages where `packages/pi` reads entries (`scanBranch`); an untagged
  `compactionSummary` belongs to the first scanned compaction. Any other
  untagged message means pi started copying: a check should count them, with a
  mutation that clones a message.
- `before_compaction`: recompute the preparation from the scanned path (item
  7), rewrite as above, compact with pi's `compact()`.
- What this does not fix: a person's path to something the lane's workspace
  does not carry (`.jj/`, ignored files, uncommitted changes) is still
  rewritten to a path that does not exist. That is fix 2's question: rewrite
  only paths the lane's base commit tracks.

## Not measured

- Fix 2: which paths a workspace carries, and the cost of asking jj.
- Signed thinking on other Anthropic models, or with thinking on other
  providers; Opus's thinking as pi drives it (item 9).
- Paths in `details`, which the rewrite skips only under the key `data`.

## Method

Items 1–6: `sandbox/s38/probe.ts` in lane `t-01a0e616-…`'s workspace
(ignored). pi's harness over `KynetaStorage` with a subclass whose
`scanBranch` tags messages, the scripted model, and the real `bash` tool. Lane
A runs a tool call naming `/PARENT/a.ts`; lane B is created at A's last entry
and names `/PARENT` itself in its prompt and its own tool call; then B compacts
and runs again. Variants: `KEEP=20` (a small `keepRecentTokens`),
`HOOK_COMPACT=1` (the `before_compaction` fix), `A_COMPACT=1` (A compacts
before B branches).

Items 7–10: a jj workspace at `default@` (`962465c4`), `sandbox/s38-ws`, set up
with the host's own `setUpWorkspace`, then forgotten.
- `sandbox/ownership.ts`: `createAgent` with the scripted model; `turnDone`
  mirrors `apps/pineta/host/work.ts` for a lane working directly; ground truth
  from which operation added each entry.
- `apps/pineta/s38-live.ts`: a copy of `.pineta/pineta.db`, opened as the host
  opens it (copy deleted after).
- `apps/pineta/s38-restart.ts crash|resume`: two processes over one SQLite
  store.
- `apps/pineta/s38-model.ts <model> a|b`: pi's harness with Anthropic models by
  name; `NATURAL=1` for a task that does not instruct the thinking, `THINK` for
  the level.
