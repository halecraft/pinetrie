# S5 — Destination-aware three-way conversation fold

**Date:** 2026-09-20 · **pi:** 0.85.0 · **Sandbox:** `sandbox/s5-fold`

---

## 1. VERDICT

**PASS.** The kill criterion is not met — outputs were specific rather than generic, did not smuggle in irrelevant context (a dedicated control scenario was explicitly dismissed in one line), and reliably distinguished common ground from divergence. An ablation shows the three-way structure is doing the work, not the model.

**Caveat:** I built the rig and produced outputs. Per the scope note, the final quality judgement is the human's. My verdict is against the stated kill criterion only.

---

## 2. What I ran

### Building a branched session headlessly

**pi RPC has no in-place tree navigation.** Verified by enumerating every command heading in `docs/rpc.md`: there is no `navigate_tree`, `branch`, or `set_leaf`. `fork` creates a **new session file** from a previous user message; `clone` duplicates the active branch into a new file. The `/tree` in-place branching available in the TUI is **not reachable over RPC**.

**Path that worked:** build a shared base, snapshot the session file, extend copies.

1. Run base prompts → session advances to point `A`. Copy the `.jsonl` to `BASE_A.jsonl`.
2. `cp BASE_A.jsonl OURS.jsonl`, reopen with `--session OURS.jsonl`, run trunk prompts → `A → C → E`.
3. `cp BASE_A.jsonl THEIRS_<x>.jsonl`, reopen, run branch prompts → `A → B`.

File copy preserves entry IDs, so **LCA computation by entry-id is genuine**, not simulated. Verified: all four `THEIRS_*` files share `lca=7ffc796c` with `OURS.jsonl`, base = 6 entries.

Flags: `--no-extensions --no-tools --no-skills --thinking off` so legs are prose and the fold is tested on conversational content rather than tool spam.

**Controlled design:** base and `ours` built **once** and shared across all scenarios; only `theirs` varies.

### Files

| Path | Role |
|---|---|
| `driver.mjs` | pi RPC JSONL client; waits for `agent_settled` between prompts |
| `build-tree.mjs` | builds the branched tree (1 base + 1 ours + 4 theirs) |
| `fold.mjs` | LCA, leg split, fold prompt, runner, naive baseline |
| `ablate.mjs` | three-way vs. two ablations |
| `tree/*.jsonl` | the session tree |
| `out/*.legs.md` | the three legs, verbatim |
| `out/*.foldprompt.txt` | exact prompt sent |
| `out/*.result.md` | fold output + naive baseline |
| `out/scout.ablation.md` | ablation |

### Commands

```bash
cd ./sandbox/s5-fold
node build-tree.mjs                                    # build tree (idempotent)
node fold.mjs <aside|scout|contradict|irrelevant> deepseek deepseek-reasoner
node ablate.mjs scout deepseek deepseek-reasoner
```

**Conversation model:** `cerebras/qwen-3.8-27b`. **Fold model:** `deepseek/deepseek-reasoner`.

### Scenarios

Base: designing rate limiting for a TS HTTP API (40 endpoints, 3 stateless Node instances, existing Redis). Trunk `ours` continues into failover behaviour and the response contract.

| Scenario | `theirs` branch |
|---|---|
| `aside` | terminology question — what "fail-open" means |
| `scout` | 3-turn exploration of token bucket as an alternative |
| `contradict` | argues Redis rate limiting is the wrong choice entirely |
| `irrelevant` | **control** — how to cook unsoaked black beans |

---

## 3. Evidence

### 3a. Token accounting

Approximate (`chars/4`). "naive" = same content with base sent twice (once per leg) instead of once.

| scenario | base | ours | theirs | 3-way total | naive | saved |
|---|---|---|---|---|---|---|
| aside | 2225 | 3580 | 435 | 6240 | 8465 | 2225 (26%) |
| scout | 2225 | 3580 | 5289 | 11094 | 13319 | 2225 (17%) |
| contradict | 2225 | 3580 | 6178 | 11983 | 14208 | 2225 (16%) |
| irrelevant | 2225 | 3580 | 153 | 5958 | 8183 | 2225 (27%) |

