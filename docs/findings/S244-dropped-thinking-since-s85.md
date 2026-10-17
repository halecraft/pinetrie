# S244 — a lane's prompt can be kept in its own transcript, for every model pi-ai serves: the leading system message holds it as sections with the tools, a change is a later system message, and pine·trie's `Models` is the one seam that can send it so

Numbered S229, then S239, until 2026-10-18, when two files held each number.

- **Status:** Answered (the onsets in Duane's store are not measured)
- **Led to:** ADR-0176

Read from pi-ai, pi-agent-core and pi-coding-agent 0.99.2 (`dist/`) and
pine·trie at this revision; two probes ran in a lane with no model key
(sources and output in `docs/findings/S244-dropped-thinking-since-s85/`).

## Brief

**Question.** S221 found 161 MB of `diagnostics` on assistant messages in
Duane's store: Anthropic's `input_transformations`, each a list of
`thinking_dropped` blocks with reason `prefix_binding_mismatch`. S85
traced the drops of 2026-10-03 to a lane's tool list changing for a
landing, and its system prompt naming the offer's bookmark; both were
fixed (ADR-0063, ADR-0080). What changes a lane's prefix now, and can
pine·trie keep it, on any model pi-ai serves, while the model still sees
a changed `AGENTS.md`?

**Kill criterion.** If the only way to keep the prefix is to rewrite one
provider's payload (`before_payload`), the fix is per provider, and only
the storage is fixed.

**Throw away.** The probes' copies in `packages/pi` (`_probe.ts`).

## Answers

### Why the prefix changes

1. **The report is Anthropic's, and it repeats.** pi-ai asks for
   `block_binding.prefix_mismatch_behavior: "drop_block"` on a model with
   `supportsMidConvoEffort` (Opus 5.5 has it), copies the stream's
   `input_transformations` into the reply's `diagnostics`
   (`api/anthropic-messages.js`), and sends every stored thinking block
   with its signature on every later request (`convertMessages`). So once
   a lane's prefix changes, every later request is sent the dropped
   blocks, Anthropic drops them again, and every later reply stores the
   whole list again: storage in proportion to the blocks before the
   change times the replies after it.
2. **A lane's prefix is built afresh at each host start.** The system
   prompt (`systemPromptFor`, `packages/pi/lanes.ts`) holds the project's
   context files (`AGENTS.md`) and the skills' list, which
   `loadModelSetup` (`packages/pi/config.ts`) reads once per process; the
   tools hold each tool's description and schema, from this build's code.
   pi's stable harness calls the `systemPrompt` function for every
   request and sends the result whole (`resolveSystemPrompt`,
   `harness/runtime/drive/generation.js`). A host started after any of
   them changed gives every lane a new prefix at its next request. In
   this repo `AGENTS.md` changed 5 times in 10-15..10-17.
3. **pine·trie's prefix check cannot see that change.** The
   `before_payload` hook compares each request's prefix with the lane's
   last one in memory (`prefixes`, `packages/pi/agent.ts`); a host start
   begins with none, so "the model's prompt or tools changed" is never
   logged for the change a restart makes.
4. **What a change costs.** Every earlier thinking block of the lane is
   dropped for good, and the whole prompt is written to the cache once:
   at Opus 5.5's prices ($5 per million written, $0.20 read), a
   355,000-token lane (S85's average) pays about $1.78 instead of $0.07
   for that request. Any model whose provider caches by prefix (OpenAI,
   Gemini, DeepSeek) loses its cache the same way.

### How pi keeps a prompt in the transcript

5. **Every provider adapter reads one transcript shape.** pi-ai turns
   `{ systemPrompt, tools, messages }` into a transcript whose leading
   system message holds the prompt and `toolsAdded`
   (`normalizeContext`), and every adapter (Anthropic, OpenAI's
   Responses, Completions, Codex and Azure, Google, Vertex, Bedrock,
   Mistral) calls `resolveTranscript`: a model whose compat sets
   `supportsMidConvoSystemMessages` (85 models across 11 providers'
   files) gets a later system message where it stands; any other has
   every system message folded into the leading one, sections patched by
   name (`collapseSystemMessages`, `getCurrentSystemMessage`).
6. **pi's own coding agent keeps its prompt this way.** Its
   `AgentSession` builds the prompt as named sections
   (`buildSystemPromptSections`), diffs them against the sections its
   transcript replays (`diffSystemPromptSections`), and appends
   `{ role: "system", sections }` when they differ
   (`_preparePromptAndToolLoadout`). The prompt text is the same either
   way: `buildSystemPrompt` renders the sections with
   `getSystemMessageText`.

### What pi-ai sends (payload probe)

Three shapes of one conversation (a user message, a reply with a signed
thinking block, a change to the `project_context` section, a second user
message), each sent to a closed port and its payload kept (`onPayload`),
for Opus 5.5 (mid-conversation system messages), Sonnet 4.5 (none) and
GPT-5.5 (Responses, mid-conversation developer messages):

7. **The prompt as a string, and the change as a later system message
   of sections: right for models that take one, wrong for the others.**
   Opus 5.5's `system` and every message up to the thinking block were
   byte for byte the request before the change, and the change came as a
   system message ("Updated system prompt section "project_context""),
   placed before the next assistant turn (pi-ai holds a later system
   message back so a `tool_result` still follows its `tool_use`).
   GPT-5.5 kept its leading developer message and got the change as a
   developer message where it stood. Sonnet 4.5 had it folded into its
   prompt, but the leading prompt was one string, so the old
   `project_context` stayed and the new one was appended after `cwd`.
8. **The prompt as sections, with the tools, in the leading system
   message: right for all three.** With no `systemPrompt` and no
   `tools` on the context, and a leading
   `{ role: "system", sections, toolsAdded }`, Opus 5.5 and GPT-5.5 sent
   the request before the change byte for byte, then the change; Sonnet
   4.5 was sent exactly the prompt a fresh build makes (`fresh`).
9. **Sections in a later message while the context also carries
   `tools`: wrong.** pi-ai prepends a leading message holding only the
   tools, so the prompt itself went out as a mid-conversation system
   message after the first user message, on Opus 5.5 and GPT-5.5 alike.

### What the harness does (harness probe)

pi-agent-core's `createAgentHarness` over a `MemorySessionRepo` and pi-ai's
faux provider, with `models` wrapped to record what the harness hands it:

10. **A lane takes a system message.** `lane.appendMessage` of
    `{ role: "system", sections }` stored it as a message entry; the next
    request carried it where it stood; a branch created at a later tip
    carried it too.
11. **The harness always hands the provider layer its own `systemPrompt`
    and `tools`** (`{ systemPrompt, tools, messages }` to
    `models.streamSimple`), so the shape of item 8 cannot be reached
    through `transform_context`, which may change the prompt and the
    messages but not the tools; and emptying a lane's active tools would
    refuse its tool calls (`harness/runtime/drive/tools.js` runs only
    active tools). The one provider-neutral seam is `models`: pine·trie
    builds the `Models` it passes the harness (`setup.models`), and a
    wrapper of its `streamSimple` may move the transcript's first system
    message, with the context's tools, to the lead, and drop
    `systemPrompt` and `tools`. Compaction's own request carries no
    system message of the lane's and would pass through unchanged.
12. **A compaction keeps no system message from before its cut.** With
    the change in the retained tail, the request after the compaction
    still carried it; with it before the cut, the request carried none,
    and led with the harness's `systemPrompt` again.
13. **The page shows none of it.** A `system` entry is not a role
    `renderableMessage` (`packages/core/tree.ts`) admits; pine·trie's
    storage keeps a message of any role.

### A run, a compaction and a reply (run probe)

The same harness, with the hooks a plan would add (`run-probe.ts`):

14. **A run can start with a system message.** `lane.prompt` of
    `[{ role: "system", sections }, user]` was admitted, and the request
    carried both, in order.
15. **What a lane's next request holds is readable before it is made.**
    `lane.findEntries({ stopAtType: "compaction", order: "newestFirst" })`
    gave the entries the harness reads for a request (its own
    `readBoundedEntries` scans the same way), the compaction entry among
    them with its `retainedTail`; pi-ai's `getCurrentSystemMessage` over
    those messages gave the sections in view: `{ preamble, project_context:
    v2 }` after a run that patched `v1` to `v2`.
16. **A compaction can carry the prompt.** A `before_compaction` hook that
    folds the system messages being summarised (`getCurrentSystemMessage`)
    and puts the result at the head of pi's `retainedTail` left the
    sections in view after the compaction as they were before it, and the
    next request carried that system message after the summary. Item 12's
    loss is the hook's to prevent, as pine·trie's pinned cards already are
    (`carryContext`, `packages/pi/pinned.ts`).
17. **A reply's diagnostics can be shrunk before it is stored.** An
    `after_response` hook that returned the message with each
    `anthropic_input_transformations` reduced to its count stored that
    message: the entry held `{ dropped: 2 }`, not the list. The diagnostic
    is not sent to any provider (`convertMessages` reads no
    `diagnostics`), so shrinking it changes no prefix.

## What it points to

- **A lane's prompt lives in its transcript.** At the start of a run
  (`run` in `packages/pi/thread-lanes.ts`, whose `before` messages go in
  with the prompt in one `lane.prompt`), the sections in view (item 15)
  are diffed with the sections built now; the patch, or the whole set
  when the path holds none (a new lane, a lane from before the change),
  goes in before the prompt. A compaction carries the folded prompt
  (item 16).
- **The `Models` pine·trie hands the harness leads each request with that
  transcript's prompt and the tools** (item 8), where the context holds a
  system message, and passes any other request through. Every model
  pi-ai serves is then sent either its unchanged prefix and the change in
  place, or exactly today's prompt.
- **Not covered:** a run resumed after a crash continues on the prompt
  its transcript holds until the next run; a tool whose definition
  changes still changes the prefix (pi-ai sends a redefined tool whole);
  the first run of each lane after the change appends the whole set,
  which costs nothing when the prompt is unchanged (item 8's text is
  `buildSystemPrompt`'s).
- **Storage:** a reply's `diagnostics` keeps the count of dropped blocks,
  not the list (item 17); the stored lists are counted before any
  migration shrinks them.

## Not measured

- In Duane's store: each lane's onsets (the reply whose drop count rose),
  whether they follow a host start or a compaction, and their
  `cacheWrite`; whether a block was ever dropped inside one tool-use
  loop. Needs a copy of the store.
- A live request: the probes stop at the payload. That Anthropic keeps a
  thinking block across a later system message is its documented
  behaviour for `drop_block`, not observed here.
