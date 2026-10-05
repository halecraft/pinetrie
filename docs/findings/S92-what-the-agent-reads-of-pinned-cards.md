# S92 — what the agent reads of pinned cards

**Status:** Answered. ADR-0048's probe 5, for `PLAN-2026-10-03-pinned-cards`.
Numbered S82, then S87, until 2026-10-04, when other spikes held both
numbers.

Measured in a lane (Linux, Node 24, pi 0.87.1) for ADR-0048's step 5. This
answers probe 5: writing a changed pinned card as an entry when a run starts,
placing the cards near the end of the context, keeping the prompt cache when
a card changes, and what a branch reads. The probe and its output are in
`.plans/s87-probe/` (named for the old number) and were not committed. All three were run again on
2026-10-03, after the scripts were recovered, with the same results.

**Method.** pi's harness ran over `KynetaStorage`, with pi-ai's real
`anthropic-messages` API pointed at a fake endpoint. The endpoint recorded
each request body and replied with a scripted stream: a tool call when the
turn asked for one, then text. No model key was used. The cache was
simulated on the recorded bodies, following Anthropic's rule: blocks are
ordered tools, system, messages, and each `cache_control` mark caches
everything before it. A request reads the longest earlier-cached prefix it
starts with. Every design ran the same script:
- run 1 with card v1, including a tool call;
- run 2 with the card unchanged;
- run 3 with the card edited to v2, including a tool call;
- run 4 with every card unpinned;
- then a branch created at the end of run 1, and prompted.

**Answers.**

1. **pi takes several messages as one run's prompt.** `lane.prompt` accepts
   `AgentMessage[]`, and `acceptRun` writes them as a chain in the same
   commit that admits the run (`runtime/lane.js`). So a cards entry and the
   prompt are written together, or neither is. It needs no hook, and no
   write outside a run (S19). The cards are read when the host starts the
   run, so the run reads them as they were when it started.

2. **Only a stored entry, appended at a run's start, keeps the cache.** The
   last request of each run, cached blocks of all blocks (share of
   characters):

   | design | run 1 | run 2 | run 3, edited | run 4, unpinned | branch |
   |---|---|---|---|---|---|
   | A. an entry before the prompt, by `prompt([cards, message])` | 4/6 | 6/8 | 11/13 | 13/16 (0.86) | card v1 |
   | B. an entry after the prompt, by the `before_run` hook | 4/6 | 6/8 | 11/13 | 13/16 (0.86) | card v1 |
   | C. the current cards at the end of each request, by `transform_context` | 2/6 | 2/8 | 2/12 | 2/14 (0.30) | none (live) |
   | D. the cards in the system prompt | 3/5 | 5/7 | 1/9 → 9/11 | 1/13 (0.17) | none (live) |
   | E. pi's system message with a `sections` entry, on `claude-sonnet-4-6` | 3/5 | 5/7 | 1/9 → 9/11 | 1/13 (0.15) | card v1 |
   | E′. the same, on `claude-opus-4-8` | 5/7 | 7/9 | 12/14 | 14/17 (0.89) | card v1 |

   - **A, B and E′ never lose the cache.** Each request misses only the
     blocks added since the request before it.
   - **C misses everything after the system prompt on every request,**
     including within a run, because the cards move to the end each time.
   - **D and E lose the whole conversation each time a card changes:** run 3
     read 1 block of 9.
   - **E stores the cards as entries, and pi-ai still collapses them into
     the system prompt** for a model without
     `supportsMidConvoSystemMessages` (`utils/transcript.js`,
     `collapseSystemMessages`). In pi 0.87.1's catalogue that is 10 of 15
     Anthropic models, `claude-sonnet-4-6` among them. On a model with the
     flag (E′), the update is sent as a `system` message just before the
     next assistant turn, so after the prompt. Removing a section is sent as
     `Removed system prompt section "pinned-cards".`

3. **The entry is what the model reads, and the tree records it.** In A, the
   cards entry is a pi `CustomMessage` (`role: "custom"`), which pi's
   `convertToLlm` sends as a `user` message, as it does a chat (S19). It
   arrives as one more user message before the prompt, and pi-ai marks the
   prompt, the last block, for caching. A run whose cards have not changed
   writes no entry. An entry is not a prompt (`startsRun`,
   `packages/core/tree.ts`), so `promptOf` still finds the run's message.

4. **A branch reads what is on its path.** With A, B, E or E′, a lane
   created at the end of run 1 read card v1, although its parent had since
   edited the card and then unpinned it. That is "as they were at the fork",
   because the path carries them, and it needs no code. C and D read the
   parent's current cards, which is wrong for a branch.

5. **pi's own compaction can drop a cards entry from the context.** pi
   compacts by default (`DEFAULT_COMPACTION_SETTINGS`: on, keeping the last
   20,000 tokens), and pine·trie does not configure it. With the window forced
   down to 30 tokens, entries before the cut, card v1 and v2 among them,
   reached the model only through the summary. A cards entry inside the kept
   window stayed. pine·trie's tree does not track pi's compaction entries yet.

**Consequences for step 5.**

1. **Use design A.** The host plans the cards entry as a value from what is
   on the path and the cards now, and passes it to the run with the prompt:
   `ThreadLaneHandle.run` takes the entry and the message. B gives the same
   cache, but it runs in a hook whose errors pi reports and then ignores, so
   a run would silently go without its cards. It also writes in a second
   commit, and it is not a value a test can read. E′ is pi's native way, but
   on most models it falls back to D.
2. **What to compare with is the path, not the lane's last run.** The cards
   last read are the newest cards entries on the path to the thread's end.
   That covers a branch, whose path carries its parent's entries, and a
   conversation thread, whose first run sees none on its path.
