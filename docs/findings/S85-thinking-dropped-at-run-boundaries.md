# S85 — earlier thinking is dropped when a lane's tools or prompt change

- **Status:** Answered
- **Led to:** ADR-0063, ADR-0080

Measured on a copy of the person's `.pinetrie/pinetrie.db` (2026-10-03), against
pi-ai 0.87.1's `api/anthropic-messages.js` and pi-agent-core 0.87.1's harness.
The probes ran in a lane, read only the stored session, and were not committed.
ADR-0063's change acts on it: a lane's tools and prompt stay the same across
its runs.

**Answers.**

1. **Anthropic drops an earlier thinking block whose prefix has changed since
   it was written, and pi asks it to.** For a model with
   `supportsMidConvoEffort` (Opus 5.5), pi sends
   `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` and the
   `thinking-binding-controls` beta. The SDK documents
   `prefix_binding_mismatch` as "the messages before it have changed since".
   pi stores the API's report on the reply (`diagnostics`) only when it is not
   empty: 3,926 of 10,748 replies.
2. **The report's paths are exact.** pi puts an effort-only system message
   before each earlier assistant message (`insertThinkingLevelMessages`), so
   each turn takes three API messages. With that mapping, every reported
   `messages.N.content.0` is a thinking block.
3. **The drops start at run boundaries, not within runs.** Of 10,660 replies
   with an earlier reply on their branch, 101 dropped a block the one before
   had kept: 85 at the start of a run, 16 within one.
   For each pair of consecutive runs on a lane:

   | previous run → this run | boundaries | with new drops |
   |---|---|---|
   | chat → land | 37 | 36 |
   | land → land | 5 | 0 |
   | land → chat | 31 | 6 |
   | chat → chat | 477 | 43 |

4. **A landing changes the tool list, which every request leads with.**
   `withGuidance(true)` adds `ask_for_guidance` for a landing
   (`packages/pi/agent.ts`). pi's harness sends the current tools each
   request, through `normalizeContext`, as the leading system message's
   `toolsAdded`. With native tool changes, pi-ai sends those as the initial
   `params.tools`. So the first tool list differs, and so does every prefix.
   19 landings started within the cache's 5 minutes of the previous request.
   They wrote 355,647 tokens to the cache on average, and the 17 with new drops
   read 0 to 4,396 from it. The prompt was cached again from the top, and the
   model lost its earlier reasoning just as it started to resolve conflicts.
5. **Between two chats, the system prompt changed.** At 14 of the 24 chat
   runs that started within the cache's lifetime and dropped new blocks, the
   cache read 1,313–1,577 tokens: the tools, then a miss. The lane's guidelines name the offer's
   bookmark (`laneGuidelines`, from `readNames`), and 13 of the 43 onsets
   follow a naming of the lane. The rest line up in time with landed changes
   to `packages/pi` and `AGENTS.md`, which a restarted host reads afresh
   (`setUpModel` loads context files and skills once per process). That last
   cause is particular to developing pine·trie in pine·trie.
6. **The prompt cache is otherwise healthy:** 2.88 G tokens read against 119 M
   written, over the session.

## What it costs

- **The model.** Once a lane's prefix changes, the blocks written before the
  change are dropped from every later request, for good.
- **Money.** A landing's first request writes the whole prompt to the cache
  again: 355,647 tokens on average, about $1.78 each at Opus 5.5's $5 per
  million.
- **Storage.** The signatures of thinking the model no longer sees (16 MB),
  and a report on each reply listing every drop again (23 MB): S84.

## Directions

- **Keep a lane's tool list constant.** Activate `ask_for_guidance` in every
  lane, and have it answer outside a landing that there is nothing to ask.
  Or have pi's harness express a tool change as a transcript system message
  (`tool_addition`/`tool_removal`), which pi-ai already sends natively to keep
  the prefix intact. That needs a change in pi.
- **Keep a lane's system prompt constant.** Move the offer's bookmark out of
  the guidelines and into the lane note, which the agent reads on demand.
- **Don't store the report on every reply.** It repeats the previous reply's,
  plus the newly dropped blocks.

## Open

- Confirm with a capture: a `before_payload` hook that logs a hash of
  `system` and `tools` for each request, through one landing. No model key
  reaches a lane, so this has to run on the host.
