# S342 — A `bash` output's ESC is deleted by pi's sanitiser, leaving its SGR's parameters as text; every model request passes `toProviderMessages`, but compaction's summary does not

- **Status:** Answered
- **Led to:** ADR-0214

Read in pi 0.99.2 (`@earendil-works/pi-coding-agent`, `pi-agent-core`) on
2026-10-25, and observed in a lane.

**Question.** A `bash` row showed `[2m Test Files [22m [1m[32m575
passed[39m`: a coloured output's SGR without its ESC. A row should draw
the colours, and the model keep reading plain text.

1. Where is the ESC lost?
2. Does every path that carries a stored `bash` result to a model pass one
   place pine·trie controls?
3. Does a failed call's output live anywhere but its result's `content`?
4. Does an interrupted call's restored output keep its tool's name?
5. Do the programs agents run colour their output into a pipe?

**Kill criterion.** A path, other than compaction's summary, that carries a
stored `bash` result to a model without passing `toProviderMessages`: the
model would then read escapes that only the row should.

**Throw away.** Nothing was written; the answers are source reads and one
observation.

## Answers

1. **pi's sanitiser.** `sanitizeBinaryOutput`
   (`pi-coding-agent/dist/utils/shell.js`) is
   `str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g, "")`. ESC is
   `\x1B`, inside that class; the `[`, the parameters and the `m` are
   printable and stay. pine·trie's capture (`packages/pi/shell-capture.ts`)
   ran every view through it. pi's own terminal UI does not show the
   residue because `getTextOutput` runs `stripAnsi` first, then
   `sanitizeBinaryOutput`.
2. **Every request does; compaction's summary does not.** The harness
   builds each model request through its `toProviderMessages` option
   (`harness/execution/assistant.js`, defaulted in
   `harness/runtime/harness.js`), which pine·trie sets to
   `providerMessages` (`packages/pi/agent.ts`). Compaction and branch
   summaries call `convertToLlm` directly
   (`harness/compaction/compaction.js`,
   `harness/compaction/branch-summarization.js`), so their summariser reads
   what is stored. No other path reads a stored tool result for a model.
3. **No.** A tool that throws becomes `createErrorToolResult(message)`, with
   `details: undefined` (`harness/execution/tools.js`, `executeToolCall`).
   pine·trie's `bash` throws a failed command (`bashResult`), so a failure's
   output is only in `content`.
4. **Yes.** An interrupted call's result is `syntheticMessage(toolCall,
   [...checkpoint.content, marker])` (`harness/runtime/drive/tools.js`),
   which sets `toolName: toolCall.name`; a checkpointed partial output is
   restored as a `bash` result.
5. **Some do.** In a lane, `npx vitest run 2>&1 | …` printed SGR into a
   pipe (bold, dim, green, yellow, bright black), the output in the
   question. A program that colours only for a terminal prints none.

**Decision.** A `bash` result keeps its output's SGR; the row draws it, and
`providerMessages` drops every escape sequence from a terminal tool's
result before the model reads it. Compaction's summary reading SGR costs
tokens and harms nothing.