3. **After a pi compaction on the path, the next run writes every card
   again.** The comparison reads only entries after the compaction's first
   kept entry. pine·trie's tree index must learn pi's compaction entry for
   that.
4. **The fixed line goes in `<rules>` (`promptGuidelines`) for every thread
   with an agent**, not only lanes of their own. ADR-0046's block is in the
   same section, and a provider that rebuilds the prompt keeps that section
   (S23).
5. **Not measured:** a real provider's cache. The simulation follows
   Anthropic's documented rule and leaves out its 20-block lookback, which a
   run adding a handful of blocks per request does not reach. For a
   provider that caches any prefix automatically (OpenAI), A only ever
   appends, so it keeps its prefix by construction.

**Decided with Duane after the probe.**

- **An entry restates every card pinned now**, and names, by its first line,
  each card unpinned since the entry before it ("no longer applies"). The
  latest entry is what holds.
- **A branch starts with no pinned cards.** Its parent's cards are not
  copied, and since the branch shares the parent's history, a quiet entry
  that the person does not see tells the model that every pinned card no
  longer applies. This revises the ADR's "a branch inherits its parent's
  pinned cards" (answer 4 still holds for what the path carries).
- **A send waits for the pinned cards' text as its sender had it**, as a
  queued card's take waits for `seen` (S72).

## Addendum: keeping the cards in view across pi's compaction

The second probe (`probe-s87b.ts`, same directory) ran design A with
`keepRecentTokens` at 30. Run 2's tool call reported a context near the
model's window, so pi compacted at the next boundary, inside run 2. It
tried three ways, plus a hook that fails:

| way | rest of run 2, and run 3 | the compaction entry |
|---|---|---|
| pi as it is | summary, then the recent turn: **no cards** | does not hold them |
| `before_compaction` runs pi's own `compact()` and puts the cards at the head of `retainedTail` | summary, **cards**, recent turn | holds them (`fromHook`) |
| `transform_context` puts the cards back after the summary | summary, **cards**, recent turn | does not hold them |
| the `before_compaction` hook throws | as pi as it is | pi's own |

6. **pi compacts in the middle of a run** (reason `threshold`), at the
   first boundary after a reply that reports a full context. Without help,
   the agent works the rest of that run, and every later one, without its
   cards, until an entry restates them.
7. **A `before_compaction` hook can keep them, and the tree records it.**
   pi's `compact()` (`harness/compaction/compaction.js`, a deep import)
   gives the result the hook returns, with the cards added to the retained
   tail. pi still made exactly one summary request. The compaction entry,
   stored through `KynetaStorage`, holds the cards, so what the model reads
   after a compaction is in the tree, as ADR-0048 requires.
   `transform_context` gives the model the same view, but nothing in the
   tree records it.
8. **A failing hook costs only the cards.** pi reports the error and
   compacts on its own. The next run's entry has to restate the cards then.
9. **pine·trie's reads already pass over a compaction.** `readTreeIndex` and
   `projectTranscript` showed every message on the path, those summarised
   included. The compaction entry has no message, so it is not drawn.

**Consequences.**

6. **`packages/pi` registers the hook.** It carries the newest cards
   entry among the summarised messages into the tail, when the tail lacks
   one. That is a pure function of pi's preparation. It carries what the
   agent last read, not the live cards, so it agrees with history.
7. **The cards the model sees** are the newest cards message after the
   newest compaction on the path, or in that compaction's retained tail.
   When there is none and cards are pinned, the next run restates them.
   This replaces consequence 3's rule to always restate after a
   compaction: with the hook, nothing needs restating except when it
   failed.
8. **Found on the way, not about cards:** `KynetaStorage` splits images
   out of a `message` entry's payload only (`stored-row.ts`, `splitImages`).
   So a compaction's retained tail stores its images inline, against
   ADR-0051.

## Addendum: the same, through pi's faux provider

pi's faux provider, behind pine·trie's `ScriptedModel`, keeps its own prompt
cache. It is keyed by the session and lane pi passes as `sessionId`, and
reads the characters a request shares with the lane's previous request
(`withUsageEstimate`, `providers/faux.js`). pi stores the result in each
assistant entry's `usage`. `probe-s87c.ts` ran A, C and D through it with
padded prompts. The table gives `cacheRead` on each request, as estimated
tokens:

| design | run 1 (2 requests) | run 2 | run 3, edited (2) | run 4, unpinned |
|---|---|---|---|---|
| A | 0, 855 | 866 | 1676, 2504 | 2514 |
| C | 0, 835 | 845 | 1655, 2466 | 2476 |
| D | 0, 853 | 864 | **11**, 2481 | **10** |

10. **The faux cache agrees on A and D.** An edit to cards in the system
    prompt left only 11 tokens to read. A read everything but the new
    turn.
11. **It is kinder to C than Anthropic is.** It matches any shared prefix
    of characters, as a provider that caches automatically does, so moving
    a small cards block costs only that block. Anthropic reads only
    prefixes that ended at a mark in an earlier request, and C's mark was
    always on the cards block. A is the only design that keeps the cache
    under both rules.
12. **This makes it a check in the suites, with no key.** A test through
    `createAgent` and a scripted model can read `usage.cacheRead` from the
    tree. It can require that the request after a card is edited reads at
    least everything the request before it sent. A mutation that puts the
    cards in the system prompt fails it.

**Still unknown without a model key:** whether a real model follows cards
placed before the prompt, and the "no longer applies" lines. The faux
model's replies are scripted, so it shows what the model was given, not
what it does with it. That needs `e2e:live` or a probe run with a key.
A real provider's cache numbers are also unmeasured, though both
simulations agree on A.