Saving is exactly one base leg, as predicted in `01-architecture.md` § Fold. As a fraction it shrinks as the branch grows — **the token argument for three-way is real but secondary**. The semantic argument (below) is the load-bearing one.

### 3b. Control — irrelevant branch (verbatim, complete)

> The branch is irrelevant to rate limiting — it's a detour on quick-soaking dried black beans (boil 2–4 min, sit 1 hour covered; or cook from dry with 30–60 extra minutes and more water). Nothing here bears on the limiter's design.

One line. No padding, no manufactured relevance. **This is the single most important result** — it directly refutes the "reliably smuggle in irrelevant context" kill condition.

### 3c. Contradicting branch (verbatim excerpt)

> **Note — strong dissent from the Redis design, raised after the response-contract discussion.**
>
> - **Edge first, not app.** Per-IP connection and request-rate limits (e.g. 50 concurrent conns/IP, ~100 req/s sustained) at Cloudflare/Envoy/Nginx cost an afternoon and zero Node code… **This contradicts the destination's framing that enforcement belongs in a central app middleware.**
> […]
> **Where this lands:** the destination's `429` + `Retry-After` + `RateLimit-*` header contract survives unchanged in either design. The live disagreement is scope — the branch says skip app-level Redis limiting entirely, which would delete the failover, fail-open/closed, and throttle-timeout sections the destination just built.

Conflict named plainly, not smoothed. The closing paragraph reasons about **what the destination would lose** — only possible with destination context.

### 3d. Aside (verbatim, complete)

> This branch is a definitional aside on fail-open/fail-closed that the destination already covers in operational detail. One substantive point it adds: it frames fail-closed as returning "`503` or a `429` with a clear `Retry-After`," whereas the destination concluded `503` is uniquely correct for fail-closed and explicitly rejected confusing it with `429`… It also gives a crisp one-liner worth reusing… Otherwise irrelevant.

Correctly finds the branch **mostly redundant**, extracts the one genuine delta, and detects a subtle terminological conflict with the destination.

### 3e. Naive concatenate-and-summarise baseline

Same content, unstructured, "summarize this conversation":

| scenario | fold words | naive words | ratio |
|---|---|---|---|
| aside | 130 | 530 | 4.1× |
| scout | 269 | 608 | 2.3× |
| contradict | 267 | 850 | 3.2× |

The baseline opens by restating what the reader already knows:

> "The user is building a TypeScript HTTP API (~40 endpoints, 3 stateless Node instances behind a load balancer, already using Redis for caching)…"

It produces a **whole-conversation summary**, not a fold. It is 2–4× longer and mostly redundant. It is the wrong artifact, not merely a worse one.

### 3f. Ablation (scout) — the decisive test

| variant | input | words | outcome |
|---|---|---|---|
| **A** | `theirs` only | 221 | Good standalone summary. But **restates base context** the reader has, and **recommends "token bucket"** with no idea the destination already locked in sliding window. No conflict detected. |
| **B** | all three legs, **unlabelled** | 167 | **Worst.** Summarises the entire conversation including base and ours. Ends "Open question: final algorithm choice not confirmed" — **state confusion**, because it can't tell destination from exploration. |
| **C** | three-way, **labelled** | 254 | Names the disagreement, ties it to the destination's live decisions. |

C surfaced an implication neither A nor B could:

> the `Retry-After` derivation from "oldest entry + window" is log-specific and would become refill-rate-derived under a bucket

That is a cross-leg consequence requiring simultaneous knowledge of both branches **and** which is the destination. **A cannot know it. B was too confused to find it.**

**Conclusion:** the lift comes from the labelled base/ours/theirs partition, not from model strength. Variant B proves that passing the same bytes without the partition is actively worse than passing less.

---

## 4. Consequences for the plan

