# S67 — a running command's row after a tab switch, and what the line's `:has()` costs

Measured in a lane (Linux, Node 24, Chromium 141's headless shell, no
`container` runtime), for `PLAN-2026-10-01-column-activity`.

**Answers.**
1. **A tab shown again redrew a running command's row closed, then opened it
   500ms later** (measured). A `MutationObserver` on the page recorded the
   row as it mounted and changed, after a switch to the Archive tab and back:
   `added: live, closed`, then `changed: live, capped` twice (`open`, then
   `data-size`). The column grew by the capped row, and a column at its end
   followed it. A row the reader had made `full` came back `closed`. The cause
   is the one ADR-0049 recorded as a consequence: `revealed` and the reader's
   choice were `ToolRow`'s state, lost with the unmount. With the row memory
   (`screenMemory`, `packages/client/screen-memory.ts`), the same recording
   is `added: live, capped, revealed`, and nothing after.
2. **The tools section's `bash` runs in a lane.** Its tool checks pass
   without `container`, so the new checks went in that section. The six that
   fail there are the baseline's: the where chip, and the offer and review
   checks.
3. **The rule `.column-content:has(.tool.live[data-revealed]) .working-line`
   costs nothing measurable** (measured). A reply streamed for 4 s at 120
   tokens/s into a column of 300 messages, with and without the rule,
   deleted from the page's sheet between the runs. Chromium's
   `Performance.getMetrics` deltas over the 4 s:

   | rule | style recalculations | `RecalcStyleDuration` | `LayoutDuration` |
   |---|---|---|---|
   | with | 198 | 44 ms | 85 ms |
   | without | 198 | 57 ms | 95 ms |

   The two differ by less than they vary between runs (a second pair, with 20
   messages: 37 ms and 37 ms). About 0.25 ms per recalculation either way.
4. **Playwright counts a zero-height element as hidden.** `waitForSelector`
   on `.working-line` times out with "resolved to hidden": its default state
   is `visible`, which needs a non-empty box. A check waits for it with
   `state: "attached"`, or reads its computed `visibility`, as the browser
   suite does.
5. **The star at the rail's `scale(1.8)` covers the first letter of the
   thread's name** (seen in a screenshot). The mark is now the 1.5rem
   square a banner shares with the star (ADR-0053), and it pulses to
   `scale(1.25)` (`pulse-mark`), which stays within the .3rem gap before
   the name.

**Method.** A disposable script beside the browser suite: `startHost` with a
scripted model at 120 tokens/s, `containers: false`; a writer appends N
two-line markdown messages, then `@agent` at the end; the page opens the root
from the Archive tab. A CDP session reads `Performance.getMetrics` before and
after 4 s of streaming, and takes screenshots of the header, the line and a
running command's outline.
