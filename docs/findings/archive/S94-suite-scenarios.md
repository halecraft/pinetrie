# S94 — the suites as scenarios

- **Status:** Answered

Numbered S67 until 2026-10-03, when two spikes held that number.

Measured in a lane (Linux, Node 24, Chromium's headless shell, no
`container` runtime), against the suites before and after
`PLAN-2026-10-01-suite-scenarios`. S65 measured where the time went before.

**Answers.**

1. **What each suite holds** (counted from the source and the runs):

   | suite | before | after |
   |---|---|---|
   | `e2e` | one script, 159 checks (163 with the invariants) | 13 scenarios, 32 checks |
   | `e2e:live` | all of `e2e` again, plus 4 live checks | the `live` scenario, 2 checks |
   | `e2e:browser` | one script, 188 checks | 4 scenarios, 147 checks |
   | `e2e:lanes` | 5 sections, 51 checks | 5 scenarios, 51 checks |

   The unit layer counts 924 static `test`/`it` calls (1,019 in Vitest), so
   the 18 host and lanes scenarios are within ⌊√924⌋ = 30, and the 4
   browser scenarios within ⌊√18⌋ = 4.

2. **A run** (measured, wall time):
   - `e2e`: 20 s before, 16 s after.
   - `e2e:browser`: 4 m 50 s before, with 6 checks failing on timeouts
     (about 220 s) for want of `container`; 223 s after, with those 6
     skipped and none failing. By scenario: `banner` 3 s, `images` 4 s,
     `page` 72 s, `tools` 142 s.

3. **A suite mutant** (measured): before, it replayed its whole suite to
   its check, about 288 s for a browser mutant. After, it runs only its
   scenario: a host mutant takes 3 to 20 s, a browser mutant at most its
   scenario's time (72 s in `page`, 142 s in `tools`), less when its check
   comes early.

4. **Which checks a deliberate bug proves** (counted by
   `scripts/proofs.ts`): before, 14 of 163 `e2e` checks, 73 of 188 browser
   checks and 10 of 51 lanes checks were the `expect` of a suite mutation.
   After, every host check is; 75 browser checks and 41 lanes checks are
   listed in `scripts/unproven.ts`, to be proved or deleted. The lanes'
   mutations need `container`, so they are written and run on the Mac.

5. **Two browser mutations changed what they catch.** Splitting the browser
   suite moved checks away from the steps that once came before them:
   - "alignment does not settle the follow": in `tools` a column is opened
     by `openAt`, whose `reveal` dispatches `PLACED` too, so the mutant
     survived there. It is caught in `page`, where a tab shown again places
     its columns with no reveal ("↓ new below shows on a column that moved
     on while its tab was hidden").
   - "live work is drawn a render behind the document" survives in `tools`:
     its check ("the agent's step is never missing from its column") no
     longer sees a frame with the step missing. Left as an open item.