**Confirms ADR-0005** (*summarization is lazy and destination-aware*). Destination awareness produced the conflict detection, the relevance triage, and the cross-leg implication in 3f — none available to a leave-time summary. pi's own `BranchSummaryEntry`, generated on leaving a branch, structurally cannot produce any of these.

**Confirms the § Fold design in `01-architecture.md`** as specified: LCA sent once; labelled legs; the "common ground vs. divergence" framing is what the model actually uses.

**Confirms the branch-kind taxonomy in `00-vision.md`.** Aside / Scout / Contradict produced qualitatively different, appropriate fold shapes (dismissal + one delta / structured technical comparison / named dissent with scope analysis) from **one unchanged prompt**. No per-kind prompt engineering needed.

**Resolves the `Fold output is mush` risk** in `01-architecture.md` § Risks. Not observed. Suggest downgrading.

**Strengthens the `ours` leg requirement.** Ablation A shows a fold without destination context is not a degraded fold — it is confidently wrong (recommends switching to a design the destination already rejected). If the budget ladder ever drops `ours`, that is a **correctness** regression, not a quality one. This should be stated in the ladder design.

**New, unplanned finding — folds are not idempotent in an unexpected way.** Already flagged in ADR-0005 that two peers folding concurrently produce different nodes. Stronger version: fold output depends on `ours`, so **the same branch folded at different destinations yields different — and correctly different — summaries.** Re-foldability isn't just a nicety; a fold node is only valid *relative to its destination*. The UI must not present a merge node as a property of the source branch.

**Unblocks the prompt** in `03-spikes.md` § S5 "Throw away… keep the prompt." Kept verbatim at `out/*.foldprompt.txt`; the rule list is in `fold.mjs` `buildFoldPrompt()`. The rules earning their keep: *do not restate*, *name contradictions plainly*, *say irrelevant in one line*, *cite concrete numbers*.

**Incidental pi finding.** `get_last_assistant_text` returned `{"data":{}}` on every call despite `docs/rpc.md` documenting `{"text": "..."}`. Reading `message_end` events is the reliable path. Minor, but relevant if the Pineta host ever uses that RPC command.

---

## 5. Residual unknowns

**Not resolved:**

1. **Long-context behaviour.** Largest leg was ~6.2k tokens; total ~12k. Untested at 100k+ where the budget ladder actually engages. The ladder (raw → per-leg compaction → branch summary) is **entirely untested**.
2. **Single fold model.** Only `deepseek/deepseek-reasoner`. Unknown whether weaker/cheaper models preserve the discrimination — this matters, since fold may be frequent. *`anthropic/claude-sonnet-4-5` was attempted first and failed: HTTP 400, "Third-party apps now draw from your extra usage, not your plan limits." Plan limit, not a code issue.*
3. **Tool-bearing branches.** All legs are prose (`--no-tools`). An earlier discarded run **did** exercise tools and produced very long tool-laden legs (file writes, `npm install`, typecheck loops). Folding branches containing tool calls and large tool results is untested and likely materially harder.
4. **Single base conversation, single domain.** One technical design discussion. Untested on debugging sessions, prose/writing work, or multi-topic trunks.
5. **Subtree vs. path.** Only ever folded a linear path. The open question in `01-architecture.md` § Fold (fold a path or a subtree?) is untouched.
6. **No merge-node write-back.** The rig produces summary *text*. Writing it back as an entry with `fromId` was out of scope — untested end to end.
7. **Double-fold.** Folding B into E twice, or folding B into two different destinations, not tested (though §4 predicts divergent-and-correct results).
8. **n=1 per scenario.** No repeat sampling; run-to-run variance unmeasured.

**Assumed, not verified:**

- Token counts are `chars/4` approximations, **not** provider-reported usage.
- "Naive baseline" is my construction (concatenate + "summarize"); a better-engineered two-way prompt might narrow the gap — though ablation A/B suggests the partition, not the wording, is what matters.
- Entry-ID preservation across file copy is verified for this build path; **not** verified for pi's own `--fork`/`clone`, which we did not use.
