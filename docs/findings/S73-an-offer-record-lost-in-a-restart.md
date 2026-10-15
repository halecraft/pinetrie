# S73 — an offer's record lost in a host restart

- **Status:** Answered
- **Led to:** ADR-0038, ADR-0060, ADR-0104, ADR-0105, ADR-0154

An offer (ADR-0038) stopped following its lane for twenty minutes, said
"you edited this offer" though no one had, and was taken with conflicts in
11 files that its column never named. This finding records why
(`PLAN-2026-10-01-offer-lost-write`).

Observed in pine·trie's own repo on 2026-10-01, on `pinetrie-offer/zany-camel`
(change `vupnvkys`), with jj 0.44.0. Read with `jj op log`, `jj evolog`,
`jj interdiff`, all `--ignore-working-copy`, and from the session store's
`pinetrie.offer` and `pinetrie.have` values.

**What the repos held.**

| time | event |
|---|---|
| 22:44:32 | you take mpxwowul, which changes host code |
| 22:44:35 | the host rebases the offer onto your new `@-`: `8de22478`, its content from the lane's `0f8bf517` |
| 22:44:38 | the host follows the lane to `1938535f`: three operations, all by `pinetrie-host`, giving `7e570256` |
| 22:44:45 | a new host process starts |
| 22:44 to 22:59 | the lane makes about 40 more commits; the offer is not refreshed again |
| 23:03:53 | you take the offer; the have it delivers is `0f8bf517` |

- Each host process writes under its own replica id, a uuidv7. The ids in
  the store start at 22:08:32, 22:44:45 and 23:01:36: 11 to 13 s after the
  takes of xlzvkksm, mpxwowul and urllmxkk, each of which changed host code.
  Takes that changed only the client have no restart after them.
- The delivered have, `0f8bf517`, is the offer record's `host.tip`. The
  offer's content was `1938535f`'s. So the record the follow at 22:44:38
  should have written (tip `1938535f`, wrote `7e570256`) never reached the
  store, and the record kept the one from 22:44:35: tip `0f8bf517`, wrote
  `8de22478`.
- `jj interdiff --from 8de22478 --to 7e570256` lists
  `packages/client/card-marks.test.ts`: the one file in which `0f8bf517`
  and `1938535f` differ.

**Answers.**

1. **The follow's jj steps landed and its record did not.** The jj steps
   are durable at once; the record is written after them, into the session
   document. A restart between the two keeps the first and loses the second.
   The host's terminal output from the restart was not kept, so whether it
   shut down gracefully is unknown. A graceful one still loses it: `shutdown`
   awaits `quiet()` before it stops anything, and the offers' 2 s watch and
   lane fetches start refreshes after that.
2. **The host's own rewrite read as your edit.** Every later trigger
   compared the offer with the stale `wrote`. `jj interdiff` was not empty,
   so `planRefresh` answered `leave`, and the host never touched the offer
   again. The evolog shows only `pinetrie-host` operations between `8de22478`
   and `7e570256`.
3. **The column hid the conflict.** `offerView` decides `edited` before
   `conflicts`, and `offerWords` worded the edited state without them. The
   take was labelled plain "take".
4. **Closing pi's harness ends running runs.** `AgentHarness.close` seals
   every lane, so a running `run` rejects, and `runs.ts`' `end` still runs
   its steps: a refresh on the offers' queue, a `settle` on the host's. Those
   too start after `quiet()` has resolved.

**A probe: the evolog says who made each version.** With jj 0.44.0,
`jj evolog -r <commit> --no-graph -T` accepts `commit.commit_id()`,
`commit.change_id()`, `operation.user()` (printed as
`pinetrie-host@<hostname>` for the host's operations) and `predecessors`
(a list of commits). Following the predecessor with the same change id
walks back from the offer's commit to the one the host last recorded:
from `7e570256` it reaches `8de22478` in three steps, each by `pinetrie-host`.
