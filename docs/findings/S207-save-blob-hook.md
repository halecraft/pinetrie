# S207 — `save_blob` asks the host for the bytes through a `LaneHooks` hook and writes them itself with its tool context's `env`; what it may read is what its path has shown the model

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** A tool that saves a shared blob into its lane needs the
blob's bytes, and a check that the thread may read that blob.

1. Where does a pine·trie tool run, and how does it reach the host?
2. Can the tool write through the lane's environment, so the write is
   recorded as a tool's (S206), or must the host write?
3. What shape does the hook return?
4. What may a thread read: which blobs has it been shown?

**Kill criterion.** The tool cannot reach both the host's blobs and its
lane's environment in one call, so saving would need a new channel.

**Throw away.** Nothing ran; this was read from source.

## Answers

1. **In the host's process.** pi's harness calls every tool's
   `execute(id, params, onUpdate, toolContext, invocation, context)`
   (`pi-agent-core`'s `dist/harness/types.d.ts`) on the host. The host's
   tools reach it through `LaneHooks` (`packages/pi/lanes.ts`), wired in
   `apps/pinetrie/host/work/index.ts`: `catchUpTool` calls
   `hooks.catchUp(lane, from)` and turns the `ToolAnswer` into its result
   (`packages/pi/thread-tools.ts`). The thread comes from the call's
   `Context` (`threadOfContext`).
2. **The tool writes.** `toolContext` is pine·trie's `ToolContext`, built
   per call by `toolContextOf(accessFor(thread), project)` in
   `packages/pi/agent.ts`: its `env` is `laneEnv` for a lane of its own,
   `refusingEnv` (every call `not_supported`) otherwise, and its `dir` is
   the lane's directory (`noteConfigWrites` in `packages/pi/tools.ts`
   already reads `toolContext.dir`). The host must not write instead: its
   own writes go on a `run`'s input, which the helper never counts as the
   agent's (the `toolCall` key in `packages/pi/lane-env.ts`), so the disk
   model and a shared directory's lineage would not see the file.
   `NodeExecutionEnv.writeFile` creates missing parent directories
   (S206's probe wrote `out/1.bin` with no `out/`).
3. **A hook that returns bytes or the refusal's words**, not a
   `ToolAnswer`, since the tool still has to write:
   `readBlob(lane, sha) → { kind: "blob", bytes } | { kind: "refused", text }`.
   The tool then writes with `toolContext.env.writeFile(path, bytes,
   context)` and answers with the path and size, or the env's error. A host
   without a copy for the thread answers the hook as
   `apps/pinetrie/host/work/index.ts` answers `catchUp` there
   (`refusedAnswer("no-copy")`), and `refusingEnv` would refuse the write
   anyway.
4. **What the thread's path has shown the model.** Every entry on the
   path to the root is a message the model read:
   - a chat's text, with its linked quotes, frozen as sent;
   - a cards entry (`pinetrie.pinned`, `packages/rules/pinned.ts`), whose
     `details.cards[].text` and `content` hold each pinned card's text as
     the run read it, and the task's pinned cards likewise
     (`packages/rules/task-pinned.ts`);
   - tool results and the agent's own replies.

   So the readable set is the blob URLs those messages' texts name: one
   rule covers chats, pinned cards and quotes from other threads, and
   needs no separate read of the places. A card pinned since the last run
   is not yet readable, which is right: the agent has not seen it.

**For the plan.**
- `SAVE_BLOB_TOOL` joins `TOOL_IDS` (`packages/core/tools.ts`), its
  factory joins `TOOLS` (`packages/pi/tools.ts`), and its hook joins
  `LaneHooks`. Every lane gets it, so a lane's tool list stays the same
  between runs (`packages/pi/TECHNICAL.md`).
- The host's hook gathers the path's entries
  (`ancestry` in `packages/core/tree.ts`), builds `ReadableBlobs` from
  their texts with the one function that names a text's blobs, then
  `planSaveBlob` decides; the bytes come from `blobs.get`.
- The path is resolved as pi's `write` resolves it, against `toolContext.dir`.
